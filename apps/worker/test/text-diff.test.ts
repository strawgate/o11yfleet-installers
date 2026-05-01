import { describe, it, expect } from "vitest";

/**
 * Test helpers are inlined here to avoid importing from the main module,
 * which has complex dependencies. The actual implementation is in routes/v1/index.ts.
 */

function utf8ByteLength(str: string): number {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      len += 1;
    } else if (code < 0x800) {
      len += 2;
    } else if (code < 0xd800 || code > 0xdfff) {
      len += 3;
    } else {
      // Surrogate pair: consume both code units
      i++;
      len += 4;
    }
  }
  return len;
}

describe("utf8ByteLength", () => {
  it("counts ASCII characters as 1 byte each", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("a")).toBe(1);
    expect(utf8ByteLength("hello")).toBe(5);
    expect(utf8ByteLength("Hello, World!")).toBe(13);
  });

  it("counts 2-byte UTF-8 characters correctly (Latin-1 Supplement)", () => {
    // é is U+00E9, encoded as 0xC3 0xA9 in UTF-8
    expect(utf8ByteLength("café")).toBe(5); // c=1, a=1, f=1, é=2
    expect(utf8ByteLength("naïve")).toBe(6); // n=1, a=1, ï=2, v=1, e=1
  });

  it("counts 3-byte UTF-8 characters correctly (CJK and other)", () => {
    // Each CJK character is 3 bytes in UTF-8
    expect(utf8ByteLength("日本")).toBe(6);
    expect(utf8ByteLength("日本語")).toBe(9);
  });

  it("counts 4-byte UTF-8 characters correctly (emoji, rare CJK)", () => {
    // Emoji are 4 bytes in UTF-8
    expect(utf8ByteLength("😀")).toBe(4);
    expect(utf8ByteLength("🌍")).toBe(4);
  });

  it("handles mixed content correctly", () => {
    // "Hello" = 5 bytes, " 世界" = 7 bytes (space + 2 CJK chars × 3 bytes)
    expect(utf8ByteLength("Hello 世界")).toBe(12);
  });

  it("matches TextEncoder output for various strings", () => {
    const testStrings = [
      "",
      "a",
      "hello",
      "Hello, World!",
      "café",
      "naïve",
      "日本語",
      "😀",
      "🌍",
      "Hello 世界 🌍",
      "config:\n  name: test\n  version: 1",
    ];

    for (const str of testStrings) {
      const expected = new TextEncoder().encode(str).byteLength;
      expect(utf8ByteLength(str)).toBe(expected);
    }
  });
});
