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

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddingLength = (64 - ((bytes.length + 9) % 64)) % 64;
  const data = new Uint8Array(bytes.length + 1 + paddingLength + 8);
  data.set(bytes);
  data[bytes.length] = 0x80;

  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(data.length - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15]!, 7) ^ rightRotate(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rightRotate(w[i - 2]!, 17) ^ rightRotate(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("");
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
    newState.connected_at = now;
    shouldPersist = true;
    events.push(
      makeFleetEvent({
        type: FleetEventType.AGENT_CONNECTED,
        tenant_id: state.tenant_id,
        config_id: state.config_id,
        instance_uid: instanceUid,
        timestamp: now,
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
      const hashInput = `${entry.content_type}:${body}`;
      const hashHex = sha256Hex(hashInput);
      if (hashHex !== state.effective_config_hash) {
        newState.effective_config_hash = hashHex;
        newState.effective_config_body = body;
        shouldPersist = true;
        events.push(
          makeFleetEvent({
            type: FleetEventType.CONFIG_EFFECTIVE_REPORTED,
            tenant_id: state.tenant_id,
            config_id: state.config_id,
            instance_uid: instanceUid,
            timestamp: now,
            effective_config_hash: hashHex,
            dedupe_key: `effective:${state.tenant_id}:${state.config_id}:${instanceUid}:${msg.sequence_num}:${hashHex}`,
          }),
        );
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
        events.push(
          makeFleetEvent({
            type: FleetEventType.CONFIG_APPLIED,
            tenant_id: state.tenant_id,
            config_id: state.config_id,
            instance_uid: instanceUid,
            timestamp: now,
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
