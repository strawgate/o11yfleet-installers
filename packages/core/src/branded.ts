/**
 * Branded domain types — zero-runtime-cost type safety for domain identifiers.
 *
 * Branded types prevent mixing up structurally identical primitives (e.g.,
 * passing a tenant_id where an instance_uid is expected). The brand exists
 * only at the type level — at runtime these are plain strings/numbers.
 *
 * Each type has a Zod-validated constructor that is the **only** way to
 * create a branded value, ensuring invariants are always enforced.
 */

// ─── Brand helper ────────────────────────────────────────────────────

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

// ─── InstanceUID ─────────────────────────────────────────────────────
// 32-char lowercase hex, no dashes. This is the canonical wire format
// for OpAMP instance_uid (16 bytes, hex-encoded).

export type InstanceUID = Brand<string, "InstanceUID">;

const INSTANCE_UID_RE = /^[0-9a-f]{32}$/;

/** Validate and brand a string as an InstanceUID. Returns null if invalid. */
export function parseInstanceUID(value: string): InstanceUID | null {
  const lower = value.toLowerCase();
  return INSTANCE_UID_RE.test(lower) ? (lower as InstanceUID) : null;
}

/** Create a random InstanceUID (32-char lowercase hex, no dashes). */
export function randomInstanceUID(): InstanceUID {
  return crypto.randomUUID().replace(/-/g, "").toLowerCase() as InstanceUID;
}

/** Validate and brand, throwing on invalid input. For use at trust boundaries. */
export function requireInstanceUID(value: string, context?: string): InstanceUID {
  const result = parseInstanceUID(value);
  if (!result) {
    throw new TypeError(
      `Invalid InstanceUID${context ? ` (${context})` : ""}: expected 32-char hex, got "${value.slice(0, 40)}"`,
    );
  }
  return result;
}

// ─── GeoCoord ────────────────────────────────────────────────────────
// A validated geographic coordinate. Never NaN, always within valid range.

export type GeoLatitude = Brand<number, "GeoLatitude">;
export type GeoLongitude = Brand<number, "GeoLongitude">;

/** Parse a latitude value. Returns null for null, NaN, Infinity, or out-of-range. */
export function parseGeoLatitude(value: unknown): GeoLatitude | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n < -90 || n > 90) return null;
  return n as GeoLatitude;
}

/** Parse a longitude value. Returns null for null, NaN, Infinity, or out-of-range. */
export function parseGeoLongitude(value: unknown): GeoLongitude | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n < -180 || n > 180) return null;
  return n as GeoLongitude;
}

// ─── Base64Url ───────────────────────────────────────────────────────
// URL-safe base64 string (no padding, + → -, / → _).

export type Base64Url = Brand<string, "Base64Url">;

const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

/** Validate and brand a string as Base64Url. Returns null if invalid. */
export function parseBase64Url(value: string): Base64Url | null {
  return BASE64URL_RE.test(value) ? (value as Base64Url) : null;
}

// ─── Expiration timestamps ──────────────────────────────────────────
// Unix timestamp in seconds. 0 means "no expiry" (consistent across
// enrollment tokens, API keys, and pending tokens).

export type ExpirationSec = Brand<number, "ExpirationSec">;

/**
 * Create an expiration timestamp.
 * @param expiresInSeconds - seconds from now, or 0/undefined for "no expiry"
 */
export function makeExpiration(expiresInSeconds?: number): ExpirationSec {
  if (!expiresInSeconds || expiresInSeconds <= 0) return 0 as ExpirationSec;
  return (Math.floor(Date.now() / 1000) + expiresInSeconds) as ExpirationSec;
}

/** Check if an expiration has passed. Returns false for 0 (no expiry). */
export function isExpired(exp: ExpirationSec | number): boolean {
  if (exp === 0) return false;
  return exp < Math.floor(Date.now() / 1000);
}
