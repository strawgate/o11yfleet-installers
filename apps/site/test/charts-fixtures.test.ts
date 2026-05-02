import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSeries, generateSeriesGroup } from "../src/charts/fixtures/generators";

const range = { from: 0, to: 3_600_000 };

test("generateSeries: count=0 yields empty data", () => {
  const s = generateSeries("x", { range, count: 0 });
  assert.deepEqual(s.data, []);
});

test("generateSeries: count=1 yields single point at range.from", () => {
  const s = generateSeries("x", { range, count: 1, seed: 7 });
  assert.equal(s.data.length, 1);
  assert.equal(s.data[0]?.[0], range.from);
});

test("generateSeries: deterministic given a seed", () => {
  const a = generateSeries("a", { range, count: 50, seed: 42 });
  const b = generateSeries("b", { range, count: 50, seed: 42 });
  assert.deepEqual(a.data, b.data);
});

test("generateSeries: respects min/max clamps", () => {
  const s = generateSeries("x", { range, count: 1000, min: 0, max: 100, seed: 1 });
  for (const [, v] of s.data) {
    if (v == null) continue;
    assert.ok(v >= 0 && v <= 100, `out of range: ${v}`);
  }
});

test("generateSeries: gaps land at the requested cadence", () => {
  const s = generateSeries("x", { range, count: 100, gapEvery: 10, seed: 1 });
  const nullIdxs = s.data.map(([, v], i) => (v == null ? i : -1)).filter((i) => i >= 0);
  // First gap is at index 10 (0 is never a gap), 20, 30, ...
  assert.deepEqual(nullIdxs, [10, 20, 30, 40, 50, 60, 70, 80, 90]);
});

test("generateSeriesGroup: per-series seeds differ but each is reproducible", () => {
  const a = generateSeriesGroup({
    range,
    count: 30,
    seedBase: 100,
    series: [{ name: "p" }, { name: "q" }],
  });
  const b = generateSeriesGroup({
    range,
    count: 30,
    seedBase: 100,
    series: [{ name: "p" }, { name: "q" }],
  });
  assert.deepEqual(a, b);
  // Values should differ between p and q because their seeds differ.
  assert.notDeepEqual(a[0]?.data, a[1]?.data);
});
