/**
 * Failing-test harness for the performance audit (docs/performance/audit-2026-04.md).
 *
 * Each `describe.skip` block asserts a budget that the current implementation
 * breaches and that a straightforward fix would satisfy. Remove `.skip` after
 * fixing the corresponding issue — the test then becomes a regression gate.
 *
 * To reproduce a failing run today:
 *   1. Change `describe.skip` to `describe` for the issue you want to verify.
 *   2. `pnpm --filter @o11yfleet/core test perf-audit`
 *
 * They are skipped by default so the standard `pnpm test` gate stays green.
 */

import { describe, it, expect } from "vitest";
import { encodeFrame, decodeFrame } from "../src/codec/framing.js";
import { hexToUint8Array, uint8ToHex } from "../src/hex.js";
import type { AgentToServer } from "../src/codec/types.js";
import { AgentCapabilities } from "../src/codec/types.js";

// ─── Issue #2 — encodeFrame byte explosion via Array.from(Uint8Array) ─────
//
// Today the JSON codec serializes every Uint8Array byte as a decimal JSON
// number, plus a `__type:"bytes"` wrapper. A 16-byte instance_uid alone
// becomes ~80 chars on the wire. Base64url would be ~22 chars. This budget
// fails today and passes after switching to base64url.

describe.skip("perf-audit: codec/framing Uint8Array compactness", () => {
  it("encodes a 16-byte instance_uid in ≤ 40 wire bytes of overhead", () => {
    const msg: AgentToServer = {
      instance_uid: new Uint8Array(16).fill(0xab),
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };

    const buf = encodeFrame(msg);
    // Encoded frame layout: [4-byte length][JSON]. The fields apart from
    // instance_uid contribute a small constant. We require that the bytes
    // attributable to instance_uid encoding stay near base64url density:
    // a sane implementation lands around 20–30 chars; the current one
    // produces ~80+. Budget: 40.
    const totalBytes = buf.byteLength;

    // Reference baseline: encode the same message with instance_uid set to a
    // single 0-length Uint8Array — the delta tells us the per-uid cost.
    const baseline = encodeFrame({
      ...msg,
      instance_uid: new Uint8Array(0),
    });

    const uidCostBytes = totalBytes - baseline.byteLength;
    expect(uidCostBytes).toBeLessThanOrEqual(40);
  });

  it("encoded frame round-trips bit-identical bytes regardless of representation", () => {
    // Round-trip safety should survive the fix.
    const msg: AgentToServer = {
      instance_uid: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
      sequence_num: 99,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    const round = decodeFrame<AgentToServer>(encodeFrame(msg));
    expect(round.instance_uid).toBeInstanceOf(Uint8Array);
    expect(Array.from(round.instance_uid)).toEqual(Array.from(msg.instance_uid));
    expect(round.sequence_num).toBe(99);
  });
});

// ─── Issues #29 / #30 — hex utility throughput ────────────────────────────
//
// `hexToUint8Array` uses `parseInt(hex.substring(...))` per byte and
// `uint8ToHex` uses Array.from + map + join. A simple 256-entry lookup
// implementation is multiple times faster. We assert a generous budget
// that the current implementation fails.

describe.skip("perf-audit: hex utility throughput", () => {
  // Build a 32-byte input (typical SHA-256 hash size).
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) & 0xff;
  const hex = uint8ToHex(bytes);

  it("uint8ToHex completes 100K calls within 100 ms", () => {
    // Warmup to absorb JIT compilation noise.
    for (let i = 0; i < 10_000; i++) uint8ToHex(bytes);
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) uint8ToHex(bytes);
    const elapsed = performance.now() - start;
    // Lookup-table implementations on Node 20+ run this in ~15 ms.
    // Current implementation is well above 100 ms.
    expect(elapsed).toBeLessThan(100);
  });

  it("hexToUint8Array completes 100K calls within 100 ms", () => {
    // Warmup to absorb JIT compilation noise.
    for (let i = 0; i < 10_000; i++) hexToUint8Array(hex);
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) hexToUint8Array(hex);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

// ─── Issue #46 — decodeFrame reviver runs per value ────────────────────────
//
// Decoding a deeply-nested AgentToServer (rich agent_description) shouldn't
// be more than a few × the cost of decoding a flat one of the same byte
// size, because the only `__type:"bytes"` value is instance_uid. The
// current per-value reviver makes the gap larger than necessary.

describe.skip("perf-audit: decodeFrame reviver overhead", () => {
  it("decodes a deeply nested message within 3× a flat-equivalent message", () => {
    const flat: AgentToServer = {
      instance_uid: new Uint8Array(16).fill(1),
      sequence_num: 1,
      capabilities: 0,
      flags: 0,
    };
    // Build a nested agent_description with ~200 attributes.
    const nested: AgentToServer = {
      ...flat,
      agent_description: {
        identifying_attributes: Array.from({ length: 200 }, (_, i) => ({
          key: `attr_${i}`,
          value: { string_value: `value_${i}` },
        })),
        non_identifying_attributes: [],
      },
    };

    const flatBuf = encodeFrame(flat);
    const nestedBuf = encodeFrame(nested);

    // Warm up.
    for (let i = 0; i < 100; i++) {
      decodeFrame(flatBuf);
      decodeFrame(nestedBuf);
    }

    const ITER = 5_000;
    const measure = (buf: ArrayBuffer): { msPerKB: number } => {
      const start = performance.now();
      for (let i = 0; i < ITER; i++) decodeFrame(buf);
      const elapsed = performance.now() - start;
      const totalKB = (buf.byteLength * ITER) / 1024;
      return { msPerKB: elapsed / Math.max(totalKB, 1) };
    };
    const flatMetrics = measure(flatBuf);
    const nestedMetrics = measure(nestedBuf);
    // Normalize by payload size so the ratio measures reviver overhead per
    // byte, not raw byte throughput. After the fix (one walk after parse)
    // the ratio stays near 1×; today the per-value reviver pushes it well
    // above 3×.
    const ratio = nestedMetrics.msPerKB / Math.max(flatMetrics.msPerKB, 0.0001);
    expect(ratio).toBeLessThan(3);
  });
});
