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
 *
 * Note: JSON framing tests (Issue #2, #46) removed per PERF-CRIT-20.
 */

import { describe, it, expect } from "vitest";
import { hexToUint8Array, uint8ToHex } from "../src/hex.js";

// ─── Issues #29 / #30 — hex utility throughput ────────────────────────────

describe.skip("perf-audit: hex utility throughput", () => {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) & 0xff;
  const hex = uint8ToHex(bytes);

  it("uint8ToHex completes 100K calls within 100 ms", () => {
    for (let i = 0; i < 10_000; i++) uint8ToHex(bytes);
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) uint8ToHex(bytes);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it("hexToUint8Array completes 100K calls within 100 ms", () => {
    for (let i = 0; i < 10_000; i++) hexToUint8Array(hex);
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) hexToUint8Array(hex);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
