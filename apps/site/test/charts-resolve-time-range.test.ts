import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RELATIVE_PRESETS,
  presetLabel,
  presetSpan,
  resolveTimeRange,
} from "../src/charts/resolveTimeRange";

test("resolveTimeRange: relative anchors to `now` and produces matching span", () => {
  const now = 1_700_000_000_000;
  const r = resolveTimeRange({ kind: "relative", preset: "24h" }, now);
  assert.equal(r.to, now);
  assert.equal(r.to - r.from, 24 * 3_600_000);
});

test("resolveTimeRange: absolute is pass-through", () => {
  const r = resolveTimeRange({ kind: "absolute", from: 1, to: 100 });
  assert.deepEqual(r, { from: 1, to: 100 });
});

test("presetSpan: 1h → 1 hour ms", () => {
  assert.equal(presetSpan("1h"), 3_600_000);
});

test("presetSpan: 90d → 90 days ms", () => {
  assert.equal(presetSpan("90d"), 90 * 24 * 3_600_000);
});

test("RELATIVE_PRESETS: ascending span order", () => {
  const spans = RELATIVE_PRESETS.map(presetSpan);
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1] ?? 0;
    const cur = spans[i] ?? 0;
    assert.ok(cur > prev, `presets out of order at index ${i}`);
  }
});

test("presetLabel: human strings for every preset", () => {
  for (const p of RELATIVE_PRESETS) {
    const label = presetLabel(p);
    assert.match(label, /^Last/, `preset ${p} label should start with Last`);
  }
});
