// OpAMP state machine — processFrame
// Pure function: (state, msg) → { newState, response, events, shouldPersist }

import type { AgentState, ProcessResult } from "./types.js";
import type { AgentToServer, ServerToAgent } from "../codec/types.js";
import {
  ServerCapabilities,
  ServerToAgentFlags,
  RemoteConfigStatuses,
  AgentCapabilities,
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

export function processFrame(
  state: AgentState,
  msg: AgentToServer,
  configContentBytes?: Uint8Array | null,
): ProcessResult {
  const events: AnyFleetEvent[] = [];
  let shouldPersist = false;
  const now = Date.now();

  // Clone state
  const newState: AgentState = { ...state, last_seen_at: now };

  // Build base response
  const response: ServerToAgent = {
    instance_uid: msg.instance_uid,
    flags: ServerToAgentFlags.Unspecified,
    capabilities:
      ServerCapabilities.AcceptsStatus |
      ServerCapabilities.OffersRemoteConfig |
      ServerCapabilities.AcceptsEffectiveConfig,
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

  // Pure heartbeat (no health change, no config status, no description) — no persist
  // shouldPersist remains false if nothing above triggered

  return { newState, response, events, shouldPersist };
}
