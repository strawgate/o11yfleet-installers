// Enrollment tokens — self-contained signed claims
// Format: fp_enroll_<base64url_payload>.<base64url_signature>
// Contains tenant_id + config_id + expiry. Verified locally (no D1 lookup on connect).
// D1 enrollment_tokens table is kept as an admin registry for listing/revocation.

import { base64urlEncode, base64urlDecode } from "./base64url.js";
import { timingSafeEqual } from "./timing-safe-compare.js";

const encoder = new TextEncoder();

export interface EnrollmentClaim {
  v: 1;
  tenant_id: string;
  config_id: string;
  iat: number; // issued-at (epoch seconds)
  exp: number; // expiry (epoch seconds), 0 = no expiry
  jti: string; // unique token ID (for revocation tracking)
}

async function getEnrollmentKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error("Enrollment secret must not be empty");
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
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

  const claim: EnrollmentClaim = {
    v: 1,
    tenant_id: opts.tenant_id,
    config_id: opts.config_id,
    iat: now,
    exp,
    jti,
  };

  const payload = base64urlEncode(encoder.encode(JSON.stringify(claim)));
  const key = await getEnrollmentKey(opts.secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const sigB64 = base64urlEncode(new Uint8Array(sig));

  const token = `fp_enroll_${payload}.${sigB64}`;
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
  if (!token.startsWith("fp_enroll_")) {
    throw new Error("Not an enrollment token");
  }

  const body = token.slice("fp_enroll_".length);
  const dotIdx = body.indexOf(".");
  if (dotIdx === -1) {
    throw new Error("Invalid enrollment token format");
  }

  const payload = body.slice(0, dotIdx);
  const signature = body.slice(dotIdx + 1);

  const key = await getEnrollmentKey(secret);
  const sigBytes = base64urlDecode(signature);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes.buffer.slice(
      sigBytes.byteOffset,
      sigBytes.byteOffset + sigBytes.byteLength,
    ) as ArrayBuffer,
    encoder.encode(payload),
  );

  if (!valid) {
    throw new Error("Invalid enrollment token signature");
  }

  let claim: EnrollmentClaim;
  try {
    claim = JSON.parse(new TextDecoder().decode(base64urlDecode(payload))) as EnrollmentClaim;
  } catch {
    throw new Error("Malformed enrollment token payload (invalid JSON)");
  }

  if (claim.v !== 1) {
    throw new Error(`Unsupported enrollment token version: ${claim.v}`);
  }

  if (claim.exp > 0 && claim.exp < Date.now() / 1000) {
    throw new Error("Enrollment token expired");
  }

  if (!claim.tenant_id || !claim.config_id) {
    throw new Error("Enrollment token missing required fields");
  }

  if (!claim.jti) {
    throw new Error("Enrollment token missing token ID (jti)");
  }

  return claim;
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
