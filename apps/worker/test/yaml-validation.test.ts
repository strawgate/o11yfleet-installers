import { describe, it, expect } from "vitest";
import { validateYaml } from "../src/config-store.js";

describe("validateYaml", () => {
  it("returns null for valid YAML mapping", () => {
    expect(validateYaml("key: value\n")).toBeNull();
  });

  it("returns null for nested YAML", () => {
    expect(
      validateYaml("receivers:\n  otlp:\n    protocols:\n      grpc:\n"),
    ).toBeNull();
  });

  it("returns error for invalid YAML syntax", () => {
    const err = validateYaml("key: [not: valid: yaml:");
    expect(err).toBeTruthy();
    expect(typeof err).toBe("string");
  });

  it("returns error for scalar string", () => {
    const err = validateYaml("just a plain string");
    expect(err).toBeTruthy();
    expect(err).toContain("mapping");
  });

  it("returns error for null YAML", () => {
    const err = validateYaml("null");
    expect(err).toBeTruthy();
  });

  it("returns error for numeric YAML", () => {
    const err = validateYaml("42");
    expect(err).toBeTruthy();
  });

  it("returns null for array (object type)", () => {
    // Arrays are typeof 'object' in JS, which is acceptable as config
    expect(validateYaml("- item1\n- item2\n")).toBeNull();
  });
});
