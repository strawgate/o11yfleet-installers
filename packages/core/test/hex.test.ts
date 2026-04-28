import { describe, it, expect } from "vitest";
import { hexToUint8Array, uint8ToHex } from "@o11yfleet/core/hex";

describe("hexToUint8Array", () => {
  it("converts empty string to empty array", () => {
    expect(hexToUint8Array("")).toEqual(new Uint8Array(0));
  });

  it("converts hex string to bytes", () => {
    const result = hexToUint8Array("deadbeef");
    expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it("pads odd-length hex string with leading zero", () => {
    const result = hexToUint8Array("abc");
    expect(result).toEqual(new Uint8Array([0x0a, 0xbc]));
  });

  it("treats invalid hex characters as 0", () => {
    const result = hexToUint8Array("zzzz");
    expect(result).toEqual(new Uint8Array([0, 0]));
    const result2 = hexToUint8Array("abgh");
    expect(result2).toEqual(new Uint8Array([0xab, 0]));
  });

  it("handles all zeros", () => {
    const result = hexToUint8Array("00000000");
    expect(result).toEqual(new Uint8Array([0, 0, 0, 0]));
  });

  it("handles all ff", () => {
    const result = hexToUint8Array("ffffffff");
    expect(result).toEqual(new Uint8Array([255, 255, 255, 255]));
  });
});

describe("uint8ToHex", () => {
  it("converts empty array to empty string", () => {
    expect(uint8ToHex(new Uint8Array(0))).toBe("");
  });

  it("converts bytes to hex string", () => {
    expect(uint8ToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe("deadbeef");
  });

  it("pads single-digit hex values", () => {
    expect(uint8ToHex(new Uint8Array([0, 1, 2, 15]))).toBe("0001020f");
  });

  it("round-trips with hexToUint8Array", () => {
    const original = "a1b2c3d4e5f6";
    expect(uint8ToHex(hexToUint8Array(original))).toBe(original);
  });
});
