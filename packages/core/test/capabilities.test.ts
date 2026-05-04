import { describe, it, expect } from "vitest";
import { hasCapability } from "../src/codec/capabilities.js";
import { AgentCapabilities } from "../src/codec/types.js";

describe("hasCapability", () => {
  it("returns true when the bit is set", () => {
    expect(
      hasCapability(AgentCapabilities.AcceptsRemoteConfig, AgentCapabilities.AcceptsRemoteConfig),
    ).toBe(true);
  });

  it("returns false when the bit is not set", () => {
    expect(
      hasCapability(AgentCapabilities.ReportsStatus, AgentCapabilities.AcceptsRemoteConfig),
    ).toBe(false);
  });

  it("handles bits above 31 using bigint math", () => {
    // A capability with bit 33 set (would overflow int32)
    const highBitCapability = Number(2n ** 33n);
    expect(hasCapability(highBitCapability, 1)).toBe(false);
    expect(hasCapability(highBitCapability, highBitCapability)).toBe(true);
  });

  it("detects bit 32 correctly (where int32 would truncate)", () => {
    // Bit 32 = 0x100000000, would truncate to 0 with int32
    const bit32 = 0x100000000;
    // Create a capability that includes bit 32
    const capsWithBit32 = Number(2n ** 32n);
    // hasCapability correctly detects bit 32
    expect(hasCapability(capsWithBit32, bit32)).toBe(true);
    // Direct & would fail: (capsWithBit32 & bit32) === 0 due to int32 truncation
    expect((capsWithBit32 & bit32) === 0).toBe(true); // Int32 truncation
  });

  it("handles combined capabilities", () => {
    const combined =
      AgentCapabilities.AcceptsRemoteConfig | AgentCapabilities.AcceptsRestartCommand;
    expect(hasCapability(combined, AgentCapabilities.AcceptsRemoteConfig)).toBe(true);
    expect(hasCapability(combined, AgentCapabilities.AcceptsRestartCommand)).toBe(true);
    expect(hasCapability(combined, AgentCapabilities.ReportsStatus)).toBe(false);
  });

  it("handles zero capabilities", () => {
    expect(hasCapability(0, AgentCapabilities.AcceptsRemoteConfig)).toBe(false);
  });
});
