import assert from "node:assert/strict";
import { test } from "node:test";
import { formatValue, formatTimeTick } from "../src/charts/format";

test("formatValue: nullish → em-dash", () => {
  assert.equal(formatValue(null), "—");
  assert.equal(formatValue(undefined), "—");
  assert.equal(formatValue(NaN), "—");
});

test("formatValue: count compaction (k/M/B)", () => {
  assert.equal(formatValue(500), "500");
  assert.equal(formatValue(15_000), "15.0k");
  assert.equal(formatValue(2_500_000), "2.5M");
  assert.equal(formatValue(7_500_000_000), "7.5B");
});

test("formatValue: bytes ladder", () => {
  assert.equal(formatValue(0, "bytes"), "0.00 B");
  assert.equal(formatValue(1024, "bytes"), "1.00 KB");
  assert.equal(formatValue(1024 * 1024 * 5.5, "bytes"), "5.50 MB");
  assert.equal(formatValue(1024 ** 3 * 2, "bytes"), "2.00 GB");
});

test("formatValue: percent precision matches magnitude", () => {
  assert.equal(formatValue(0.5, "percent"), "0.5%");
  assert.equal(formatValue(15, "percent"), "15%");
});

test("formatValue: duration ladder (μs → d)", () => {
  assert.equal(formatValue(0.0005, "duration"), "500μs");
  assert.equal(formatValue(0.05, "duration"), "50ms");
  assert.equal(formatValue(5, "duration"), "5.00s");
  assert.equal(formatValue(120, "duration"), "2m");
  assert.equal(formatValue(7200, "duration"), "2.0h");
  assert.equal(formatValue(172_800, "duration"), "2.0d");
});

test("formatTimeTick: 1h span uses HH:MM:SS", () => {
  // 2024-06-15 12:34:56 UTC
  const epochSec = 1_718_454_896;
  const out = formatTimeTick(epochSec, 60 * 60);
  assert.match(out, /^\d{2}:\d{2}:\d{2}$/);
});

test("formatTimeTick: 90d span uses MMM DD'YY", () => {
  const epochSec = 1_718_454_896;
  const out = formatTimeTick(epochSec, 90 * 24 * 60 * 60);
  assert.match(out, /^[A-Z][a-z]{2} \d{1,2} '\d{2}$/);
});
