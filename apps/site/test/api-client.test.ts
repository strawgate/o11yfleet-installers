import assert from "node:assert/strict";
import { test } from "node:test";
import { stripUrlParam } from "../src/api/strip-url-param";

test("stripUrlParam removes the specified query param and preserves other params", () => {
  const result = stripUrlParam("http://localhost:8787/page?api=foo&other=bar", "api");
  assert.equal(result, "http://localhost:8787/page?other=bar");
});

test("stripUrlParam removes param from URLs with port", () => {
  const result = stripUrlParam("http://127.0.0.1:5173/?api=myapi", "api");
  assert.equal(result, "http://127.0.0.1:5173/");
});

test("stripUrlParam returns original URL when param is absent", () => {
  const result = stripUrlParam("http://localhost:8787/page?other=bar", "api");
  assert.equal(result, "http://localhost:8787/page?other=bar");
});

test("stripUrlParam returns original URL when param is not present", () => {
  const result = stripUrlParam("http://localhost:8787/page", "api");
  assert.equal(result, "http://localhost:8787/page");
});

test("stripUrlParam handles param with no other params", () => {
  const result = stripUrlParam("http://localhost:8787/?api=foo", "api");
  assert.equal(result, "http://localhost:8787/");
});

test("stripUrlParam returns original URL when URL is malformed", () => {
  const result = stripUrlParam("not-a-valid-url?api=foo", "api");
  assert.equal(result, "not-a-valid-url?api=foo");
});
