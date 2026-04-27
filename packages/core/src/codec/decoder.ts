// OpAMP codec — encode/decode AgentToServer and ServerToAgent messages

import type { AgentToServer, ServerToAgent } from "./types.js";
import { encodeFrame, decodeFrame } from "./framing.js";

/**
 * Decode a binary WebSocket frame into an AgentToServer message.
 */
export function decodeAgentToServer(buf: ArrayBuffer): AgentToServer {
  return decodeFrame<AgentToServer>(buf);
}

/**
 * Encode a ServerToAgent message into a binary WebSocket frame.
 */
export function encodeServerToAgent(msg: ServerToAgent): ArrayBuffer {
  return encodeFrame(msg);
}
