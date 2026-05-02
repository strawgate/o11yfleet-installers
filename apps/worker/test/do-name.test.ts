// Pure tests for the Config DO name parser. No DO setup needed.

import { describe, expect, it } from "vitest";
import {
  parseConfigDoName,
  safeForLog,
  type ParseConfigDoNameError,
} from "../src/durable-objects/do-name.js";

describe("parseConfigDoName", () => {
  type Case = {
    name: string;
    input: string | undefined;
    expected:
      | { ok: true; tenant_id: string; config_id: string }
      | { ok: false; error: ParseConfigDoNameError };
  };

  const cases: Case[] = [
    {
      name: "tenant + config_id",
      input: "tenant-abc:config-xyz",
      expected: { ok: true, tenant_id: "tenant-abc", config_id: "config-xyz" },
    },
    {
      name: "the special pending DO name",
      input: "tenant-abc:__pending__",
      expected: { ok: true, tenant_id: "tenant-abc", config_id: "__pending__" },
    },
    {
      name: "splits on first colon (config_id can contain colons)",
      input: "t:a:b:c",
      expected: { ok: true, tenant_id: "t", config_id: "a:b:c" },
    },
    {
      name: "uuid-shaped components",
      input: "550e8400-e29b-41d4-a716-446655440000:6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      expected: {
        ok: true,
        tenant_id: "550e8400-e29b-41d4-a716-446655440000",
        config_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      },
    },
    { name: "undefined input", input: undefined, expected: { ok: false, error: "missing_name" } },
    { name: "empty string", input: "", expected: { ok: false, error: "missing_name" } },
    {
      name: "no colon separator",
      input: "no-colon-here",
      expected: { ok: false, error: "missing_separator" },
    },
    {
      name: "leading colon (empty tenant)",
      input: ":config-xyz",
      expected: { ok: false, error: "empty_tenant_id" },
    },
    {
      name: "trailing colon (empty config)",
      input: "tenant-abc:",
      expected: { ok: false, error: "empty_config_id" },
    },
    { name: "just a colon", input: ":", expected: { ok: false, error: "empty_tenant_id" } },
    {
      name: "name longer than the cap",
      input: `t:${"x".repeat(300)}`,
      expected: { ok: false, error: "name_too_long" },
    },
  ];

  it.each(cases)("$name", ({ input, expected }) => {
    const result = parseConfigDoName(input);
    if (expected.ok) {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.identity).toEqual({
          tenant_id: expected.tenant_id,
          config_id: expected.config_id,
        });
      }
    } else {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(expected.error);
      }
    }
  });
});

describe("safeForLog", () => {
  it("returns short strings unchanged", () => {
    expect(safeForLog("hello")).toBe("hello");
  });

  it("represents missing input distinctly from empty", () => {
    expect(safeForLog(undefined)).toBe("<missing>");
    expect(safeForLog("")).toBe("<empty>");
  });

  it("truncates long strings and reports the original length", () => {
    const out = safeForLog("x".repeat(200), 20);
    expect(out.startsWith("xxxxxxxxxxxxxxxxxxxx…")).toBe(true);
    expect(out).toContain("(200 chars)");
  });

  // Boundary case — at exactly maxLen the input must NOT be truncated.
  // Catches a `>` vs `>=` mutation in the truncation guard.
  it("does not truncate strings of exactly maxLen", () => {
    const exact = "x".repeat(20);
    expect(safeForLog(exact, 20)).toBe(exact);
  });

  it("does truncate strings of maxLen + 1", () => {
    const overByOne = "x".repeat(21);
    expect(safeForLog(overByOne, 20)).toContain("…(21 chars)");
  });
});

// Boundary cases for the name-length cap — catches `>` vs `>=` mutations.
describe("parseConfigDoName boundary at MAX_NAME_LENGTH", () => {
  it("accepts a name of exactly 200 chars", () => {
    // `t:${198 x's}` = 200 chars total
    const name = `t:${"x".repeat(198)}`;
    expect(name.length).toBe(200);
    const result = parseConfigDoName(name);
    expect(result.ok).toBe(true);
  });

  it("rejects a name of 201 chars", () => {
    const name = `t:${"x".repeat(199)}`;
    expect(name.length).toBe(201);
    const result = parseConfigDoName(name);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("name_too_long");
  });
});
