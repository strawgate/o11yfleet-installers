import { describe, it, expect } from "vitest";
import { base64urlEncode, base64urlDecode } from "@o11yfleet/core/auth";

describe("base64urlEncode", () => {
  it("encodes empty array to empty string", () => {
    expect(base64urlEncode(new Uint8Array(0))).toBe("");
  });

  it("encodes bytes to base64url without padding", () => {
    expect(base64urlEncode(new Uint8Array([1, 2, 3]))).toBe("AQID");
  });

  it("replaces + with - and / with _", () => {
    const data = new Uint8Array([0xfb, 0xef, 0xbe]);
    expect(base64urlEncode(data)).toBe("----");
  });

  it("omits trailing = padding", () => {
    const data = new Uint8Array([1, 2]);
    const encoded = base64urlEncode(data);
    expect(encoded).not.toContain("=");
  });

  it("encodes full alphabet", () => {
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const result = base64urlEncode(data);
    expect(result).toBe("AAECAwQFBgcICQoLDA0ODw");
  });
});

describe("base64urlDecode", () => {
  it("decodes empty string to empty array", () => {
    expect(base64urlDecode("")).toEqual(new Uint8Array(0));
  });

  it("round-trips with base64urlEncode", () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    expect(base64urlDecode(base64urlEncode(original))).toEqual(original);
  });

  it("decodes base64url with - and _ chars", () => {
    const decoded = base64urlDecode("-_-_");
    expect(decoded).toEqual(new Uint8Array([251, 255, 191]));
  });

  it("handles no padding (4-char group)", () => {
    const decoded = base64urlDecode("AQID");
    expect(decoded).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("handles double padding ==", () => {
    const decoded = base64urlDecode("AQ==");
    expect(decoded).toEqual(new Uint8Array([1]));
  });

  it("handles single padding =", () => {
    const decoded = base64urlDecode("AQI");
    expect(decoded).toEqual(new Uint8Array([1, 2]));
  });

  it("round-trips full alphabet", () => {
    const original = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(base64urlDecode(base64urlEncode(original))).toEqual(original);
  });
});

describe("base64url encode/decode invariants", () => {
  it("encoded output contains no + / or =", () => {
    const testCases = [
      new Uint8Array([0]),
      new Uint8Array([255]),
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array([1, 2, 3, 4, 5]),
    ];
    for (const data of testCases) {
      const encoded = base64urlEncode(data);
      expect(encoded).not.toMatch(/[+/=]/);
    }
  });

  it("decoding encoded data produces original bytes", () => {
    const testCases = [
      new Uint8Array([]),
      new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      new Uint8Array([0xfb, 0xef, 0xbe, 0xff]),
    ];
    for (const data of testCases) {
      expect(base64urlDecode(base64urlEncode(data))).toEqual(data);
    }
  });
});
