// Timing-safe string comparison — constant-time XOR loop prevents timing attacks
// on sensitive value comparisons (hashes, tokens, secrets).
// Note: the early length check is not constant-time; it is safe only when both
// inputs are known to be the same length (e.g. SHA-256 hashes, fixed-format
// tokens). All current call sites satisfy this constraint.
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  let result = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    result |= aBuf[i]! ^ bBuf[i]!;
  }
  return result === 0;
}
