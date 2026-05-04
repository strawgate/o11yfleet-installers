// Hex ↔ Uint8Array conversion utilities

export class InvalidHexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHexError";
    Object.setPrototypeOf(this, InvalidHexError.prototype);
  }
}

const HEX_PAIR_RE = /^[0-9a-fA-F]{2}$/;

/**
 * Decode a hex string to bytes. Throws `InvalidHexError` on any non-hex
 * character (including whitespace).
 *
 * Lenient on odd length (a leading zero is prepended) — that's a
 * harmless normalization, not a "fix the input" gesture. Strict on
 * actual character validity: a stored or supplied UID/hash that has
 * been corrupted should fail loudly rather than silently aliasing to
 * an all-zero byte sequence (e.g. `hexToUint8Array("zzzz")` previously
 * returned `Uint8Array([0, 0])`, which can collide with a real
 * all-zero UID/hash and route messages to the wrong agent).
 *
 * Note on `parseInt`: it is lenient enough that `parseInt("0 ", 16)`
 * returns `0` (parses the leading "0" and stops at the space), so a
 * NaN check on its result is not sufficient. Validate the pair against
 * `HEX_PAIR_RE` first.
 */
export function hexToUint8Array(hex: string): Uint8Array {
  // Pad odd-length strings with a leading zero for robustness
  const padded = hex.length % 2 !== 0 ? "0" + hex : hex;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < padded.length; i += 2) {
    const pair = padded.substring(i, i + 2);
    if (!HEX_PAIR_RE.test(pair)) {
      throw new InvalidHexError(`Invalid hex character at offset ${i}: ${JSON.stringify(pair)}`);
    }
    bytes[i / 2] = parseInt(pair, 16);
  }
  return bytes;
}

export function uint8ToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
