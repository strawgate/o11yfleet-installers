import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/api/api-error";
import { getErrorMessage } from "../src/utils/errors";

test("getErrorMessage prefers ApiError.detail when present", () => {
  const err = new ApiError("Forbidden", 403, {
    error: "Forbidden",
    detail: "Workspace already deleted",
  });
  assert.equal(getErrorMessage(err), "Workspace already deleted");
});

test("getErrorMessage falls back to ApiError.message when detail is missing", () => {
  const err = new ApiError("Quota exceeded", 429);
  assert.equal(getErrorMessage(err), "Quota exceeded");
});

test("getErrorMessage uses Error.message for plain Error", () => {
  assert.equal(getErrorMessage(new Error("Network timeout")), "Network timeout");
});

test("getErrorMessage returns the provided fallback for unknown error shapes", () => {
  assert.equal(getErrorMessage(undefined), "Unknown error");
  assert.equal(getErrorMessage(undefined, "Login failed"), "Login failed");
  assert.equal(getErrorMessage(null, "Custom"), "Custom");
  assert.equal(getErrorMessage({ random: true }, "Custom"), "Custom");
});

test("getErrorMessage uses string error directly when non-empty", () => {
  assert.equal(getErrorMessage("explicit message"), "explicit message");
});

test("getErrorMessage returns fallback for empty string", () => {
  assert.equal(getErrorMessage(""), "Unknown error");
});

test("getErrorMessage returns fallback for Error with empty message", () => {
  const err = new Error("");
  assert.equal(getErrorMessage(err, "Failed"), "Failed");
});
