// Property-based tests for the hex codec.
//
// hex.ts is small (two functions, ~15 LOC) but used everywhere we
// translate between protobuf bytes and SQL strings. Round-trip and
// lossless properties are exactly what fast-check is good at.

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { hexToUint8Array, uint8ToHex } from "../src/hex.js";

const byteArb = fc.uint8Array({ minLength: 0, maxLength: 64 });

describe("property: hex round-trip", () => {
  it("uint8 → hex → uint8 is identity", () => {
    fc.assert(
      fc.property(byteArb, (bytes) => {
        const hex = uint8ToHex(bytes);
        const round = hexToUint8Array(hex);
        if (round.length !== bytes.length) return false;
        for (let i = 0; i < bytes.length; i += 1) {
          if (round[i] !== bytes[i]) return false;
        }
        return true;
      }),
    );
  });

  it("uint8ToHex always produces an even-length lowercase string", () => {
    fc.assert(
      fc.property(byteArb, (bytes) => {
        const hex = uint8ToHex(bytes);
        return hex.length === bytes.length * 2 && hex === hex.toLowerCase();
      }),
    );
  });

  it("uint8ToHex output is exactly characters in [0-9a-f]", () => {
    fc.assert(fc.property(byteArb, (bytes) => /^[0-9a-f]*$/.test(uint8ToHex(bytes))));
  });
});

describe("property: hexToUint8Array invariants", () => {
  // Generator for *valid* hex strings of even length.
  const evenHexArb = fc
    .stringMatching(/^[0-9a-f]*$/)
    .filter((s) => s.length % 2 === 0)
    .map((s) => s.toLowerCase());

  it("output length is ⌈input.length / 2⌉", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-f]*$/), (hex) => {
        const expected = Math.ceil(hex.length / 2);
        return hexToUint8Array(hex).length === expected;
      }),
    );
  });

  it("hex → bytes → hex is identity for canonical (even, lowercase) hex", () => {
    fc.assert(fc.property(evenHexArb, (hex) => uint8ToHex(hexToUint8Array(hex)) === hex));
  });

  it("never throws on arbitrary string input (treats invalid chars as 0)", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        hexToUint8Array(s);
        return true;
      }),
    );
  });

  it("every output byte is in [0, 255]", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const bytes = hexToUint8Array(s);
        for (const b of bytes) {
          if (b < 0 || b > 255 || !Number.isInteger(b)) return false;
        }
        return true;
      }),
    );
  });

  // Documented behavior: invalid hex characters produce zero bytes
  // rather than throwing or producing NaN. Non-hex inputs round-trip
  // to all-zero bytes; the *length* still depends on the input string
  // length (after odd-length padding).
  it("treats invalid hex characters as 0", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 0, maxLength: 32 })
          // Force at least one non-hex character per pair so every byte position is invalid.
          .map((s) =>
            s
              .split("")
              .map((c) => (/^[0-9a-fA-F]$/.test(c) ? "z" : c))
              .join(""),
          ),
        (badHex) => {
          const bytes = hexToUint8Array(badHex);
          for (const b of bytes) if (b !== 0) return false;
          return true;
        },
      ),
    );
  });

  it("odd-length input is padded with a leading zero", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9a-f]*$/).filter((s) => s.length % 2 === 1 && s.length > 0),
        (oddHex) => {
          // Padding with "0" in front, so first nibble is 0, and the
          // first byte's low nibble is the original first hex char.
          const bytes = hexToUint8Array(oddHex);
          if (bytes.length !== Math.ceil(oddHex.length / 2)) return false;
          const expectedFirstByte = parseInt(`0${oddHex[0]}`, 16);
          return bytes[0] === expectedFirstByte;
        },
      ),
    );
  });
});
