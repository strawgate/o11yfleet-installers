// Tenant-scoped API keys — self-contained signed claims
// Format: fp_key_<base64url_payload>.<base64url_signature>
// Contains tenant_id + expiry. Verified locally via HMAC-SHA256 (no D1 lookup).

import { base64urlEncode, base64urlDecode } from "./base64url.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PREFIX = "fp_key_";

export interface ApiKeyClaim {
  v: 1;
  tenant_id: string;
  iat: number; // issued-at (epoch seconds)
  exp: number; // expiry (epoch seconds), 0 = no expiry
  jti: string; // unique key ID (for revocation tracking)
  label?: string; // human-readable label (e.g. "CI deploy key")
}

const keyPromiseCache = new Map<string, Promise<CryptoKey>>();

async function getSigningKey(secret: string): Promise<CryptoKey> {
  let promise = keyPromiseCache.get(secret);
  if (promise) return promise;
  if (!secret) throw new Error("API key secret must not be empty");
  promise = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  keyPromiseCache.set(secret, promise);
  return promise;
}

/**
 * Generate a tenant-scoped API key. The key proves the caller's tenant_id
 * without any database lookup — verification is pure HMAC-SHA256.
 */
export async function generateApiKey(opts: {
  tenant_id: string;
  secret: string;
  expires_in_seconds?: number;
  jti?: string;
  label?: string;
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

  const claim: ApiKeyClaim = {
    v: 1,
    tenant_id: opts.tenant_id,
    iat: now,
    exp,
    jti,
  };
  if (opts.label) claim.label = opts.label;

  const payload = base64urlEncode(encoder.encode(JSON.stringify(claim)));
  const key = await getSigningKey(opts.secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const sigB64 = base64urlEncode(new Uint8Array(sig));

  const token = `${PREFIX}${payload}.${sigB64}`;
  const expires_at = exp > 0 ? new Date(exp * 1000).toISOString() : null;

  return { token, jti, expires_at };
}

/** Returns true if the token looks like a tenant-scoped API key. */
export function isApiKey(token: string): boolean {
  return token.startsWith(PREFIX);
}

/**
 * Verify and decode a tenant-scoped API key. Returns the claim on success.
 * Throws on invalid signature, expiry, or malformed payload.
 */
export async function verifyApiKey(token: string, secret: string): Promise<ApiKeyClaim> {
  if (!token.startsWith(PREFIX)) {
    throw new Error("Not an API key");
  }

  const body = token.slice(PREFIX.length);
  const dotIdx = body.indexOf(".");
  if (dotIdx === -1) {
    throw new Error("Invalid API key format");
  }

  const payload = body.slice(0, dotIdx);
  const signature = body.slice(dotIdx + 1);

  const key = await getSigningKey(secret);
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
    throw new Error("Invalid API key signature");
  }

  let claim: ApiKeyClaim;
  try {
    claim = JSON.parse(decoder.decode(base64urlDecode(payload))) as ApiKeyClaim;
  } catch {
    throw new Error("Malformed API key payload");
  }

  if (claim.v !== 1) {
    throw new Error(`Unsupported API key version: ${claim.v}`);
  }

  if (claim.exp > 0 && claim.exp < Date.now() / 1000) {
    throw new Error("API key expired");
  }

  if (!claim.tenant_id) {
    throw new Error("API key missing tenant_id");
  }

  if (!claim.jti) {
    throw new Error("API key missing key ID (jti)");
  }

  return claim;
}
