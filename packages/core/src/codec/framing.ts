// OpAMP WebSocket binary framing
// OpAMP over WebSocket uses a simple header: 1 byte data type + protobuf payload
// Data type 0 = AgentToServer, Data type 1 = ServerToAgent
// For v1, we use a simplified JSON-over-binary encoding until we integrate full protobuf

import type { AgentToServer, ServerToAgent } from "./types.js";

const HEADER_SIZE = 4; // 4-byte big-endian length prefix
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/**
 * Encode a frame for WebSocket transmission.
 * Format: [4-byte BE length][JSON payload]
 */
export function encodeFrame(msg: AgentToServer | ServerToAgent): ArrayBuffer {
  const json = JSON.stringify(msg, (_key, value) => {
    if (value instanceof Uint8Array) {
      return { __type: "bytes", data: Array.from(value) };
    }
    if (typeof value === "bigint") {
      return { __type: "bigint", value: value.toString() };
    }
    return value;
  });
  const payload = TEXT_ENCODER.encode(json);
  const buf = new ArrayBuffer(HEADER_SIZE + payload.byteLength);
  const view = new DataView(buf);
  view.setUint32(0, payload.byteLength, false); // big-endian
  new Uint8Array(buf, HEADER_SIZE).set(payload);
  return buf;
}

/**
 * Decode a frame from WebSocket binary data.
 * Returns parsed message and remaining buffer offset.
 */
export function decodeFrame<T = AgentToServer | ServerToAgent>(buf: ArrayBuffer): T {
  const view = new DataView(buf);
  if (buf.byteLength < HEADER_SIZE) {
    throw new Error(`Frame too short: ${buf.byteLength} bytes`);
  }
  const payloadLen = view.getUint32(0, false);
  if (buf.byteLength < HEADER_SIZE + payloadLen) {
    throw new Error(`Incomplete frame: expected ${payloadLen} payload bytes, got ${buf.byteLength - HEADER_SIZE}`);
  }
  const payloadBytes = new Uint8Array(buf, HEADER_SIZE, payloadLen);
  const json = TEXT_DECODER.decode(payloadBytes);
  return JSON.parse(json, (_key, value) => {
    if (value && typeof value === "object" && value.__type === "bytes") {
      return new Uint8Array(value.data);
    }
    if (value && typeof value === "object" && value.__type === "bigint") {
      return BigInt(value.value);
    }
    return value;
  }) as T;
}
