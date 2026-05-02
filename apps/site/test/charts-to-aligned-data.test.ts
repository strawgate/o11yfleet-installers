import assert from "node:assert/strict";
import { test } from "node:test";
import { toAlignedData } from "../src/charts/toAlignedData";
import type { Series } from "../src/charts/types";

test("toAlignedData: empty input returns single empty x array", () => {
  const out = toAlignedData([]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], []);
});

test("toAlignedData: single series passes through ts/value pairs (in seconds)", () => {
  const series: Series[] = [
    {
      name: "a",
      data: [
        [1000, 10],
        [2000, 20],
        [3000, 30],
      ],
    },
  ];
  const out = toAlignedData(series);
  assert.deepEqual(out[0], [1, 2, 3]);
  assert.deepEqual(out[1], [10, 20, 30]);
});

test("toAlignedData: two series with shared timestamps stay aligned", () => {
  const ts = [1000, 2000, 3000];
  const a: Series = { name: "a", data: ts.map((t, i) => [t, i + 1]) };
  const b: Series = { name: "b", data: ts.map((t, i) => [t, (i + 1) * 10]) };
  const out = toAlignedData([a, b]);
  assert.deepEqual(out[0], [1, 2, 3]);
  assert.deepEqual(out[1], [1, 2, 3]);
  assert.deepEqual(out[2], [10, 20, 30]);
});

test("toAlignedData: differing timestamps unioned, gaps become null", () => {
  const a: Series = {
    name: "a",
    data: [
      [1000, 1],
      [2000, 2],
    ],
  };
  const b: Series = {
    name: "b",
    data: [
      [2000, 20],
      [3000, 30],
    ],
  };
  const out = toAlignedData([a, b]);
  assert.deepEqual(out[0], [1, 2, 3]);
  assert.deepEqual(out[1], [1, 2, null]);
  assert.deepEqual(out[2], [null, 20, 30]);
});

test("toAlignedData: explicit nulls preserved as gaps (not interpolated)", () => {
  const a: Series = {
    name: "a",
    data: [
      [1000, 1],
      [2000, null],
      [3000, 3],
    ],
  };
  const out = toAlignedData([a]);
  assert.deepEqual(out[1], [1, null, 3]);
});

test("toAlignedData: x values strictly ascending after merge", () => {
  // Out-of-order input — should be sorted on output.
  const a: Series = {
    name: "a",
    data: [
      [3000, 30],
      [1000, 10],
      [2000, 20],
    ],
  };
  const out = toAlignedData([a]);
  const xs = out[0] as number[];
  for (let i = 1; i < xs.length; i++) {
    const prev = xs[i - 1] ?? 0;
    const cur = xs[i] ?? 0;
    assert.ok(cur > prev);
  }
});
