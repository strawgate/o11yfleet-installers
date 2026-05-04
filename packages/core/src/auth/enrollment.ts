// Enrollment tokens — self-contained signed JWTs
// Format: fp_enroll_<JWT> (standard HS256 JWT with fp_enroll_ prefix)
// Contains tenant_id + config_id + expiry. Verified locally (no D1 lookup on connect).
// D1 enrollment_tokens table is kept as an admin registry for listing/revocation.

import { z } from "zod";
import { SignJWT, jwtVerify, errors } from "jose";
import { base64urlEncode } from "./base64url.js";
import { timingSafeEqual } from "./timing-safe-compare.js";

const encoder = new TextEncoder();

const enrollmentPayloadSchema = z.object({
  v: z.literal(1),
  tenant_id: z.string().min(1),
  config_id: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int().optional(),
  jti: z.string().min(1),
});

export interface EnrollmentClaim {
  v: 1;
  tenant_id: string;
  config_id: string;
  iat: number; // issued-at (epoch seconds)
  exp: number; // expiry (epoch seconds), 0 = no expiry
  jti: string; // unique token ID (for revocation tracking)
}

/**
 * Generate a signed enrollment token embedding tenant_id + config_id.
 * The token is self-verifiable — no database lookup needed to route.
 */
export async function generateEnrollmentToken(opts: {
  tenant_id: string;
  config_id: string;
  secret: string;
  expires_in_seconds?: number;
  jti?: string;
}): Promise<{ token: string; jti: string; expires_at: string | null }> {
  if (!opts.secret) {
    throw new Error("Enrollment secret must not be empty");
  }
  const jti = opts.jti ?? crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  if (
    opts.expires_in_seconds !== undefined &&
    opts.expires_in_seconds !== null &&
    opts.expires_in_seconds !== 0
  ) {
    if (!Number.isFinite(opts.expires_in_seconds) || opts.expires_in_seconds < 0) {
      throw new Error(`Invalid expires_in_seconds: ${opts.expires_in_seconds}`);
    }
  }
  const exp = opts.expires_in_seconds ? now + opts.expires_in_seconds : 0;

  const key = encoder.encode(opts.secret);
  const builder = new SignJWT({
    v: 1,
    tenant_id: opts.tenant_id,
    config_id: opts.config_id,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setJti(jti);

  // exp=0 means no expiry — omit the JWT exp claim so jose doesn't reject it
  if (exp > 0) {
    builder.setExpirationTime(exp);
  }

  const jwt = await builder.sign(key);
  const token = `fp_enroll_${jwt}`;
  const expires_at = exp > 0 ? new Date(exp * 1000).toISOString() : null;

  return { token, jti, expires_at };
}

/**
 * Verify and decode an enrollment token. Returns the claim on success.
 * Throws on invalid signature or expiry.
 */
export async function verifyEnrollmentToken(
  token: string,
  secret: string,
): Promise<EnrollmentClaim> {
  if (!secret) {
    throw new Error("Enrollment secret must not be empty");
  }
  if (!token.startsWith("fp_enroll_")) {
    throw new Error("Not an enrollment token");
  }

  const jwt = token.slice("fp_enroll_".length);
  if (!jwt.includes(".")) {
    throw new Error("Invalid enrollment token format");
  }

  const key = encoder.encode(secret);
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(jwt, key);
    payload = result.payload;
  } catch (e: unknown) {
    if (e instanceof errors.JWTExpired) {
      throw new Error("Enrollment token expired");
    }
    if (e instanceof errors.JWSSignatureVerificationFailed) {
      throw new Error("Invalid enrollment token signature");
    }
    if (e instanceof errors.JWSInvalid) {
      throw new Error("Malformed enrollment token payload (invalid JSON)");
    }
    throw new Error("Invalid enrollment token signature");
  }

  try {
    const claim = enrollmentPayloadSchema.parse(payload);
    return {
      v: 1,
      tenant_id: claim.tenant_id,
      config_id: claim.config_id,
      iat: claim.iat,
      exp: claim.exp ?? 0,
      jti: claim.jti,
    };
  } catch (_e: unknown) {
    throw new Error("Enrollment token has invalid or missing required claims");
  }
}

/**
 * Hash a token for storage in the admin registry (D1).
 * Used for revocation lookup — NOT used on the connection hot path.
 */
export async function hashEnrollmentToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return base64urlEncode(new Uint8Array(hash));
}

export async function verifyEnrollmentTokenHash(
  rawToken: string,
  storedHash: string,
): Promise<boolean> {
  const computedHash = await hashEnrollmentToken(rawToken);
  return timingSafeEqual(computedHash, storedHash);
}
