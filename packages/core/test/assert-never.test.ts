import { describe, it, expect } from "vitest";
import { assertNever } from "@o11yfleet/core/assert-never";

describe("assertNever", () => {
  it("throws with default message for string value", () => {
    expect(() => assertNever("unknown" as never)).toThrow("Unexpected value: unknown");
  });

  it("throws with custom message when provided", () => {
    expect(() => assertNever(42 as never, "Must be a string")).toThrow("Must be a string");
  });

  it("throws for number variant in string-expected union", () => {
    expect(() => assertNever(123 as never)).toThrow("Unexpected value: 123");
  });

  it("throws for object variant", () => {
    expect(() => assertNever({ type: "unknown" } as never)).toThrow(
      "Unexpected value: [object Object]",
    );
  });
});
