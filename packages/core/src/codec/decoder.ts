// OpAMP codec — protobuf encoding/decoding for AgentToServer and ServerToAgent messages.

import type { AgentToServer, ServerToAgent } from "./types.js";
import {
  decodeAgentToServerProto,
  safeEncodeServerToAgent,
  encodeServerToAgentProto,
} from "./protobuf.js";

export function decodeAgentToServer(buf: ArrayBuffer): AgentToServer {
  return decodeAgentToServerProto(buf);
}

/**
 * Encode a ServerToAgent message to protobuf bytes.
 *
 * Uses safeEncodeServerToAgent internally which automatically selects:
 * - Minimal encoder for heartbeat-only messages (fast path)
 * - Full encoder for messages with error_response, remote_config, etc.
 */
export function encodeServerToAgent(msg: ServerToAgent): ArrayBuffer {
  return safeEncodeServerToAgent(msg);
}

/** Test-only: expose the result of the byte-offset sniff so a regression
 *  test can fail loudly the moment the proto layout shifts. Production code
 *  should not depend on this — use `prepareBroadcastMessage` instead. */
export interface PrepareBroadcastMessageMeta {
  /**
   * Whether the template-splice fast path is enabled. When `false`, every
   * broadcast frame is fully re-encoded — correct, but ~10× more expensive.
   * The fast path is enabled iff the encoded `ServerToAgent` template begins
   * with the bytes `0x?? 0x0a 0x10` (any leading message-type byte, then
   * proto field tag 1 / wire type 2 for `instance_uid`, then length 16).
   */
  fastPathEnabled: boolean;
  /** Byte offset where the 16-byte UID is spliced when fast path is enabled. */
  uidOffset: number;
  encode: (instanceUid: Uint8Array) => ArrayBuffer;
}

/**
 * Returns a closure that produces a per-agent broadcast frame with the
 * agent's `instance_uid` spliced into a pre-encoded template. The fast path
 * assumes the proto encoder emits `instance_uid` (field 1) first as a
 * length-delimited 16-byte field — verified by sniffing the magic bytes
 * `0x0a 0x10` at offsets 1 and 2 of the encoded template. If the encoder
 * ever reorders fields or `instance_uid` ever changes length, the sniff
 * fails and we fall back to per-frame full re-encoding.
 *
 * The protobuf-layout invariant is regression-tested in
 * `packages/core/test/broadcast-encoding.test.ts`; if those tests break,
 * `prepareBroadcastMessage` is silently slow until the schema/encoder is
 * fixed.
 */
export function prepareBroadcastMessage(
  template: Omit<ServerToAgent, "instance_uid">,
): (instanceUid: Uint8Array) => ArrayBuffer {
  return prepareBroadcastMessageWithMeta(template).encode;
}

/** Same as `prepareBroadcastMessage` but exposes whether the fast path was
 *  enabled and at what byte offset, so tests can assert the proto layout
 *  invariant. */
export function prepareBroadcastMessageWithMeta(
  template: Omit<ServerToAgent, "instance_uid">,
): PrepareBroadcastMessageMeta {
  const placeholderUid = new Uint8Array(16);
  const fullMsg: ServerToAgent = { ...template, instance_uid: placeholderUid } as ServerToAgent;
  const encoded = encodeServerToAgentProto(fullMsg);
  const templateBytes = new Uint8Array(encoded);

  // Magic-byte sniff: `0x0a` = proto field tag 1, wire type 2 (length-delimited);
  // `0x10` = length 16. Together this is "field 1 of the message is a 16-byte
  // length-delimited value", which under the current proto schema is
  // `instance_uid`. If a future schema change makes a different field 1, this
  // splice would write garbage into the wrong field — so the test in
  // `broadcast-encoding.test.ts` pins these exact bytes.
  const uidOffset = templateBytes[1] === 0x0a && templateBytes[2] === 0x10 ? 3 : -1;

  if (uidOffset === -1) {
    // Surface fast-path disablement to operators. This warning means the
    // proto layout has shifted under the optimization's feet; production
    // throughput will silently regress until someone notices.
    console.warn(
      "[codec] prepareBroadcastMessage fast-path disabled — proto layout may have changed; " +
        "broadcast encoding will fall back to per-frame full re-encode",
    );
    const encode = (instanceUid: Uint8Array): ArrayBuffer =>
      encodeServerToAgent({ ...template, instance_uid: instanceUid } as ServerToAgent);
    return { fastPathEnabled: false, uidOffset, encode };
  }

  const encode = (instanceUid: Uint8Array): ArrayBuffer => {
    if (instanceUid.length !== 16) {
      return encodeServerToAgent({ ...template, instance_uid: instanceUid } as ServerToAgent);
    }
    const buf = new Uint8Array(templateBytes.length);
    buf.set(templateBytes);
    buf.set(instanceUid, uidOffset);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };
  return { fastPathEnabled: true, uidOffset, encode };
}
