// Pure-function validator tests. No I/O, no Workers runtime needed.
//
// MVP scope: YAML parses + isn't empty + isn't a top-level array. Real
// validators (schema, fleet-fit, etc.) land in follow-ups; their tests
// will live next to this file.

import { describe, expect, it } from "vitest";
import { validateCollectorConfig } from "../src/github/validate-config.js";

const PATH = "o11yfleet/config.yaml";

describe("validateCollectorConfig — MVP", () => {
  it("succeeds on a parseable mapping", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: "receivers:\n  otlp:\n    protocols:\n      grpc:\n",
    });
    expect(result.conclusion).toBe("success");
    expect(result.annotations).toEqual([]);
  });

  it("fails with a parse-error annotation pointing at the bad line", () => {
    // Unclosed flow sequence — unambiguously a syntax error in YAML.
    const result = validateCollectorConfig({
      path: PATH,
      yaml: "receivers:\n  otlp: [unterminated\n",
    });
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("YAML parse failed");
    expect(result.annotations).toHaveLength(1);
    const a = result.annotations[0]!;
    expect(a.path).toBe(PATH);
    expect(a.level).toBe("failure");
    expect(a.start_line).toBeGreaterThan(0);
    expect(a.message).toContain("YAML parse error");
  });

  it("fails on an empty file (parses to null)", () => {
    const result = validateCollectorConfig({ path: PATH, yaml: "" });
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("Empty");
    expect(result.annotations[0]?.message).toMatch(/empty/i);
  });

  it("fails on a top-level array", () => {
    const result = validateCollectorConfig({
      path: PATH,
      yaml: "- a\n- b\n",
    });
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("mapping");
    expect(result.annotations[0]?.message).toMatch(/mapping/i);
  });

  it("fails on a top-level scalar", () => {
    const result = validateCollectorConfig({ path: PATH, yaml: "just-a-string\n" });
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("mapping");
  });

  it("includes the file path in every annotation so the Check Run renders inline", () => {
    const result = validateCollectorConfig({
      path: "custom/path/to/config.yaml",
      yaml: "[[bad",
    });
    expect(result.annotations.every((a) => a.path === "custom/path/to/config.yaml")).toBe(true);
  });
});
