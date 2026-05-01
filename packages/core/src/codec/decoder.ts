// OpAMP codec — protobuf encoding/decoding for AgentToServer and ServerToAgent messages.

import type { AgentToServer, ServerToAgent } from "./types.js";
import { decodeAgentToServerProto, encodeServerToAgentProto } from "./protobuf.js";

export function decodeAgentToServer(buf: ArrayBuffer): AgentToServer {
  return decodeAgentToServerProto(buf);
}

export function encodeServerToAgent(msg: ServerToAgent): ArrayBuffer {
  return encodeServerToAgentProto(msg);
}

export function prepareBroadcastMessage(
  template: Omit<ServerToAgent, "instance_uid">,
): (instanceUid: Uint8Array) => ArrayBuffer {
  const placeholderUid = new Uint8Array(16);
  const fullMsg: ServerToAgent = { ...template, instance_uid: placeholderUid } as ServerToAgent;
  const encoded = encodeServerToAgentProto(fullMsg);
  const templateBytes = new Uint8Array(encoded);

  const uidOffset = templateBytes[1] === 0x0a && templateBytes[2] === 0x10 ? 3 : -1;

  if (uidOffset === -1) {
    return (instanceUid: Uint8Array) =>
      encodeServerToAgent({ ...template, instance_uid: instanceUid } as ServerToAgent);
  }

  return (instanceUid: Uint8Array) => {
    if (instanceUid.length !== 16) {
      return encodeServerToAgent({ ...template, instance_uid: instanceUid } as ServerToAgent);
    }
    const buf = new Uint8Array(templateBytes.length);
    buf.set(templateBytes);
    buf.set(instanceUid, uidOffset);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };
}
