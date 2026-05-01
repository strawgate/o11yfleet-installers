// Property-based fuzz tests for the OpAMP codec layer.
// These exercise the untrusted-input boundary: binary data arriving on a WebSocket
// must NEVER cause an unhandled exception, OOM, or infinite loop.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { decodeFrame, encodeFrame } from "../src/codec/framing.js";
import {
  decodeAgentToServerProto,
  encodeServerToAgentProto,
  isProtobufFrame,
} from "../src/codec/protobuf.js";
import {
  decodeAgentToServer,
  encodeServerToAgent,
  detectCodecFormat,
} from "../src/codec/decoder.js";
import type { AgentToServer, ServerToAgent } from "../src/codec/types.js";
import { AgentCapabilities, ServerToAgentFlags, RemoteConfigStatuses } from "../src/codec/types.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

const arbBytes = (min = 0, max = 256) => fc.uint8Array({ minLength: min, maxLength: max });

/** Generates arbitrary bytes that could be anything */
const arbRawBytes = arbBytes(0, 1024);

/** Generates a structurally-valid AgentToServer with random field combinations */
const arbAgentToServer: fc.Arbitrary<AgentToServer> = fc.record({
  instance_uid: fc.uint8Array({ minLength: 16, maxLength: 16 }),
  sequence_num: fc.nat({ max: 2 ** 31 }),
  capabilities: fc.nat({ max: 0xffff }),
  flags: fc.nat({ max: 0xff }),
  health: fc.option(
    fc.record({
      healthy: fc.boolean(),
      start_time_unix_nano: fc.bigInt({ min: 0n, max: 2n ** 63n - 1n }),
      last_error: fc.string({ maxLength: 200 }),
      status: fc.string({ minLength: 0, maxLength: 30 }),
      status_time_unix_nano: fc.bigInt({ min: 0n, max: 2n ** 63n - 1n }),
      component_health_map: fc.constant({} as Record<string, unknown>),
    }),
    { nil: undefined },
  ),
  agent_description: fc.option(
    fc.record({
      identifying_attributes: fc.array(
        fc.record({
          key: fc.string({ maxLength: 50 }),
          value: fc.record({ string_value: fc.string({ maxLength: 100 }) }),
        }),
        { maxLength: 10 },
      ),
      non_identifying_attributes: fc.array(
        fc.record({
          key: fc.string({ maxLength: 50 }),
          value: fc.record({ string_value: fc.string({ maxLength: 100 }) }),
        }),
        { maxLength: 10 },
      ),
    }),
    { nil: undefined },
  ),
  remote_config_status: fc.option(
    fc.record({
      last_remote_config_hash: fc.uint8Array({ minLength: 32, maxLength: 32 }),
      status: fc.constantFrom(
        RemoteConfigStatuses.UNSET,
        RemoteConfigStatuses.APPLIED,
        RemoteConfigStatuses.APPLYING,
        RemoteConfigStatuses.FAILED,
      ),
      error_message: fc.string({ maxLength: 200 }),
    }),
    { nil: undefined },
  ),
  effective_config: fc.option(
    fc.record({
      config_map: fc.record({
        config_map: fc.constant({
          "": { body: new Uint8Array(64), content_type: "application/yaml" },
        }),
      }),
    }),
    { nil: undefined },
  ),
  agent_disconnect: fc.option(fc.constant({}), { nil: undefined }),
  connection_settings_status: fc.option(
    fc.record({
      last_connection_settings_hash: fc.uint8Array({ minLength: 32, maxLength: 32 }),
      status: fc.constantFrom(0, 1, 2, 3),
      error_message: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
    }),
    { nil: undefined },
  ),
});

/** Generates a structurally-valid ServerToAgent response */
const arbServerToAgent: fc.Arbitrary<ServerToAgent> = fc.record({
  instance_uid: fc.uint8Array({ minLength: 16, maxLength: 16 }),
  flags: fc.constantFrom(ServerToAgentFlags.Unspecified, ServerToAgentFlags.ReportFullState),
  capabilities: fc.nat({ max: 0xff }),
  heart_beat_interval: fc.option(fc.nat({ max: 7_200_000_000_000 }), { nil: undefined }),
  remote_config: fc.option(
    fc.record({
      config: fc.record({
        config_map: fc.constant({
          "collector.yaml": {
            body: new Uint8Array(128).fill(0x61),
            content_type: "application/yaml",
          },
        }),
      }),
      config_hash: fc.uint8Array({ minLength: 32, maxLength: 32 }),
    }),
    { nil: undefined },
  ),
  agent_identification: fc.option(
    fc.record({ new_instance_uid: fc.uint8Array({ minLength: 16, maxLength: 16 }) }),
    { nil: undefined },
  ),
  connection_settings: fc.option(
    fc.record({
      hash: fc.uint8Array({ minLength: 32, maxLength: 32 }),
      opamp: fc.option(
        fc.record({
          destination_endpoint: fc.option(fc.webUrl(), { nil: undefined }),
          headers: fc.option(
            fc.array(
              fc.record({
                key: fc.string({ maxLength: 30 }),
                value: fc.string({ maxLength: 100 }),
              }),
              { maxLength: 5 },
            ),
            { nil: undefined },
          ),
          heartbeat_interval_seconds: fc.option(fc.nat({ max: 7200 }), { nil: undefined }),
        }),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  ),
  command: fc.option(fc.record({ type: fc.constant(0) }), { nil: undefined }),
  error_response: fc.option(
    fc.record({
      type: fc.constantFrom(0, 1, 2),
      error_message: fc.string({ maxLength: 200 }),
      retry_info: fc.option(
        fc.record({ retry_after_nanoseconds: fc.bigInt({ min: 0n, max: 2n ** 63n - 1n }) }),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  ),
});

// ─── Fuzz Tests: Codec Robustness ───────────────────────────────────────────

describe("codec fuzz — decodeFrame robustness", () => {
  it("never crashes on arbitrary bytes", () => {
    fc.assert(
      fc.property(arbRawBytes, (bytes) => {
        try {
          decodeFrame(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        } catch (e) {
          // Thrown errors are acceptable — crashes/hangs are not.
          // The error must be an Error instance (not undefined/null).
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("never crashes on frames with valid header but garbage payload", () => {
    fc.assert(
      fc.property(fc.nat({ max: 65536 }), arbBytes(0, 512), (declaredLen, payload) => {
        // Build a frame: 4-byte BE header + arbitrary payload
        const buf = new ArrayBuffer(4 + payload.length);
        new DataView(buf).setUint32(0, declaredLen, false);
        new Uint8Array(buf, 4).set(payload);
        try {
          decodeFrame(buf);
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("rejects frames declaring > 256KB payload (DoS protection)", () => {
    const bigLen = 300 * 1024; // 300KB
    const buf = new ArrayBuffer(4 + 10);
    new DataView(buf).setUint32(0, bigLen, false);
    expect(() => decodeFrame(buf)).toThrow(/too large/);
  });
});

describe("codec fuzz — decodeAgentToServerProto robustness", () => {
  it("never crashes on arbitrary bytes", () => {
    fc.assert(
      fc.property(arbRawBytes, (bytes) => {
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        try {
          decodeAgentToServerProto(buf);
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("never crashes on bytes with opamp-go header prefix (0x00)", () => {
    fc.assert(
      fc.property(arbBytes(1, 512), (payload) => {
        // Prepend 0x00 header like opamp-go does
        const buf = new Uint8Array(1 + payload.length);
        buf[0] = 0x00;
        buf.set(payload, 1);
        const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        try {
          decodeAgentToServerProto(arrayBuf);
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("never crashes on truncated JSON-framed messages", () => {
    // encodeFrame produces JSON framing; verify the decoder doesn't crash on truncation
    fc.assert(
      fc.property(arbAgentToServer, fc.double({ min: 0.1, max: 0.9 }), (msg, truncFrac) => {
        const encoded = encodeFrame(msg);
        const full = new Uint8Array(encoded);
        const cutPoint = Math.max(1, Math.floor(full.length * truncFrac));
        const truncated = full.slice(0, cutPoint).buffer;
        try {
          decodeFrame(truncated);
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("never crashes on truncated protobuf bytes", () => {
    // Hand-crafted AgentToServer protobuf bytes, then truncated
    // Hand-encoded minimal AgentToServer protobuf:
    // field 1 (instance_uid, wire type 2): tag=0x0a, length=0x10, 16×0x42
    // field 4 (capabilities, wire type 0): tag=0x20, varint=0x07
    const validAgentToServerProto = new Uint8Array([
      0x0a, 0x10, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42,
      0x42, 0x42, 0x42, 0x20, 0x07,
    ]);
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 0.9 }), (truncFrac) => {
        const cutPoint = Math.max(1, Math.floor(validAgentToServerProto.length * truncFrac));
        const truncated = validAgentToServerProto.slice(0, cutPoint).buffer;
        try {
          decodeAgentToServerProto(truncated);
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("codec fuzz — isProtobufFrame detection", () => {
  it("always returns boolean for any input", () => {
    fc.assert(
      fc.property(arbRawBytes, (bytes) => {
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const result = isProtobufFrame(buf);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 1000 },
    );
  });

  it("detects JSON frames correctly (round-trip)", () => {
    fc.assert(
      fc.property(arbAgentToServer, (msg) => {
        const frame = encodeFrame(msg);
        expect(isProtobufFrame(frame)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("empty buffer returns false", () => {
    expect(isProtobufFrame(new ArrayBuffer(0))).toBe(false);
  });
});

describe("codec fuzz — detectCodecFormat + decodeAgentToServer unified", () => {
  it("never crashes on arbitrary bytes (the production entry point)", () => {
    fc.assert(
      fc.property(arbRawBytes, (bytes) => {
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        try {
          const format = detectCodecFormat(buf);
          expect(format === "json" || format === "protobuf").toBe(true);
          decodeAgentToServer(buf, format);
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

// ─── Fuzz Tests: Encode-Decode Round-trip ────────────────────────────────────

describe("codec fuzz — JSON round-trip (encode → decode = identity)", () => {
  it("AgentToServer survives JSON encode/decode round-trip", () => {
    fc.assert(
      fc.property(arbAgentToServer, (msg) => {
        const encoded = encodeFrame(msg);
        const decoded = decodeFrame<AgentToServer>(encoded);

        // Core fields must survive round-trip
        expect(decoded.sequence_num).toBe(msg.sequence_num);
        expect(decoded.capabilities).toBe(msg.capabilities);
        expect(decoded.flags).toBe(msg.flags);
        // Uint8Array encoded as {__type:"bytes", data:[...]} — verify it round-trips
        expect(Array.from(decoded.instance_uid)).toEqual(Array.from(msg.instance_uid));
      }),
      { numRuns: 500 },
    );
  });

  it("ServerToAgent survives JSON encode/decode round-trip", () => {
    fc.assert(
      fc.property(arbServerToAgent, (msg) => {
        const encoded = encodeFrame(msg);
        const decoded = decodeFrame<ServerToAgent>(encoded);

        expect(decoded.flags).toBe(msg.flags);
        expect(decoded.capabilities).toBe(msg.capabilities);
        expect(Array.from(decoded.instance_uid)).toEqual(Array.from(msg.instance_uid));
      }),
      { numRuns: 500 },
    );
  });
});

describe("codec fuzz — Protobuf encode robustness", () => {
  it("encodeServerToAgentProto never crashes on any valid ServerToAgent", () => {
    fc.assert(
      fc.property(arbServerToAgent, (msg) => {
        const result = encodeServerToAgentProto(msg);
        // Must produce a non-empty ArrayBuffer
        expect(result).toBeInstanceOf(ArrayBuffer);
        expect(result.byteLength).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
  });

  it("encodeServerToAgent (both formats) never crashes", () => {
    fc.assert(
      fc.property(
        arbServerToAgent,
        fc.constantFrom("json" as const, "protobuf" as const),
        (msg, format) => {
          const result = encodeServerToAgent(msg, format);
          expect(result).toBeInstanceOf(ArrayBuffer);
          expect(result.byteLength).toBeGreaterThan(0);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ─── Fuzz Tests: Edge Cases & Boundary Conditions ───────────────────────────

describe("codec fuzz — boundary conditions", () => {
  it("handles zero-length instance_uid gracefully", () => {
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(0),
      sequence_num: 1,
      capabilities: 0,
      flags: 0,
    };
    // Should not crash (may throw a validation error but must not panic)
    try {
      const encoded = encodeFrame(msg);
      const decoded = decodeFrame<AgentToServer>(encoded);
      expect(decoded.instance_uid).toBeDefined();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });

  it("handles maximum sequence_num", () => {
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: Number.MAX_SAFE_INTEGER,
      capabilities: 0xffffffff,
      flags: 0xffffffff,
    };
    const encoded = encodeFrame(msg);
    const decoded = decodeFrame<AgentToServer>(encoded);
    expect(decoded.sequence_num).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("handles deeply nested component_health_map", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deepHealth: Record<string, any> = {
      healthy: false,
      start_time_unix_nano: 0n,
      last_error: "deep",
      status: "error",
      status_time_unix_nano: 0n,
      component_health_map: {} as Record<string, unknown>,
    };
    // Create 3 levels deep
    let current = deepHealth;
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const child: Record<string, any> = {
        healthy: true,
        start_time_unix_nano: 0n,
        last_error: "",
        status: "running",
        status_time_unix_nano: 0n,
        component_health_map: {} as Record<string, unknown>,
      };
      current.component_health_map[`level-${i}`] = child;
      current = child;
    }

    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsHealth,
      flags: 0,
      health: deepHealth,
    };
    const encoded = encodeFrame(msg);
    const decoded = decodeFrame<AgentToServer>(encoded);
    expect(decoded.health).toBeDefined();
  });

  it("handles very long error messages", () => {
    const longError = "x".repeat(10000);
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsHealth,
      flags: 0,
      health: {
        healthy: false,
        start_time_unix_nano: 0n,
        last_error: longError,
        status: "error",
        status_time_unix_nano: 0n,
        component_health_map: {},
      },
    };
    const encoded = encodeFrame(msg);
    const decoded = decodeFrame<AgentToServer>(encoded);
    expect(decoded.health!.last_error).toBe(longError);
  });

  it("handles unicode in string fields", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200, unit: "grapheme" }), (unicodeStr) => {
        const msg: AgentToServer = {
          instance_uid: new Uint8Array(16),
          sequence_num: 1,
          capabilities: AgentCapabilities.ReportsHealth,
          flags: 0,
          health: {
            healthy: false,
            start_time_unix_nano: 0n,
            last_error: unicodeStr,
            status: unicodeStr.slice(0, 30),
            status_time_unix_nano: 0n,
            component_health_map: {},
          },
        };
        const encoded = encodeFrame(msg);
        const decoded = decodeFrame<AgentToServer>(encoded);
        expect(decoded.health!.last_error).toBe(unicodeStr);
      }),
      { numRuns: 200 },
    );
  });
});
