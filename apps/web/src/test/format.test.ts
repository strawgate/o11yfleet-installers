import { describe, it, expect } from "vitest";
import { relativeTime, truncate, clamp } from "../lib/format";

describe("format utilities", () => {
  it("truncate shortens long strings", () => {
    expect(truncate("hello world", 5)).toBe("hello…");
    expect(truncate("hi", 5)).toBe("hi");
  });

  it("clamp constrains values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("relativeTime returns a string", () => {
    const result = relativeTime(new Date().toISOString());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
