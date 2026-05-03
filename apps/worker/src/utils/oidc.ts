/**
 * GitHub Actions OIDC JWT verification for Cloudflare Workers.
 *
 * Verifies tokens from `token.actions.githubusercontent.com` using RS256
 * with GitHub's published JWKS. Tokens are short-lived (~5 min) and scoped
 * to specific repos/workflows.
 *
 * Usage:
 *   const result = await verifyGitHubOIDC(bearerToken, { audience: "o11yfleet", allowedRepos: ["strawgate/o11yfleet-load"] });
 *   if (!result.ok) return Response.json({ error: result.error }, { status: 403 });
 *   // result.claims.repository is verified
 */

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;

// In-memory JWKS cache (survives for the lifetime of the Worker isolate)
let jwksCache: { keys: JWK[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface JWK {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

/** Claims from a verified GitHub Actions OIDC JWT. */
export interface GitHubOIDCClaims {
  iss: string;
  aud: string;
  sub: string;
  repository: string;
  repository_owner: string;
  ref: string;
  sha: string;
  workflow: string;
  run_id: string;
  run_number: string;
  actor: string;
  event_name: string;
  job_workflow_ref: string;
  iat: number;
  exp: number;
  nbf: number;
}

export interface OIDCVerifyOptions {
  /** Expected `aud` claim. Must match exactly. */
  audience: string;
  /** Repositories allowed to authenticate. Checked against `repository` claim. */
  allowedRepos: string[];
  /** Optional: required ref (e.g. "refs/heads/main"). If omitted, any ref is allowed. */
  requiredRef?: string;
}

type VerifyResult = { ok: true; claims: GitHubOIDCClaims } | { ok: false; error: string };

/**
 * Verify a GitHub Actions OIDC JWT.
 *
 * Returns verified claims on success, or an error string on failure.
 * Never throws — all failure modes return { ok: false, error }.
 */
export async function verifyGitHubOIDC(
  token: string,
  options: OIDCVerifyOptions,
): Promise<VerifyResult> {
  // Split JWT
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "Invalid JWT format" };
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  // Decode header
  let header: { kid?: string; alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
  } catch {
    return { ok: false, error: "Invalid JWT header" };
  }

  if (header.alg !== "RS256") {
    return { ok: false, error: `Unsupported algorithm: ${header.alg}` };
  }
  if (!header.kid) {
    return { ok: false, error: "JWT missing kid header" };
  }

  // Fetch JWKS and find the signing key
  const jwks = await fetchJWKS();
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Key not found — maybe keys rotated. Force refresh and retry once.
    jwksCache = null;
    const refreshed = await fetchJWKS();
    const retryJwk = refreshed.find((k) => k.kid === header.kid);
    if (!retryJwk) {
      return { ok: false, error: "Signing key not found in GitHub JWKS" };
    }
    return verifyWithKey(retryJwk, headerB64, payloadB64, signatureB64, options);
  }

  return verifyWithKey(jwk, headerB64, payloadB64, signatureB64, options);
}

/** Returns true if a bearer token looks like a JWT (3 base64url parts). */
export function looksLikeJWT(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

// ─── Internal ──────────────────────────────────────────────────────────

async function verifyWithKey(
  jwk: JWK,
  headerB64: string,
  payloadB64: string,
  signatureB64: string,
  options: OIDCVerifyOptions,
): Promise<VerifyResult> {
  // Import the public key
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, error: "Failed to import signing key" };
  }

  // Verify signature
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(signatureB64);

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signingInput);
  } catch {
    return { ok: false, error: "Signature verification failed" };
  }

  if (!valid) {
    return { ok: false, error: "Invalid signature" };
  }

  // Decode and validate claims
  let claims: GitHubOIDCClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { ok: false, error: "Invalid JWT payload" };
  }

  const now = Math.floor(Date.now() / 1000);

  if (claims.iss !== GITHUB_OIDC_ISSUER) {
    return { ok: false, error: `Invalid issuer: ${claims.iss}` };
  }

  if (claims.aud !== options.audience) {
    return { ok: false, error: `Invalid audience: ${claims.aud}` };
  }

  if (claims.exp < now) {
    return { ok: false, error: "Token expired" };
  }

  if (claims.nbf && claims.nbf > now + 60) {
    return { ok: false, error: "Token not yet valid" };
  }

  if (!options.allowedRepos.includes(claims.repository)) {
    return { ok: false, error: `Repository not allowed: ${claims.repository}` };
  }

  if (options.requiredRef && claims.ref !== options.requiredRef) {
    return { ok: false, error: `Ref not allowed: ${claims.ref}` };
  }

  return { ok: true, claims };
}

async function fetchJWKS(): Promise<JWK[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  // Network/TLS failure path: fetch can throw (e.g. workerd TLS handshake
  // rejection, DNS, connection reset). Treat any failure the same as a
  // non-2xx response — fall back to cached keys if any, else empty. This
  // makes the verify-then-find-kid flow downgrade to a clean "Unknown
  // signing key" 403 instead of bubbling as a 500 from /api/admin/*.
  let res: Response;
  try {
    res = await fetch(GITHUB_JWKS_URL);
  } catch (err) {
    console.warn("JWKS fetch failed:", err instanceof Error ? err.message : String(err));
    return jwksCache?.keys ?? [];
  }
  if (!res.ok) {
    console.warn(`JWKS fetch failed: HTTP ${res.status}`);
    return jwksCache?.keys ?? [];
  }

  const data = (await res.json()) as { keys: JWK[] };
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (padded.length % 4)) % 4);
  return atob(padded + padding);
}

function base64UrlToUint8Array(input: string): Uint8Array {
  const binary = base64UrlDecode(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
