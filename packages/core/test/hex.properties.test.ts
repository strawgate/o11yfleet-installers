// Property-based tests for the hex codec.
//
// hex.ts is small (two functions, ~15 LOC) but used everywhere we
// translate between protobuf bytes and SQL strings. Round-trip and
// lossless properties are exactly what fast-check is good at.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { hexToUint8Array, uint8ToHex, InvalidHexError } from "../src/hex.js";

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

  // Strict-input contract: non-hex characters must throw, not coerce. The
  // previous silent-zero behavior could alias garbage input to a valid
  // all-zero UID/hash and route messages to the wrong agent. See `hex.ts`.

  it("every output byte is in [0, 255] for valid hex input", () => {
    fc.assert(
      fc.property(evenHexArb, (hex) => {
        const bytes = hexToUint8Array(hex);
        for (const b of bytes) {
          if (b < 0 || b > 255 || !Number.isInteger(b)) return false;
        }
        return true;
      }),
    );
  });

  it("throws InvalidHexError on any string containing a non-hex character", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 32 })
          // Replace any hex chars with a definitely-non-hex sentinel so we
          // guarantee at least one invalid character per generated string.
          .map((s) =>
            s
              .split("")
              .map((c) => (/^[0-9a-fA-F]$/.test(c) ? "z" : c))
              .join(""),
          ),
        (badHex) => {
          let threw = false;
          try {
            hexToUint8Array(badHex);
          } catch (err) {
            threw = err instanceof InvalidHexError;
          }
          return threw;
        },
      ),
    );
  });

  it("does not throw when every character is a valid hex digit", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-fA-F]*$/), (hex) => {
        // Only assertion: this should not raise.
        expect(() => hexToUint8Array(hex)).not.toThrow();
        return true;
      }),
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
