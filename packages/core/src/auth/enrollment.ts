// Enrollment tokens
// Format: fp_enroll_{base64url_random_32_bytes}
// Only SHA-256 hash is stored

import { base64urlEncode } from "./base64url.js";
import { timingSafeEqual } from "./timing-safe-compare.js";

const encoder = new TextEncoder();

export function generateEnrollmentToken(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const b64 = base64urlEncode(randomBytes);
  return `fp_enroll_${b64}`;
}

export async function hashEnrollmentToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return base64urlEncode(new Uint8Array(hash));
}

export async function verifyEnrollmentToken(
  rawToken: string,
  storedHash: string,
): Promise<boolean> {
  const computedHash = await hashEnrollmentToken(rawToken);
  return timingSafeEqual(computedHash, storedHash);
}
