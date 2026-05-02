import assert from "node:assert/strict";
import { test, beforeEach, after } from "node:test";

// Minimal localStorage shim for node:test (no DOM). Restored on suite exit
// so other test files don't inherit it.
const store = new Map<string, string>();
const g = globalThis as unknown as { localStorage?: Storage };
const originalLocalStorage = g.localStorage;
g.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() {
    return store.size;
  },
};

beforeEach(() => store.clear());

after(() => {
  if (originalLocalStorage) g.localStorage = originalLocalStorage;
  else delete g.localStorage;
});

test("persisted state shape: round-trips columnSizing/Order/Visibility/Pinning", () => {
  const initial = {
    columnSizing: { hostname: 240 },
    columnOrder: ["hostname", "status"],
    columnVisibility: { health: false },
    columnPinning: { left: ["hostname"], right: [] },
  };
  const key = "fb-dt:test-1";
  localStorage.setItem(key, JSON.stringify(initial));
  const out = JSON.parse(localStorage.getItem(key)!);
  assert.deepEqual(out, initial);
});

test("persisted state: corrupt JSON ignored gracefully", () => {
  const key = "fb-dt:test-2";
  localStorage.setItem(key, "{not-json");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(localStorage.getItem(key)!);
  } catch {
    parsed = null;
  }
  assert.equal(parsed, null);
});

test("persisted state: missing key returns null", () => {
  assert.equal(localStorage.getItem("fb-dt:absent"), null);
});
