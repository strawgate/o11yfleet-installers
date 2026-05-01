import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCellValue, getColumnKeys } from "../src/pages/admin/utils/do-table";

test("formatCellValue formats null as NULL", () => {
  assert.equal(formatCellValue(null), "NULL");
});

test("formatCellValue formats undefined as empty string", () => {
  assert.equal(formatCellValue(undefined), "");
});

test("formatCellValue JSON stringifies objects", () => {
  assert.equal(formatCellValue({ nested: true }), '{"nested":true}');
});

test("formatCellValue converts primitives to strings", () => {
  assert.equal(formatCellValue(42), "42");
  assert.equal(formatCellValue("hello"), "hello");
  assert.equal(formatCellValue(true), "true");
});

test("getColumnKeys extracts column names from rows", () => {
  const rows = [
    { id: 1, name: "Alice", active: true },
    { id: 2, name: "Bob", active: false },
  ];
  const keys = getColumnKeys(rows);

  assert.equal(keys.length, 3);
  assert.ok(keys.includes("id"));
  assert.ok(keys.includes("name"));
  assert.ok(keys.includes("active"));
});

test("getColumnKeys handles empty rows array", () => {
  const rows: Array<Record<string, unknown>> = [];
  const keys = getColumnKeys(rows);

  assert.equal(keys.length, 0);
});

test("getColumnKeys uses first row keys", () => {
  const rows = [
    { a: 1, b: 2 },
    { x: 9, y: 10 }, // Different keys - should still use first row
  ];
  const keys = getColumnKeys(rows);

  assert.deepEqual(keys, ["a", "b"]);
});
