import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bucketCount,
  rangeMs,
  resolutionToSeconds,
  selectResolution,
} from "../src/charts/selectResolution";

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

test("selectResolution: 1h → 15s", () => {
  assert.equal(selectResolution(HOUR_MS), "15s");
  assert.equal(selectResolution(HOUR_MS - 1), "15s");
});

test("selectResolution: 6h → 1m", () => {
  assert.equal(selectResolution(2 * HOUR_MS), "1m");
  assert.equal(selectResolution(6 * HOUR_MS), "1m");
});

test("selectResolution: 24h → 5m", () => {
  assert.equal(selectResolution(12 * HOUR_MS), "5m");
  assert.equal(selectResolution(DAY_MS), "5m");
});

test("selectResolution: 7d → 15m", () => {
  assert.equal(selectResolution(2 * DAY_MS), "15m");
  assert.equal(selectResolution(7 * DAY_MS), "15m");
});

test("selectResolution: 30d → 1h", () => {
  assert.equal(selectResolution(15 * DAY_MS), "1h");
  assert.equal(selectResolution(30 * DAY_MS), "1h");
});

test("selectResolution: 90d → 6h", () => {
  assert.equal(selectResolution(60 * DAY_MS), "6h");
  assert.equal(selectResolution(90 * DAY_MS), "6h");
  assert.equal(selectResolution(180 * DAY_MS), "6h");
});

test("selectResolution: zero or negative → 15s (defensive)", () => {
  assert.equal(selectResolution(0), "15s");
  assert.equal(selectResolution(-1), "15s");
});

test("resolutionToSeconds: covers every variant", () => {
  assert.equal(resolutionToSeconds("15s"), 15);
  assert.equal(resolutionToSeconds("1m"), 60);
  assert.equal(resolutionToSeconds("5m"), 300);
  assert.equal(resolutionToSeconds("15m"), 900);
  assert.equal(resolutionToSeconds("1h"), 3600);
  assert.equal(resolutionToSeconds("6h"), 21_600);
});

test("rangeMs: simple subtraction", () => {
  assert.equal(rangeMs({ from: 1000, to: 5000 }), 4000);
});

test("bucketCount: 1h @ 15s → ≤240 (and ≥1)", () => {
  const c = bucketCount({ from: 0, to: HOUR_MS }, "15s");
  assert.ok(c >= 1 && c <= 240, `expected 1..240, got ${c}`);
});

test("bucketCount: 90d @ 6h → ≤360", () => {
  const c = bucketCount({ from: 0, to: 90 * DAY_MS }, "6h");
  assert.ok(c <= 360 + 1, `expected ≤360, got ${c}`);
});

test("selected resolution stays under target bucket count across the supported range domain", () => {
  // Cap at 90d — this matches Analytics Engine retention. Beyond 90d the
  // function continues to return "6h" without further coarsening, so the
  // bucket count would grow unboundedly; we don't query beyond retention.
  let max = 0;
  for (let i = 0; i < 500; i++) {
    const r = MIN_MS + Math.random() * (90 * DAY_MS - MIN_MS);
    const res = selectResolution(r);
    const buckets = bucketCount({ from: 0, to: r }, res);
    if (buckets > max) max = buckets;
  }
  // 720 = 30d at 1h. Allow that ceiling but no further within retention.
  assert.ok(max <= 730, `expected ≤730 buckets in worst case within 90d, got ${max}`);
});

test("selectResolution: ranges past 90d retention boundary still return 6h floor", () => {
  // Documents the current behaviour: above 90d we keep using 6h. Caller is
  // responsible for not querying beyond retention.
  const YEAR_MS = 365 * DAY_MS;
  assert.equal(selectResolution(YEAR_MS), "6h");
});
