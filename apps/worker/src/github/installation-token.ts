// Mint GitHub App installation tokens.
//
// Two stages:
//   1. Generate an app-level JWT (RS256, 10-min expiry) signed with
//      GITHUB_APP_PRIVATE_KEY. This authenticates as the *app* itself.
//   2. Exchange the JWT for a per-installation access token (1-hour
//      validity) via `POST /app/installations/{id}/access_tokens`. This
//      is what we use for repo-scoped operations (read contents, write
//      check runs).
//
// Tokens are cached per installation in a Map keyed by installation_id;
// each entry tracks `expires_at`. Re-used until 5 minutes before expiry,
// then re-minted. The cache is per-isolate; on a fresh isolate the next
// caller pays one extra round-trip to re-mint, which is fine.

import { githubApi } from "./api.js";

const TOKEN_REUSE_BUFFER_MS = 5 * 60 * 1000;
const APP_JWT_TTL_S = 10 * 60;
const APP_JWT_SKEW_S = 60;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<number, CachedToken>();

/** Test seam: clear the in-memory cache between cases. */
export function __clearInstallationTokenCacheForTesting(): void {
  cache.clear();
}

/**
 * Remove expired tokens from the cache. Called opportunistically on every
 * cache hit/miss to bound memory growth — Cloudflare isolates can run
 * indefinitely so unbounded Maps are a leak risk.
 */
function evictExpiredEntries(): void {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (entry.expiresAt < now) {
      cache.delete(id);
    }
  }
}

interface AppCreds {
  appId: string;
  privateKeyPem: string;
}

interface MintOptions {
  /** Optional fetch override for tests. */
  fetcher?: typeof fetch;
  /** Override the cache (e.g. force re-mint). */
  bypassCache?: boolean;
}

/**
 * Build a JWT signed with the app's private key. Used only as the bearer
 * for the access-token exchange — never sent to repo-scoped endpoints.
 *
 * Per GitHub:
 *   iat = now - 60 (clock-skew tolerance, GH rejects tokens with iat in
 *                   the future)
 *   exp = now + 10*60 (max allowed)
 *   iss = app_id
 *   alg = RS256
 */
export async function generateAppJwt(creds: AppCreds, nowMs = Date.now()): Promise<string> {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({ iat: now - APP_JWT_SKEW_S, exp: now + APP_JWT_TTL_S, iss: creds.appId }),
    ),
  );
  const signingInput = `${header}.${payload}`;

  const key = await importPrivateKey(creds.privateKeyPem);
  const sigBytes = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );
  const signature = base64url(new Uint8Array(sigBytes));
  return `${signingInput}.${signature}`;
}

interface InstallationTokenEnv {
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
}

/**
 * Get a fresh-enough installation access token. Returns from cache if it
 * has at least TOKEN_REUSE_BUFFER_MS of validity left; otherwise mints a
 * new one via the access-token exchange.
 */
export async function getInstallationToken(
  env: InstallationTokenEnv,
  installationId: number,
  opts: MintOptions = {},
): Promise<string> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be configured");
  }
  if (!opts.bypassCache) {
    evictExpiredEntries();
    const cached = cache.get(installationId);
    if (cached && cached.expiresAt - TOKEN_REUSE_BUFFER_MS > Date.now()) {
      return cached.token;
    }
  }

  const jwt = await generateAppJwt({
    appId: env.GITHUB_APP_ID,
    privateKeyPem: env.GITHUB_APP_PRIVATE_KEY,
  });
  const res = await githubApi<{ token?: string; expires_at?: string }>(
    "POST",
    `/app/installations/${installationId}/access_tokens`,
    { token: jwt, fetcher: opts.fetcher },
  );
  if (!res.ok || !res.data?.token || !res.data?.expires_at) {
    throw new Error(
      `Failed to mint installation token (${res.status}): ${JSON.stringify(res.data)}`,
    );
  }
  const expiresAt = Date.parse(res.data.expires_at);
  if (!Number.isFinite(expiresAt)) {
    // GitHub returned an unparseable timestamp — refuse to cache it so a
    // single bad response doesn't poison the per-isolate cache for hours.
    throw new Error(`Invalid expires_at in installation token response: ${res.data.expires_at}`);
  }
  cache.set(installationId, { token: res.data.token, expiresAt });
  return res.data.token;
}

// ─── helpers ───────────────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Parse a PEM-encoded RSA private key (PKCS#8, the format GitHub provides
 * since 2023) into a CryptoKey usable with WebCrypto.
 *
 * Older "BEGIN RSA PRIVATE KEY" (PKCS#1) blobs would need an extra ASN.1
 * unwrap; we don't support them because GitHub's GitHub Apps interface
 * has only emitted PKCS#8 for years. Fail loudly so an old key gets
 * surfaced rather than silently rejected at signing time.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const trimmed = pem
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");
  if (!pem.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      'Expected a PKCS#8 "BEGIN PRIVATE KEY" PEM. ' +
        'If you have a "BEGIN RSA PRIVATE KEY" file, re-download from GitHub or convert with ' +
        "`openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pkcs8.pem`.",
    );
  }
  const der = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
