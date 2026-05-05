/**
 * Rust WASM codec wrapper for OpAMP protobuf encoding/decoding.
 *
 * This module provides a drop-in replacement for the TypeScript protobuf-ts
 * implementation. It's designed to be loaded lazily when USE_WASM_CODEC is
 * enabled in the worker environment.
 *
 * Build WASM first:
 *   cd crates/opamp-core && wasm-pack build --target nodejs --release
 */

import { encodeServerToAgent as tsEncodeServerToAgent } from "@o11yfleet/core/codec";
import type { AgentToServer, ServerToAgent } from "@o11yfleet/core/codec";

// WASM module path - relative to apps/worker/src/durable-objects/
const WASM_MODULE_PATH = "../../crates/opamp-core/pkg/o11y_opamp_core";

// Lazy-loaded WASM module - typed as any to avoid TS resolution issues
// The module is loaded dynamically at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmModule: any = null;
let wasmInitPromise: Promise<void> | null = null;
let wasmLoadError: Error | null = null;

export interface WasmCodecStats {
  loaded: boolean;
  version?: string;
  loadError?: string;
  defaultHeartbeatNs?: bigint;
}

const stats: WasmCodecStats = { loaded: false };

/**
 * Initialize the WASM codec. Call this once per worker instance.
 * Safe to call multiple times - subsequent calls return the same promise.
 */
export async function initWasmCodec(): Promise<void> {
  if (wasmModule) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      // Dynamic import of the WASM module built by wasm-pack
      // The path is relative to apps/worker/ at runtime
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(WASM_MODULE_PATH);
      wasmModule = mod;
      wasmModule.init();
      stats.loaded = true;
      stats.version = wasmModule.get_version();
      stats.defaultHeartbeatNs = wasmModule.get_default_heartbeat_interval_ns();
      console.warn(`[wasm-codec] initialized, version ${stats.version}`);
    } catch (err) {
      wasmLoadError = err instanceof Error ? err : new Error(String(err));
      stats.loadError = wasmLoadError.message;
      console.error(`[wasm-codec] failed to load: ${wasmLoadError.message}`);
      throw err;
    }
  })();

  return wasmInitPromise;
}

/**
 * Check if WASM codec is ready to use.
 */
export function isWasmCodecReady(): boolean {
  return wasmModule !== null;
}

/**
 * Get WASM codec statistics.
 */
export function getWasmCodecStats(): WasmCodecStats {
  return { ...stats };
}

// ─── Encoding: ServerToAgent ─────────────────────────────────────────────────

/**
 * Check if a message can be encoded with the minimal WASM encoder.
 * Minimal encoder only supports: instance_uid, flags, capabilities, heart_beat_interval.
 */
function canUseWasmMinimalEncode(msg: ServerToAgent): boolean {
  return (
    !msg.error_response &&
    !msg.remote_config &&
    !msg.connection_settings &&
    !msg.agent_identification &&
    !msg.command
  );
}

/**
 * Encode ServerToAgent message using Rust WASM.
 * Falls back to TS encoder for messages with unsupported fields
 * (error_response, remote_config, connection_settings, agent_identification, command).
 */
export function wasmEncodeServerToAgent(msg: ServerToAgent): ArrayBuffer {
  if (!wasmModule) {
    throw new Error("WASM codec not initialized. Call initWasmCodec() first.");
  }

  // Only use WASM for minimal messages
  if (!canUseWasmMinimalEncode(msg)) {
    // Fall back to TS encoder for full messages
    return tsEncodeServerToAgent(msg);
  }

  // Convert instance_uid to Uint8Array if needed
  const instanceUid =
    msg.instance_uid instanceof Uint8Array ? msg.instance_uid : new Uint8Array(msg.instance_uid);

  // For minimal messages, use 0 as default if heart_beat_interval is not set
  const heartbeatNs =
    msg.heart_beat_interval !== undefined && msg.heart_beat_interval !== null
      ? BigInt(msg.heart_beat_interval)
      : 0n;

  const result = wasmModule.encode_server_to_agent(
    instanceUid,
    BigInt(msg.flags ?? 0),
    BigInt(msg.capabilities ?? 0),
    heartbeatNs,
  );

  return (result as Uint8Array).buffer as ArrayBuffer;
}

/**
 * Build a minimal heartbeat response using WASM.
 * Faster than building the full message structure.
 */
export function wasmBuildHeartbeatResponse(
  instanceUid: Uint8Array,
  heartbeatNs: bigint = 3_600_000_000_000n,
): ArrayBuffer {
  if (!wasmModule) {
    throw new Error("WASM codec not initialized. Call initWasmCodec() first.");
  }

  const caps =
    wasmModule.get_cap_accepts_status() |
    wasmModule.get_cap_offers_remote_config() |
    wasmModule.get_cap_accepts_effective_config() |
    wasmModule.get_cap_offers_connection_settings();

  const result = wasmModule.encode_server_to_agent(instanceUid, 0n, caps, heartbeatNs);

  return (result as Uint8Array).buffer as ArrayBuffer;
}

// ─── Decoding: AgentToServer ─────────────────────────────────────────────────

/**
 * Fast decode for heartbeat messages (no optional fields).
 * Returns [instanceUid, sequenceNum, capabilities, flags] as a flat array.
 */
export function wasmDecodeAgentToServerFast(
  buf: ArrayBuffer,
): [Uint8Array, bigint, bigint, bigint] | null {
  if (!wasmModule) {
    throw new Error("WASM codec not initialized. Call initWasmCodec() first.");
  }

  const data = new Uint8Array(buf);
  const result = wasmModule.decode_agent_to_server_fast(data);

  if (!result) return null;

  // Check if second element indicates full object (slow path)
  if (result[1] === true) {
    return null; // Full object, use slow path
  }

  // Fast path: [instanceUid, sequenceNum, capabilities, flags]
  return [
    new Uint8Array(result[0] as ArrayBuffer),
    BigInt(result[1] as number),
    BigInt(result[2] as number),
    BigInt(result[3] as number),
  ];
}

/**
 * Decode AgentToServer message from protobuf bytes using Rust WASM.
 * Uses hybrid approach: core fields as direct values + optional fields as JSON.
 * Returns [instanceUid, sequenceNum, capabilities, flags, metadata].
 * metadata is a JSON string containing optional fields.
 */
export function wasmDecodeAgentToServerHybrid(
  buf: ArrayBuffer,
): [Uint8Array, bigint, bigint, bigint, Record<string, unknown> | null] | null {
  if (!wasmModule) {
    throw new Error("WASM codec not initialized. Call initWasmCodec() first.");
  }

  const data = new Uint8Array(buf);
  const result = wasmModule.decode_agent_to_server_hybrid(data);

  if (!result) return null;

  const metadata = result[4] as string;
  const parsedMetadata = metadata === "{}" ? null : JSON.parse(metadata);

  return [
    new Uint8Array(result[0] as ArrayBuffer),
    BigInt(result[1] as number),
    BigInt(result[2] as number),
    BigInt(result[3] as number),
    parsedMetadata,
  ];
}

/**
 * Decode AgentToServer message from protobuf bytes using Rust WASM.
 * Returns a plain JS object directly (no JSON parsing needed).
 * Uses hybrid approach for best performance.
 */
export function wasmDecodeAgentToServer(buf: ArrayBuffer): AgentToServer {
  if (!wasmModule) {
    throw new Error("WASM codec not initialized. Call initWasmCodec() first.");
  }

  const data = new Uint8Array(buf);
  const result = wasmModule.decode_agent_to_server_hybrid(data);

  if (!result) {
    throw new Error("Failed to decode AgentToServer message");
  }

  // Extract fields from the hybrid result [instanceUid, sequenceNum, capabilities, flags, metadata]
  // Avoid double-decode by using result directly instead of calling wasmDecodeAgentToServerHybrid again
  const instanceUid = new Uint8Array(result[0] as ArrayBuffer);
  const sequenceNum = result[1] as number;
  const capabilities = result[2] as number;
  const flags = result[3] as number;
  const metadata = result[4] as string;

  // Parse metadata JSON if present
  const parsedMetadata = metadata && metadata !== "{}" ? JSON.parse(metadata) : {};

  return {
    instance_uid: instanceUid,
    sequence_num: Number(sequenceNum),
    capabilities: Number(capabilities),
    flags: Number(flags),
    ...parsedMetadata,
  } as AgentToServer;
}
