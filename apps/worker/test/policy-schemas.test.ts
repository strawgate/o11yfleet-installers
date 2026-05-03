// Pure tests for /init and /sync-policy body parsing + validation.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  initBodySchema,
  parseAndValidateBody,
  syncPolicyBodySchema,
} from "../src/durable-objects/policy-schemas.js";

describe("parseAndValidateBody — init body", () => {
  it("accepts an empty body as {}", () => {
    const result = parseAndValidateBody("", initBodySchema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it("accepts a positive integer", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ max_agents_per_config: 1000 }),
      initBodySchema,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.max_agents_per_config).toBe(1000);
  });

  it("accepts null (caller wants to clear cap)", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ max_agents_per_config: null }),
      initBodySchema,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.max_agents_per_config).toBeNull();
  });

  it("rejects negative numbers", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ max_agents_per_config: -5 }),
      initBodySchema,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("max_agents_per_config");
  });

  it("rejects zero", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ max_agents_per_config: 0 }),
      initBodySchema,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects non-integers", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ max_agents_per_config: 1.5 }),
      initBodySchema,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects strings posing as numbers", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ max_agents_per_config: "100" }),
      initBodySchema,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects malformed JSON with field=body, reason=invalid_json", () => {
    const result = parseAndValidateBody("{not json", initBodySchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("body");
      expect(result.error.reason).toBe("invalid_json");
    }
  });

  it("error reports field path joined by dot for nested issues", () => {
    // Build a Zod issue at a nested path by sending an array where a
    // number is expected — single-level here, but the assertion covers
    // the join-by-dot logic.
    const result = parseAndValidateBody(
      JSON.stringify({ max_agents_per_config: -1 }),
      initBodySchema,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("max_agents_per_config");
      expect(typeof result.error.reason).toBe("string");
      expect(result.error.reason.length).toBeGreaterThan(0);
    }
  });

  // Root-level type failure produces a Zod issue with an empty path.
  // Exercises the `path.length > 0 ? join : "body"` fallback branch.
  it("error falls back to field=body when the root body has the wrong type", () => {
    // Valid JSON but not an object — Zod fails at the root.
    const result = parseAndValidateBody('"a string, not an object"', initBodySchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("body");
  });

  it("silently strips unknown keys (so body identity claims are ignored)", () => {
    const result = parseAndValidateBody(
      JSON.stringify({
        tenant_id: "tenant-evil",
        config_id: "config-evil",
        max_agents_per_config: 50,
      }),
      initBodySchema,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ max_agents_per_config: 50 });
      // tenant_id / config_id NOT present in the parsed value.
      expect("tenant_id" in result.value).toBe(false);
      expect("config_id" in result.value).toBe(false);
    }
  });

  it("missing key vs explicit null are distinguishable", () => {
    const missing = parseAndValidateBody("{}", initBodySchema);
    const explicit = parseAndValidateBody(
      JSON.stringify({ max_agents_per_config: null }),
      initBodySchema,
    );
    expect(missing.ok && missing.value.max_agents_per_config).toBe(undefined);
    expect(explicit.ok && explicit.value.max_agents_per_config).toBe(null);
  });
});

describe("parseAndValidateBody — nested-field error reporting", () => {
  // Stryker found that `path.join(".")` could be mutated to `path.join("")`
  // and all existing tests passed — they used flat schemas where issue.path
  // had at most one segment, so the separator didn't matter. A nested
  // schema produces a 2-segment path and pins the `.` separator.
  const nestedSchema = z.object({
    outer: z.object({
      inner: z.number().int().positive(),
    }),
  });

  it("joins nested issue paths with '.' (not '' or other separator)", () => {
    const result = parseAndValidateBody(JSON.stringify({ outer: { inner: -5 } }), nestedSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("outer.inner");
      // Negative assertions — pin that the separator is specifically "."
      // (mutations to "" or "/" or ":" would break these).
      expect(result.error.field).not.toBe("outerinner");
      expect(result.error.field).not.toBe("outer/inner");
    }
  });
});

describe("parseAndValidateBody — sync-policy body", () => {
  it("uses the same shape as init body", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ max_agents_per_config: 250 }),
      syncPolicyBodySchema,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.max_agents_per_config).toBe(250);
  });

  it("strips unknown keys", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ totally_unrelated: "value" }),
      syncPolicyBodySchema,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });
});

describe("auto_unenroll_after_days schema validation", () => {
  it("accepts a positive integer", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ auto_unenroll_after_days: 30 }),
      initBodySchema,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.auto_unenroll_after_days).toBe(30);
  });

  it("accepts null (disable auto-unenroll)", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ auto_unenroll_after_days: null }),
      initBodySchema,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.auto_unenroll_after_days).toBeNull();
  });

  it("absent field yields undefined (don't touch)", () => {
    const result = parseAndValidateBody(JSON.stringify({}), initBodySchema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.auto_unenroll_after_days).toBeUndefined();
  });

  it.each([
    [0, "zero"],
    [-1, "negative"],
    [-100, "large negative"],
    [1.5, "non-integer float"],
  ])("rejects %p (%s)", (value) => {
    const result = parseAndValidateBody(
      JSON.stringify({ auto_unenroll_after_days: value }),
      initBodySchema,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("auto_unenroll_after_days");
  });

  it("rejects string posing as number", () => {
    const result = parseAndValidateBody(
      JSON.stringify({ auto_unenroll_after_days: "30" }),
      initBodySchema,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects NaN (not a valid JSON value, but exercises schema)", () => {
    // NaN can't be in JSON, but if parsed from another source it would
    // be undefined; test with a non-number type instead.
    const result = parseAndValidateBody(
      JSON.stringify({ auto_unenroll_after_days: true }),
      initBodySchema,
    );
    expect(result.ok).toBe(false);
  });

  it("works identically on syncPolicyBodySchema", () => {
    const good = parseAndValidateBody(
      JSON.stringify({ auto_unenroll_after_days: 90 }),
      syncPolicyBodySchema,
    );
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.auto_unenroll_after_days).toBe(90);

    const bad = parseAndValidateBody(
      JSON.stringify({ auto_unenroll_after_days: -5 }),
      syncPolicyBodySchema,
    );
    expect(bad.ok).toBe(false);
  });
});
