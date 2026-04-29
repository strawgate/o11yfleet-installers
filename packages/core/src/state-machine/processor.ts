// OpAMP state machine — processFrame
// Pure function: (state, msg) → { newState, response, events, shouldPersist }

import type { AgentState, ProcessResult } from "./types.js";
import type { AgentToServer, ServerToAgent } from "../codec/types.js";
import {
  ServerCapabilities,
  ServerToAgentFlags,
  RemoteConfigStatuses,
  AgentCapabilities,
  AgentToServerFlags,
} from "../codec/types.js";
import { FleetEventType } from "../events.js";
import type { AnyFleetEvent } from "../events.js";
import { uint8ToHex } from "../hex.js";

function arraysEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Simple FNV-1a hash for effective config change detection (not crypto). */
function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Default recommended heartbeat interval: 1 hour (in nanoseconds).
 *  Liveness is handled by WebSocket auto-response ping/pong at zero DO cost.
 *  Heartbeats exist only for periodic state reconciliation — not keepalive. */
export const DEFAULT_HEARTBEAT_INTERVAL_NS = 3_600_000_000_000; // 1 hour in ns

export function processFrame(
  state: AgentState,
  msg: AgentToServer,
  configContentBytes?: Uint8Array | null,
  heartbeatIntervalNs?: number,
): ProcessResult {
  const events: AnyFleetEvent[] = [];
  let shouldPersist = false;
  const now = Date.now();

  // Clone state
  const newState: AgentState = { ...state, last_seen_at: now };

  // Build base response — always include heartbeat interval per OpAMP spec
  const response: ServerToAgent = {
    instance_uid: msg.instance_uid,
    flags: ServerToAgentFlags.Unspecified,
    capabilities:
      ServerCapabilities.AcceptsStatus |
      ServerCapabilities.OffersRemoteConfig |
      ServerCapabilities.AcceptsEffectiveConfig,
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
  // NOTE: liveness detection uses WebSocket auto-response timestamps
  // (checked in the alarm handler), NOT last_seen_at in SQLite.
  shouldPersist = true;

  // Handle disconnect
  if (msg.agent_disconnect) {
    newState.status = "disconnected";
    newState.connected_at = 0;
    events.push({
      type: FleetEventType.AGENT_DISCONNECTED,
      tenant_id: state.tenant_id,
      config_id: state.config_id,
      instance_uid: uint8ToHex(state.instance_uid),
      timestamp: now,
      reason: "agent_disconnect_message",
    });
    shouldPersist = true;
    return { newState, response: null, events, shouldPersist };
  }

  // Is this a hello (first message or reconnection)?
  // Per OpAMP spec, seq=0 signals a hello. Also treat as hello if connected_at was never set.
  const isHello = msg.sequence_num === 0 || state.connected_at === 0;

  if (isHello) {
    newState.connected_at = now;
    shouldPersist = true;
    events.push({
      type: FleetEventType.AGENT_CONNECTED,
      tenant_id: state.tenant_id,
      config_id: state.config_id,
      instance_uid: uint8ToHex(state.instance_uid),
      timestamp: now,
    });
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
    const healthChanged =
      msg.health.healthy !== state.healthy ||
      msg.health.status !== state.status ||
      msg.health.last_error !== state.last_error;
    if (healthChanged) {
      newState.healthy = msg.health.healthy;
      newState.status = msg.health.status;
      newState.last_error = msg.health.last_error;
      shouldPersist = true;
      events.push({
        type: FleetEventType.AGENT_HEALTH_CHANGED,
        tenant_id: state.tenant_id,
        config_id: state.config_id,
        instance_uid: uint8ToHex(state.instance_uid),
        timestamp: now,
        healthy: msg.health.healthy,
        status: msg.health.status,
        last_error: msg.health.last_error,
      });
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

  // Process effective config — store the agent's actual running config for fleet visibility
  if (msg.effective_config?.config_map?.config_map) {
    const configMap = msg.effective_config.config_map.config_map;
    // Use the default "" key (standard single-config) or first available key
    const entry = configMap[""] ?? Object.values(configMap)[0];
    if (entry) {
      const body = new TextDecoder().decode(entry.body);
      // Simple hash for change detection — use first 16 chars of hex-encoded content hash
      const hashInput = `${entry.content_type}:${body}`;
      const hashHex = simpleHash(hashInput);
      if (hashHex !== state.effective_config_hash) {
        newState.effective_config_hash = hashHex;
        newState.effective_config_body = body;
        shouldPersist = true;
        events.push({
          type: FleetEventType.CONFIG_EFFECTIVE_REPORTED,
          tenant_id: state.tenant_id,
          config_id: state.config_id,
          instance_uid: uint8ToHex(state.instance_uid),
          timestamp: now,
          effective_config_hash: hashHex,
        });
      }
    }
  }

  // Handle RequestInstanceUid flag — assign new UID per OpAMP spec
  if ((msg.flags & AgentToServerFlags.RequestInstanceUid) !== 0) {
    const newUid = crypto.getRandomValues(new Uint8Array(16));
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
        events.push({
          type: FleetEventType.CONFIG_APPLIED,
          tenant_id: state.tenant_id,
          config_id: state.config_id,
          instance_uid: uint8ToHex(state.instance_uid),
          timestamp: now,
          config_hash: hashHex,
        });
      }
    } else if (msg.remote_config_status.status === RemoteConfigStatuses.FAILED) {
      shouldPersist = true;
      events.push({
        type: FleetEventType.CONFIG_REJECTED,
        tenant_id: state.tenant_id,
        config_id: state.config_id,
        instance_uid: uint8ToHex(state.instance_uid),
        timestamp: now,
        config_hash: hashHex,
        error_message: msg.remote_config_status.error_message,
      });
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
