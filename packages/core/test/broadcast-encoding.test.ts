import { describe, it, expect } from "vitest";
import {
  prepareBroadcastMessage,
  prepareBroadcastMessageWithMeta,
  encodeServerToAgent,
} from "../src/codec/index.js";
import { fromBinary } from "@bufbuild/protobuf";
import { ServerToAgentSchema } from "../src/codec/gen/opamp_pb.js";
import type { ServerToAgent } from "../src/codec/types.js";
import { ServerCapabilities } from "../src/codec/types.js";

describe("prepareBroadcastMessage", () => {
  const template: Omit<ServerToAgent, "instance_uid"> = {
    flags: 0,
    capabilities:
      ServerCapabilities.AcceptsStatus |
      ServerCapabilities.OffersRemoteConfig |
      ServerCapabilities.AcceptsEffectiveConfig,
    remote_config: {
      config: {
        config_map: {
          "": {
            body: new TextEncoder().encode("receivers:\n  otlp:\n    protocols:\n      grpc:\n"),
            content_type: "text/yaml",
          },
        },
      },
      config_hash: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]),
    },
  };

  it("protobuf broadcast produces correct message for each UID", () => {
    const broadcast = prepareBroadcastMessage(template, "protobuf");

    const uid1 = new Uint8Array(16);
    uid1.fill(0x01);
    const uid2 = new Uint8Array(16);
    uid2.fill(0x02);

    const buf1 = broadcast(uid1);
    const buf2 = broadcast(uid2);

    // Decode and verify UID differs
    const bytes1 = new Uint8Array(buf1).slice(1); // skip 0x00 header
    const bytes2 = new Uint8Array(buf2).slice(1);
    const msg1 = fromBinary(ServerToAgentSchema, bytes1);
    const msg2 = fromBinary(ServerToAgentSchema, bytes2);

    expect(msg1.instanceUid).toEqual(uid1);
    expect(msg2.instanceUid).toEqual(uid2);

    // Remote config is identical
    expect(msg1.remoteConfig?.configHash).toEqual(msg2.remoteConfig?.configHash);
    expect(msg1.remoteConfig?.config?.configMap[""]?.body).toEqual(
      msg2.remoteConfig?.config?.configMap[""]?.body,
    );
  });

  it("protobuf broadcast matches standard encodeServerToAgent output", () => {
    const broadcast = prepareBroadcastMessage(template, "protobuf");
    const uid = new Uint8Array(16);
    uid.fill(0xab);

    const broadcastBuf = broadcast(uid);
    const standardBuf = encodeServerToAgent(
      { ...template, instance_uid: uid } as ServerToAgent,
      "protobuf",
    );

    // Byte-for-byte equality
    expect(new Uint8Array(broadcastBuf)).toEqual(new Uint8Array(standardBuf));
  });

  it("json broadcast produces correct message for each UID", () => {
    const broadcast = prepareBroadcastMessage(template, "json");

    const uid1 = new Uint8Array(16);
    uid1.fill(0x11);
    const uid2 = new Uint8Array(16);
    uid2.fill(0x22);

    const buf1 = broadcast(uid1);
    const buf2 = broadcast(uid2);

    // JSON messages should differ in instance_uid
    expect(buf1.byteLength).toBeGreaterThan(0);
    expect(buf2.byteLength).toBeGreaterThan(0);
    expect(new Uint8Array(buf1)).not.toEqual(new Uint8Array(buf2));

    // Each broadcast output must match a direct encode with the same UID
    const direct1 = encodeServerToAgent(
      { ...template, instance_uid: uid1 } as ServerToAgent,
      "json",
    );
    const direct2 = encodeServerToAgent(
      { ...template, instance_uid: uid2 } as ServerToAgent,
      "json",
    );
    expect(new Uint8Array(buf1)).toEqual(new Uint8Array(direct1));
    expect(new Uint8Array(buf2)).toEqual(new Uint8Array(direct2));
  });

  it("broadcast is faster than N individual encodes for protobuf", () => {
    const broadcast = prepareBroadcastMessage(template, "protobuf");
    const uids = Array.from({ length: 100 }, (_, i) => {
      const uid = new Uint8Array(16);
      uid.fill(i);
      return uid;
    });

    // Warmup both paths to avoid JIT bias
    for (const uid of uids) broadcast(uid);
    for (const uid of uids)
      encodeServerToAgent({ ...template, instance_uid: uid } as ServerToAgent, "protobuf");

    // Take the best of 3 runs to reduce scheduler noise
    const times = (fn: () => void) => {
      const results: number[] = [];
      for (let r = 0; r < 3; r++) {
        const s = performance.now();
        fn();
        results.push(performance.now() - s);
      }
      return Math.min(...results);
    };

    const broadcastTime = times(() => {
      for (const uid of uids) broadcast(uid);
    });
    const standardTime = times(() => {
      for (const uid of uids)
        encodeServerToAgent({ ...template, instance_uid: uid } as ServerToAgent, "protobuf");
    });

    // Broadcast should be faster (typically 5-10x for large payloads)
    expect(broadcastTime).toBeLessThan(standardTime);
  });

  // ─── Proto-layout invariant regression guard ──────────────────────────
  //
  // The fast path in `prepareBroadcastMessage` splices `instance_uid` at byte
  // offset 3, conditional on `templateBytes[1] === 0x0a && templateBytes[2]
  // === 0x10` (proto field tag 1 / wire type 2 / length 16 — i.e. "first
  // field is a 16-byte length-delimited value", which is `instance_uid`
  // under the current schema). If anyone reorders proto fields or changes
  // `instance_uid` length, the sniff fails and broadcast falls back to slow
  // per-frame re-encoding. Without these tests the regression would be
  // silent until somebody noticed throughput halving in production.

  it("fast-path is enabled and uid is at byte offset 3 (proto-layout invariant)", () => {
    const meta = prepareBroadcastMessageWithMeta(template);
    expect(meta.fastPathEnabled).toBe(true);
    expect(meta.uidOffset).toBe(3);

    // Splice a recognizable UID and verify those bytes appear exactly
    // where the meta says they will.
    const uid = new Uint8Array(16);
    uid.fill(0xab);
    const buf = new Uint8Array(meta.encode(uid));
    expect(buf[1]).toBe(0x0a); // proto field tag 1, wire type 2
    expect(buf[2]).toBe(0x10); // length 16
    for (let i = 0; i < 16; i += 1) {
      expect(buf[meta.uidOffset + i]).toBe(0xab);
    }
  });

  it("fast-path output decodes to the same UID it spliced", () => {
    const meta = prepareBroadcastMessageWithMeta(template);
    const uid = new Uint8Array(16);
    crypto.getRandomValues(uid);
    const buf = new Uint8Array(meta.encode(uid));
    // skip 0x00 codec-frame header before fromBinary
    const decoded = fromBinary(ServerToAgentSchema, buf.slice(1));
    expect(decoded.instanceUid).toEqual(uid);
  });

  it("fast-path falls back to full re-encode when the UID is not 16 bytes", () => {
    // The `instance_uid` field MUST be 16 bytes per spec, but the closure
    // gracefully degrades for callers that pass shorter or longer values.
    const meta = prepareBroadcastMessageWithMeta(template);
    const wrongLengthUid = new Uint8Array(8); // not 16
    wrongLengthUid.fill(0xcd);
    const buf = new Uint8Array(meta.encode(wrongLengthUid));
    const decoded = fromBinary(ServerToAgentSchema, buf.slice(1));
    expect(decoded.instanceUid).toEqual(wrongLengthUid);
  });
});
