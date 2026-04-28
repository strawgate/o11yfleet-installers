// OpAMP codec — encode/decode AgentToServer and ServerToAgent messages
// Supports both standard protobuf (real collectors) and custom JSON framing (fake-collector).

import type { AgentToServer, ServerToAgent } from "./types.js";
import { encodeFrame, decodeFrame } from "./framing.js";
import { decodeAgentToServerProto, encodeServerToAgentProto, isProtobufFrame } from "./protobuf.js";

export type CodecFormat = "json" | "protobuf";

/**
 * Detect the codec format of a binary WebSocket message.
 */
export function detectCodecFormat(buf: ArrayBuffer): CodecFormat {
  return isProtobufFrame(buf) ? "protobuf" : "json";
}

/**
 * Decode a binary WebSocket frame into an AgentToServer message.
 * Auto-detects protobuf vs JSON format.
 */
export function decodeAgentToServer(buf: ArrayBuffer, format?: CodecFormat): AgentToServer {
  const fmt = format ?? detectCodecFormat(buf);
  return fmt === "protobuf" ? decodeAgentToServerProto(buf) : decodeFrame<AgentToServer>(buf);
}

/**
 * Encode a ServerToAgent message into a binary WebSocket frame.
 * Uses the specified format (defaults to JSON for backward compat).
 */
export function encodeServerToAgent(msg: ServerToAgent, format: CodecFormat = "json"): ArrayBuffer {
  return format === "protobuf" ? encodeServerToAgentProto(msg) : encodeFrame(msg);
}
