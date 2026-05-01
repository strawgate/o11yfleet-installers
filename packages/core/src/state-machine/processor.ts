// OpAMP state machine — processFrame
// Async pure function: (state, msg) → { newState, response, events, shouldPersist }

import type { AgentState, ProcessResult, ProcessContext } from "./types.js";
import { defaultProcessContext } from "./types.js";
import type { AgentToServer, ServerToAgent } from "../codec/types.js";
import {
  ServerCapabilities,
  ServerToAgentFlags,
  RemoteConfigStatuses,
  AgentCapabilities,
  AgentToServerFlags,
} from "../codec/types.js";
import { FleetEventType, makeFleetEvent } from "../events.js";
import type { AnyFleetEvent } from "../events.js";
import { uint8ToHex } from "../hex.js";

/**
 * Truncate an agent-supplied string to a maximum length so unbounded
 * input cannot blow up event payload sizes or aggregation cardinality.
 * Empty strings (never-supplied case) pass through unchanged.
 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function arraysEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Default recommended heartbeat interval: 1 hour (in nanoseconds).
 *  Liveness is handled by WebSocket auto-response ping/pong at zero DO cost.
 *  Heartbeats exist only for periodic state reconciliation — not keepalive. */
export const DEFAULT_HEARTBEAT_INTERVAL_NS = 3_600_000_000_000; // 1 hour in ns

export async function processFrame(
  state: AgentState,
  msg: AgentToServer,
  configContentBytes?: Uint8Array | null,
  heartbeatIntervalNs?: number,
  ctx?: ProcessContext,
): Promise<ProcessResult> {
  const context = ctx ?? defaultProcessContext();
  const events: AnyFleetEvent[] = [];
  let shouldPersist = false;
  const now = context.now;
  const instanceUid = uint8ToHex(state.instance_uid);

  // Clone state
  const newState: AgentState = { ...state, last_seen_at: now };

  // Build base response — always include heartbeat interval per OpAMP spec
  const response: ServerToAgent = {
    instance_uid: msg.instance_uid,
    flags: ServerToAgentFlags.Unspecified,
    capabilities:
      ServerCapabilities.AcceptsStatus |
      ServerCapabilities.OffersRemoteConfig |
      ServerCapabilities.AcceptsEffectiveConfig |
      ServerCapabilities.OffersConnectionSettings,
    heart_beat_interval: heartbeatIntervalNs ?? DEFAULT_HEARTBEAT_INTERVAL_NS,
  };

  // Check for sequence gap
  const expectedSeq = state.sequence_num + 1;
  if (msg.sequence_num !== 0 && msg.sequence_num !== expectedSeq) {
    // Sequence gap detected — request full state report
    response.flags |= ServerToAgentFlags.ReportFullState;
    newState.sequence_num = msg.sequence_num;
    shouldPersist = true;
    return { newState, response, events, shouldPersist };
  }

  newState.sequence_num = msg.sequence_num;

  // Persist sequence_num so the next message sees the correct expected
  // sequence. With 1-hour heartbeats this is ~1 write/hour/agent.
  // Liveness fallback uses last_seen_at in SQLite; auto-response ping/pong
  // keeps idle WebSockets alive without waking the Durable Object.
  shouldPersist = true;

  // Handle disconnect
  if (msg.agent_disconnect) {
    // Capture the connection generation (`state.connected_at`) before we
    // clear it so the dedupe_key is unique to this session. `sequence_num`
    // alone is only unique within one connection — it resets on reconnect.
    const sessionGeneration = state.connected_at;
    newState.status = "disconnected";
    newState.connected_at = 0;
    events.push(
      makeFleetEvent({
        type: FleetEventType.AGENT_DISCONNECTED,
        tenant_id: state.tenant_id,
        config_id: state.config_id,
        instance_uid: instanceUid,
        timestamp: now,
        event_id: context.randomId(),
        reason: "agent_disconnect_message",
        dedupe_key: `disconnected:${state.tenant_id}:${state.config_id}:${instanceUid}:agent_disconnect_message:${sessionGeneration}:${msg.sequence_num}`,
      }),
    );
    shouldPersist = true;
    return { newState, response: null, events, shouldPersist };
  }

  // Is this a hello (first message or reconnection)?
  // Per OpAMP spec, seq=0 signals a hello. Also treat as hello if connected_at was never set.
  const isHello = msg.sequence_num === 0 || state.connected_at === 0;

  if (isHello) {
    // Per OpAMP spec §4.2: request full agent state on first connection
    response.flags |= ServerToAgentFlags.ReportFullState;
    newState.connected_at = now;
    shouldPersist = true;
    events.push(
      makeFleetEvent({
        type: FleetEventType.AGENT_CONNECTED,
        tenant_id: state.tenant_id,
        config_id: state.config_id,
        instance_uid: instanceUid,
        timestamp: now,
        event_id: context.randomId(),
        dedupe_key: `connected:${state.tenant_id}:${state.config_id}:${instanceUid}:${msg.sequence_num}:${now}`,
      }),
    );
  }

  // C3 fix: Store capabilities from message when present
  if (msg.capabilities !== undefined && msg.capabilities !== 0) {
    if (msg.capabilities !== newState.capabilities) {
      newState.capabilities = msg.capabilities;
      shouldPersist = true;
    }
  }

  // Process health
  if (msg.health) {
    // Cap agent-controlled strings at ingest. `status` becomes a SQL
    // GROUP BY key in the cohort breakdown aggregation, so unbounded
    // cardinality from a misbehaving fleet would amplify into expensive
    // /stats responses. `last_error` is included in dedupe_key + event
    // payloads — cap so a single oversized string can't blow up queue
    // message size or the AE blob limits.
    const status = truncate(msg.health.status, 32);
    const lastError = truncate(msg.health.last_error, 4096);
    const healthChanged =
      msg.health.healthy !== state.healthy ||
      status !== state.status ||
      lastError !== state.last_error;
    if (healthChanged) {
      newState.healthy = msg.health.healthy;
      newState.status = status;
      newState.last_error = lastError;
      shouldPersist = true;
      events.push(
        makeFleetEvent({
          type: FleetEventType.AGENT_HEALTH_CHANGED,
          tenant_id: state.tenant_id,
          config_id: state.config_id,
          instance_uid: instanceUid,
          timestamp: now,
          event_id: context.randomId(),
          healthy: msg.health.healthy,
          status,
          last_error: lastError,
          // Include the current connection generation so a reused
          // sequence_num after a reconnect does not collide with a prior
          // session's health event.
          dedupe_key: `health:${state.tenant_id}:${state.config_id}:${instanceUid}:${newState.connected_at}:${msg.sequence_num}:${msg.health.healthy}:${status}:${lastError}`,
        }),
      );
    }
    // Store per-component health map. An explicit empty map is a valid
    // "clear" update — collapsing it into "no update" would let stale
    // component_health_map rows persist after a collector clears its state.
    if (msg.health.component_health_map !== undefined) {
      newState.component_health_map = msg.health.component_health_map as Record<string, unknown>;
      shouldPersist = true;
    }
  }

  // Process agent description
  if (msg.agent_description) {
    const descJson = JSON.stringify(msg.agent_description);
    if (descJson !== state.agent_description) {
      newState.agent_description = descJson;
      shouldPersist = true;
    }
  }

  // Process available_components (spec field 14, Development). Only populated
  // by the JSON codec — protobuf-framed agents won't set this until we add the
  // proto message definition and codec mapping (see opamp.proto field 14 comment).
  if (msg.available_components !== undefined) {
    newState.available_components = msg.available_components;
    shouldPersist = true;
  }

  // Process effective config — store the agent's actual running config for fleet visibility
  if (msg.effective_config?.config_map?.config_map) {
    const configMap = msg.effective_config.config_map.config_map;
    // Use the default "" key (standard single-config) or first available key
    const entry = configMap[""] ?? Object.values(configMap)[0];
    if (entry) {
      // Build hash input as bytes directly — no redundant TextEncoder round-trip
      const prefix = new TextEncoder().encode(`${entry.content_type}:`);
      const hashInput = new Uint8Array(prefix.length + entry.body.length);
      hashInput.set(prefix);
      hashInput.set(entry.body, prefix.length);
      const hashHex = await context.sha256(hashInput);
      if (hashHex !== state.effective_config_hash) {
        newState.effective_config_hash = hashHex;
        newState.effective_config_body = new TextDecoder().decode(entry.body);
        shouldPersist = true;
        events.push(
          makeFleetEvent({
            type: FleetEventType.CONFIG_EFFECTIVE_REPORTED,
            tenant_id: state.tenant_id,
            config_id: state.config_id,
            instance_uid: instanceUid,
            timestamp: now,
            event_id: context.randomId(),
            effective_config_hash: hashHex,
            dedupe_key: `effective:${state.tenant_id}:${state.config_id}:${instanceUid}:${msg.sequence_num}:${hashHex}`,
          }),
        );
      }
    }
  }

  // Handle RequestInstanceUid flag — assign new UID per OpAMP spec
  if ((msg.flags & AgentToServerFlags.RequestInstanceUid) !== 0) {
    const newUid = context.randomUid();
    response.agent_identification = { new_instance_uid: newUid };
  }

  // Process remote config status
  if (msg.remote_config_status) {
    const hash = msg.remote_config_status.last_remote_config_hash;
    const hashHex = hash ? uint8ToHex(hash) : "";
    if (msg.remote_config_status.status === RemoteConfigStatuses.APPLIED) {
      const hashChanged = !arraysEqual(state.current_config_hash, hash ?? null);
      if (hash && hashChanged) {
        newState.current_config_hash = hash;
        shouldPersist = true;
        events.push(
          makeFleetEvent({
            type: FleetEventType.CONFIG_APPLIED,
            tenant_id: state.tenant_id,
            config_id: state.config_id,
            instance_uid: instanceUid,
            timestamp: now,
            event_id: context.randomId(),
            config_hash: hashHex,
            dedupe_key: `applied:${state.tenant_id}:${state.config_id}:${instanceUid}:${msg.sequence_num}:${hashHex}`,
          }),
        );
      }
    } else if (msg.remote_config_status.status === RemoteConfigStatuses.FAILED) {
      shouldPersist = true;
      events.push(
        makeFleetEvent({
          type: FleetEventType.CONFIG_REJECTED,
          tenant_id: state.tenant_id,
          config_id: state.config_id,
          instance_uid: instanceUid,
          timestamp: now,
          event_id: context.randomId(),
          config_hash: hashHex,
          error_message: msg.remote_config_status.error_message,
          dedupe_key: `rejected:${state.tenant_id}:${state.config_id}:${instanceUid}:${hashHex}:${msg.remote_config_status.error_message}`,
        }),
      );
    }
  }

  // Offer remote config if needed — use stored capabilities, not just current message
  if (
    newState.desired_config_hash &&
    !arraysEqual(newState.current_config_hash, newState.desired_config_hash) &&
    (newState.capabilities & AgentCapabilities.AcceptsRemoteConfig) !== 0
  ) {
    // C4 fix: Include config content in config_map when available
    const configMap: Record<string, { body: Uint8Array; content_type: string }> = {};
    if (configContentBytes) {
      configMap[""] = {
        body: configContentBytes,
        content_type: "text/yaml",
      };
    }
    response.remote_config = {
      config: { config_map: configMap },
      config_hash: newState.desired_config_hash,
    };
  }

  return { newState, response, events, shouldPersist };
}
