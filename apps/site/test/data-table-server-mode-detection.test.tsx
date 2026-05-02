import assert from "node:assert/strict";
import { test } from "node:test";
import { detectMode } from "../src/components/data-table/mode";

/**
 * Mode detection in the DataTable shell is a pure derivation from which
 * props are passed. We import the production helper so a regression in
 * `DataTable.tsx` can't slip past with a duplicate copy in tests.
 */

test("client-side default: no manual flags when no controlled state", () => {
  const m = detectMode({});
  assert.equal(m.isServerMode, false);
  assert.equal(m.isCursorMode, false);
  assert.equal(m.isOffsetMode, false);
});

test("cursor mode: cursor=null still counts (start of cursor stream)", () => {
  const m = detectMode({ cursor: null });
  assert.equal(m.isCursorMode, true);
  assert.equal(m.isOffsetMode, false);
});

test("offset mode: requires both pagination and pageCount", () => {
  assert.equal(detectMode({ pagination: { pageIndex: 0, pageSize: 10 } }).isOffsetMode, false);
  assert.equal(detectMode({ pageCount: 5 }).isOffsetMode, false);
  assert.equal(
    detectMode({ pagination: { pageIndex: 0, pageSize: 10 }, pageCount: 5 }).isOffsetMode,
    true,
  );
});

test("offset mode: shadowed by cursor mode when both provided", () => {
  const m = detectMode({
    pagination: { pageIndex: 0, pageSize: 10 },
    pageCount: 5,
    cursor: "abc",
  });
  assert.equal(m.isCursorMode, true);
  assert.equal(m.isOffsetMode, false);
});

test("server sorting and filtering flip independent flags", () => {
  const m = detectMode({ sorting: [], filters: [] });
  assert.equal(m.isServerSorting, true);
  assert.equal(m.isServerFiltering, true);
  assert.equal(m.isServerMode, true);
});

test("isServerMode is the OR of all four mode flags", () => {
  for (const partial of [
    { cursor: null },
    { pagination: { pageIndex: 0, pageSize: 10 }, pageCount: 1 },
    { sorting: [] },
    { filters: [] },
  ]) {
    assert.equal(detectMode(partial).isServerMode, true, JSON.stringify(partial));
  }
});
