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

/**
 * Pre-encode a ServerToAgent message for broadcast to many sockets.
 * Returns a function that efficiently produces per-socket messages by patching
 * only the instance_uid in the pre-encoded buffer (avoids re-encoding the heavy
 * remote_config payload for every socket).
 *
 * For protobuf: the instance_uid is field 1 at a fixed offset in the serialized
 * message. We encode once with a placeholder UID, then memcpy the real UID per socket.
 *
 * For JSON: we encode per-socket since the overhead is minimal (JSON text replacement).
 */
export function prepareBroadcastMessage(
  template: Omit<ServerToAgent, "instance_uid">,
  format: CodecFormat,
): (instanceUid: Uint8Array) => ArrayBuffer {
  if (format === "json") {
    // JSON: encode per-socket (JSON is cheap, no binary payload to re-copy)
    return (instanceUid: Uint8Array) =>
      encodeFrame({ ...template, instance_uid: instanceUid } as ServerToAgent);
  }

  // Protobuf: encode once with a zeroed placeholder UID, find the UID bytes
  // in the output buffer, then return a function that clones + patches.
  const placeholderUid = new Uint8Array(16); // all zeros
  const fullMsg: ServerToAgent = { ...template, instance_uid: placeholderUid } as ServerToAgent;
  const encoded = encodeServerToAgentProto(fullMsg);
  const templateBytes = new Uint8Array(encoded);

  // In protobuf encoding, field 1 (instance_uid) is encoded as:
  //   offset 0: 0x00 (opamp-go data-type header)
  //   offset 1: 0x0a (field 1, wire type 2 = length-delimited)
  //   offset 2: 0x10 (varint: length = 16)
  //   offset 3..18: 16 bytes of UID data
  // Verify this matches our expectation:
  const uidOffset = templateBytes[1] === 0x0a && templateBytes[2] === 0x10 ? 3 : -1;

  if (uidOffset === -1) {
    // Fallback: if encoding layout differs, encode per-socket (safe but slower)
    return (instanceUid: Uint8Array) =>
      encodeServerToAgent({ ...template, instance_uid: instanceUid } as ServerToAgent, format);
  }

  return (instanceUid: Uint8Array) => {
    if (instanceUid.length !== 16) {
      // Non-standard UID length — fall back to full re-encode
      return encodeServerToAgent(
        { ...template, instance_uid: instanceUid } as ServerToAgent,
        format,
      );
    }
    // Clone the pre-encoded buffer and patch the UID bytes in-place
    const buf = new Uint8Array(templateBytes.length);
    buf.set(templateBytes);
    buf.set(instanceUid, uidOffset);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };
}
