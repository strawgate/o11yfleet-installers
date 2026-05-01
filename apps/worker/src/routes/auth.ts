// Auth routes — login, logout, session management, seed accounts

import type { Env } from "../index.js";
import { authLoginRequestSchema } from "@o11yfleet/core/api";
import { base64urlDecode, base64urlEncode } from "@o11yfleet/core/auth";
import { timingSafeEqual } from "../utils/crypto.js";
import { getPlanLimits, normalizePlan, type PlanId } from "../shared/plans.js";
import { ApiError, jsonApiError, jsonError } from "../shared/errors.js";
import { clearSessionCookie, sessionCookie } from "../shared/cookies.js";
import { validateJsonBody } from "../shared/validation.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_COOKIE = "fp_oauth_state";
const GITHUB_API_VERSION = "2026-03-10";
const SELF_SERVICE_PLANS = new Set<PlanId>(["hobby", "pro", "starter", "growth"]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface OAuthState {
  v: 1;
  kind: "github_login" | "github_manifest";
  nonce: string;
  plan?: PlanId;
  returnTo?: string;
  iat: number;
  exp: number;
}

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface GitHubManifestConversion {
  id?: number;
  slug?: string;
  name?: string;
  html_url?: string;
  client_id?: string;
  client_secret?: string;
  webhook_secret?: string;
  pem?: string;
}

/** PBKDF2-SHA256 with 100k iterations (Cloudflare Workers max) */
async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  salt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  const hashHex = Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pbkdf2:100000:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const saltHex = parts[2]!;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const rehashed = await hashPassword(password, salt);
  // Timing-safe compare
  const enc = new TextEncoder();
  const a = enc.encode(rehashed);
  const b = enc.encode(stored);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomBase64url(byteLength = 32): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

const hmacKeyPromiseCache = new Map<string, Promise<CryptoKey>>();

async function hmacKey(secret: string): Promise<CryptoKey> {
  let promise = hmacKeyPromiseCache.get(secret);
  if (promise) return promise;
  promise = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  hmacKeyPromiseCache.set(secret, promise);
  return promise;
}

async function signState(state: OAuthState, secret: string): Promise<string> {
  const payload = base64urlEncode(encoder.encode(JSON.stringify(state)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${base64urlEncode(new Uint8Array(sig))}`;
}

async function verifyState(
  token: string,
  secret: string,
  kind: OAuthState["kind"],
): Promise<OAuthState> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("Invalid state");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    base64urlDecode(signature),
    encoder.encode(payload),
  );
  if (!valid) throw new Error("Invalid state signature");
  const state = JSON.parse(decoder.decode(base64urlDecode(payload))) as OAuthState;
  if (state.v !== 1 || state.kind !== kind) throw new Error("Invalid state kind");
  if (state.exp < Date.now()) throw new Error("State expired");
  return state;
}

function oauthStateCookie(value: string, env: Env, request: Request, maxAge: number): string {
  const secure =
    env.ENVIRONMENT === "production" ||
    env.ENVIRONMENT === "staging" ||
    new URL(request.url).protocol === "https:";
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/auth/github; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function clearOAuthStateCookie(env: Env, request: Request): string {
  return oauthStateCookie("", env, request, 0);
}

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function siteOriginForRequest(request: Request, env: Env): string {
  const url = new URL(request.url);
  const explicit = url.searchParams.get("site_origin")?.trim();
  if (explicit && isAllowedSiteOrigin(explicit, env)) return explicit;

  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const origin = new URL(referer).origin;
      if (isAllowedSiteOrigin(origin, env)) return origin;
    } catch {
      /* ignore malformed referer */
    }
  }

  if (env.ENVIRONMENT === "production") return "https://o11yfleet.com";
  if (env.ENVIRONMENT === "staging") return "https://staging.o11yfleet.com";
  return "http://localhost:4000";
}

function isAllowedSiteOrigin(origin: string, env: Env): boolean {
  try {
    const url = new URL(origin);
    if (env.ENVIRONMENT !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)) {
      return url.protocol === "http:" || url.protocol === "https:";
    }
    return (
      url.protocol === "https:" &&
      (url.hostname === "o11yfleet.com" ||
        url.hostname === "www.o11yfleet.com" ||
        url.hostname === "app.o11yfleet.com" ||
        url.hostname === "staging.o11yfleet.com" ||
        url.hostname === "dev.o11yfleet.com" ||
        url.hostname.endsWith(".o11yfleet-site.pages.dev"))
    );
  } catch {
    return false;
  }
}

function safeReturnTo(raw: string | null, siteOrigin: string, fallbackPath: string): string {
  if (!raw) return `${siteOrigin}${fallbackPath}`;
  try {
    const parsed = new URL(raw, siteOrigin);
    if (parsed.origin !== siteOrigin) return `${siteOrigin}${fallbackPath}`;
    if (!parsed.pathname.startsWith("/portal/")) return `${siteOrigin}${fallbackPath}`;
    return parsed.toString();
  } catch {
    return `${siteOrigin}${fallbackPath}`;
  }
}

function normalizeSelfServicePlan(rawPlan: string | null): PlanId {
  const plan = rawPlan ? normalizePlan(rawPlan) : null;
  if (plan && SELF_SERVICE_PLANS.has(plan)) return plan;
  return "starter";
}

async function createSessionResponse(
  request: Request,
  env: Env,
  user: { id: string; email: string; display_name: string; role: string; tenant_id: string | null },
  redirectTo?: string,
): Promise<Response> {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.FP_DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, is_impersonation) VALUES (?, ?, ?, 0)",
  )
    .bind(sessionId, user.id, expiresAt)
    .run();

  await env.FP_DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at < datetime('now')")
    .bind(user.id)
    .run();

  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const headers = new Headers({
    "Set-Cookie": sessionCookie(sessionId, maxAge, env, request),
  });
  if (redirectTo) {
    headers.append("Set-Cookie", clearOAuthStateCookie(env, request));
    headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers });
  }
  return Response.json(
    {
      user: {
        userId: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        tenantId: user.tenant_id,
      },
    },
    { headers },
  );
}

function githubClientId(env: Env): string | null {
  return env.GITHUB_APP_CLIENT_ID?.trim() || null;
}

function githubClientSecret(env: Env): string | null {
  return env.GITHUB_APP_CLIENT_SECRET?.trim() || null;
}

// ─── Auth context (used by middleware) ──────────────────────────────

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  tenantId: string | null;
  role: "member" | "admin";
  isImpersonation: boolean;
}

export async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  const sessionId = getCookie(request, "fp_session");
  if (!sessionId) return null;

  const row = await env.FP_DB.prepare(
    `SELECT u.id as user_id, u.email, u.display_name, u.tenant_id, u.role, s.is_impersonation
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > datetime('now')`,
  )
    .bind(sessionId)
    .first<{
      user_id: string;
      email: string;
      display_name: string;
      tenant_id: string | null;
      role: string;
      is_impersonation: number;
    }>();

  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    tenantId: row.tenant_id,
    role: row.role as "member" | "admin",
    isImpersonation: row.is_impersonation === 1,
  };
}

// ─── Route handler ──────────────────────────────────────────────────

export async function handleAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    const path = url.pathname;
    const method = request.method;

    if (path === "/auth/login" && method === "POST") return await handleLogin(request, env);
    if (path === "/auth/logout" && method === "POST") return await handleLogout(request, env);
    if (path === "/auth/me" && method === "GET") return await handleMe(request, env);
    if (path === "/auth/github/start" && method === "GET")
      return await handleGitHubStart(request, env);
    if (path === "/auth/github/callback" && method === "GET") {
      return await handleGitHubCallback(request, env);
    }
    if (path === "/auth/github/app-manifest" && method === "GET") {
      return await handleGitHubManifestStart(request, env);
    }
    if (path === "/auth/github/app-manifest/callback" && method === "GET") {
      return await handleGitHubManifestCallback(request, env);
    }
    if (path === "/auth/seed" && method === "POST") {
      // Require Bearer O11YFLEET_API_BEARER_SECRET to prevent unauthorized account creation
      const auth = request.headers.get("Authorization");
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (
        !token ||
        !env.O11YFLEET_API_BEARER_SECRET ||
        !timingSafeEqual(token, env.O11YFLEET_API_BEARER_SECRET)
      ) {
        return jsonError("Unauthorized", 401);
      }
      return await handleSeed(request, env);
    }

    return jsonError("Not found", 404);
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonApiError(err);
    }
    throw err;
  }
}

// ─── POST /auth/login ───────────────────────────────────────────────

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await validateJsonBody(request, authLoginRequestSchema);

  const email = body.email;
  const password = body.password;

  const user = await env.FP_DB.prepare(
    "SELECT id, email, password_hash, display_name, role, tenant_id FROM users WHERE email = ?",
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      password_hash: string;
      display_name: string;
      role: string;
      tenant_id: string | null;
    }>();

  if (!user) {
    await verifyPassword(
      password,
      "pbkdf2:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000",
    );
    return jsonError("Invalid email or password", 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return jsonError("Invalid email or password", 401);

  return createSessionResponse(request, env, {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    tenant_id: user.tenant_id,
  });
}

// ─── POST /auth/logout ──────────────────────────────────────────────

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const sessionId = getCookie(request, "fp_session");
  if (sessionId) {
    await env.FP_DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookie(env, request) } },
  );
}

// ─── GET /auth/me ───────────────────────────────────────────────────

async function handleMe(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth) return jsonError("Not authenticated", 401);
  return Response.json({ user: auth });
}

async function handleGitHubStart(request: Request, env: Env): Promise<Response> {
  const clientId = githubClientId(env);
  if (!clientId) {
    return githubAuthNotConfiguredResponse(request, env, "GitHub App client ID is not configured", {
      code: "github_auth_not_configured",
    });
  }

  const url = new URL(request.url);
  const siteOrigin = siteOriginForRequest(request, env);
  const plan = normalizeSelfServicePlan(url.searchParams.get("plan"));
  const mode = url.searchParams.get("mode") === "login" ? "login" : "signup";
  const fallbackPath = mode === "login" ? "/portal/overview" : "/portal/onboarding";
  const state: OAuthState = {
    v: 1,
    kind: "github_login",
    nonce: randomBase64url(24),
    plan,
    returnTo: safeReturnTo(url.searchParams.get("return_to"), siteOrigin, fallbackPath),
    iat: Date.now(),
    exp: Date.now() + OAUTH_STATE_TTL_MS,
  };
  const signedState = await signState(state, env.O11YFLEET_CLAIM_HMAC_SECRET);
  const callbackUrl = `${requestOrigin(request)}/auth/github/callback`;
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("state", signedState);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.toString(),
      "Set-Cookie": oauthStateCookie(
        state.nonce,
        env,
        request,
        Math.floor(OAUTH_STATE_TTL_MS / 1000),
      ),
    },
  });
}

async function handleGitHubCallback(request: Request, env: Env): Promise<Response> {
  const clientId = githubClientId(env);
  const clientSecret = githubClientSecret(env);
  if (!clientId || !clientSecret) {
    return githubAuthNotConfiguredResponse(
      request,
      env,
      "GitHub App client credentials are not configured",
      {
        code: "github_auth_not_configured",
      },
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  if (!code || !rawState) return jsonError("Missing GitHub callback parameters", 400);

  let state: OAuthState;
  try {
    state = await verifyState(rawState, env.O11YFLEET_CLAIM_HMAC_SECRET, "github_login");
  } catch {
    return jsonError("Invalid GitHub login state", 400);
  }
  const cookieNonce = getCookie(request, OAUTH_STATE_COOKIE);
  if (!cookieNonce || !timingSafeEqual(cookieNonce, state.nonce)) {
    return jsonError("Invalid GitHub login cookie", 400);
  }

  const token = await exchangeGitHubCode(
    code,
    clientId,
    clientSecret,
    `${requestOrigin(request)}/auth/github/callback`,
  );
  const profile = await fetchGitHubProfile(token);
  const email = await fetchGitHubPrimaryEmail(token);
  const user = await findOrCreateGitHubUser(env, profile, email, state.plan ?? "starter");

  return createSessionResponse(request, env, user, state.returnTo);
}

async function exchangeGitHubCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const parsed = (await res.json()) as GitHubTokenResponse;
  if (!res.ok || !parsed.access_token) {
    throw new ApiError(
      parsed.error_description ?? parsed.error ?? "GitHub token exchange failed",
      502,
    );
  }
  return parsed.access_token;
}

async function fetchGitHubProfile(token: string): Promise<GitHubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: githubApiHeaders(token),
  });
  if (!res.ok) throw new ApiError("Could not fetch GitHub profile", 502);
  return res.json<GitHubUser>();
}

async function fetchGitHubPrimaryEmail(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: githubApiHeaders(token),
  });
  if (!res.ok) throw new ApiError("Could not fetch a verified GitHub email address", 502);
  const emails = await res.json<GitHubEmail[]>();
  const primary = emails.find((email) => email.primary && email.verified);
  const verified = primary ?? emails.find((email) => email.verified);
  if (!verified?.email) throw new ApiError("GitHub account has no verified email address", 400);
  return verified.email;
}

function githubApiHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "o11yfleet",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

async function findOrCreateGitHubUser(
  env: Env,
  profile: GitHubUser,
  email: string,
  plan: PlanId,
): Promise<{
  id: string;
  email: string;
  display_name: string;
  role: string;
  tenant_id: string | null;
}> {
  const providerUserId = String(profile.id);
  const identity = await env.FP_DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.role, u.tenant_id
     FROM auth_identities ai
     JOIN users u ON u.id = ai.user_id
     WHERE ai.provider = 'github' AND ai.provider_user_id = ?`,
  )
    .bind(providerUserId)
    .first<{
      id: string;
      email: string;
      display_name: string;
      role: string;
      tenant_id: string | null;
    }>();
  if (identity) {
    await env.FP_DB.prepare(
      `UPDATE auth_identities SET provider_login = ?, provider_email = ?, updated_at = datetime('now')
       WHERE provider = 'github' AND provider_user_id = ?`,
    )
      .bind(profile.login, email, providerUserId)
      .run();
    return identity;
  }

  let user = await env.FP_DB.prepare(
    "SELECT id, email, display_name, role, tenant_id FROM users WHERE email = ?",
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      display_name: string;
      role: string;
      tenant_id: string | null;
    }>();

  if (user && (user.role !== "member" || !user.tenant_id)) {
    throw new ApiError("Existing account is not eligible for self-service GitHub login", 409);
  }

  if (!user) {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const displayName = profile.name?.trim() || profile.login;
    const { max_configs, max_agents_per_config } = getPlanLimits(plan);
    await env.FP_DB.batch([
      env.FP_DB.prepare(
        "INSERT INTO tenants (id, name, plan, max_configs, max_agents_per_config) VALUES (?, ?, ?, ?, ?)",
      ).bind(tenantId, `${profile.login}'s workspace`, plan, max_configs, max_agents_per_config),
      env.FP_DB.prepare(
        "INSERT INTO users (id, email, password_hash, display_name, role, tenant_id) VALUES (?, ?, ?, ?, 'member', ?)",
      ).bind(userId, email, `external:github:${providerUserId}`, displayName, tenantId),
    ]);
    user = {
      id: userId,
      email,
      display_name: displayName,
      role: "member",
      tenant_id: tenantId,
    };
  }

  await env.FP_DB.prepare(
    `INSERT INTO auth_identities (user_id, provider, provider_user_id, provider_login, provider_email)
     VALUES (?, 'github', ?, ?, ?)
     ON CONFLICT(provider, provider_user_id)
     DO UPDATE SET user_id = excluded.user_id, provider_login = excluded.provider_login,
       provider_email = excluded.provider_email, updated_at = datetime('now')`,
  )
    .bind(user.id, providerUserId, profile.login, email)
    .run();

  return user;
}

async function handleGitHubManifestStart(request: Request, env: Env): Promise<Response> {
  if (env.ENVIRONMENT === "production" || env.ENVIRONMENT === "staging") {
    return jsonError("GitHub App manifest setup is only available locally", 404);
  }

  const origin = requestOrigin(request);
  const siteOrigin = siteOriginForRequest(request, env);
  const state: OAuthState = {
    v: 1,
    kind: "github_manifest",
    nonce: randomBase64url(24),
    iat: Date.now(),
    exp: Date.now() + OAUTH_STATE_TTL_MS,
  };
  const signedState = await signState(state, env.O11YFLEET_CLAIM_HMAC_SECRET);
  const callbackUrls = Array.from(
    new Set([
      `${origin}/auth/github/callback`,
      "http://localhost:8787/auth/github/callback",
      "https://api.o11yfleet.com/auth/github/callback",
      "https://dev-api.o11yfleet.com/auth/github/callback",
      "https://staging-api.o11yfleet.com/auth/github/callback",
    ]),
  );
  const manifest = {
    name: "O11yFleet",
    url: "https://o11yfleet.com",
    description: "Sign in to O11yFleet and connect collector fleet GitOps when enabled.",
    hook_attributes: {
      url: `${origin}/auth/github/webhook`,
      active: false,
    },
    redirect_url: `${origin}/auth/github/app-manifest/callback`,
    callback_urls: callbackUrls,
    setup_url: `${siteOrigin}/signup`,
    public: true,
    default_permissions: {
      email_addresses: "read",
    },
    default_events: [],
    request_oauth_on_install: false,
  };
  return htmlResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Create O11yFleet GitHub App</title>
    <style>${setupPageCss()}</style>
  </head>
  <body>
    <main>
      <h1>Create the O11yFleet GitHub App</h1>
      <p>This will open GitHub and prefill a GitHub App with only the account permission needed for social login: read access to email addresses.</p>
      <form action="https://github.com/settings/apps/new?state=${escapeHtml(signedState)}" method="post">
        <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}" />
        <button type="submit">Continue to GitHub</button>
      </form>
    </main>
  </body>
</html>`,
    {
      "Set-Cookie": oauthStateCookie(
        state.nonce,
        env,
        request,
        Math.floor(OAUTH_STATE_TTL_MS / 1000),
      ),
    },
  );
}

async function handleGitHubManifestCallback(request: Request, env: Env): Promise<Response> {
  if (env.ENVIRONMENT === "production" || env.ENVIRONMENT === "staging") {
    return jsonError("GitHub App manifest setup is only available locally", 404);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  if (!code || !rawState) return jsonError("Missing GitHub manifest callback parameters", 400);

  let state: OAuthState;
  try {
    state = await verifyState(rawState, env.O11YFLEET_CLAIM_HMAC_SECRET, "github_manifest");
  } catch {
    return jsonError("Invalid GitHub manifest state", 400);
  }
  const manifestCookieNonce = getCookie(request, OAUTH_STATE_COOKIE);
  if (!manifestCookieNonce || !timingSafeEqual(manifestCookieNonce, state.nonce)) {
    return jsonError("Invalid GitHub manifest cookie", 400);
  }

  const res = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "o11yfleet",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    },
  );
  if (!res.ok) return jsonError("GitHub App manifest conversion failed", 502);
  const app = await res.json<GitHubManifestConversion>();
  return htmlResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>O11yFleet GitHub App Created</title>
    <style>${setupPageCss()}</style>
  </head>
  <body>
    <main>
      <h1>GitHub App created</h1>
      <p>Store these values as Worker secrets. Do not commit them.</p>
      <label>GITHUB_APP_CLIENT_ID<input readonly value="${escapeHtml(app.client_id ?? "")}" /></label>
      <label>GITHUB_APP_CLIENT_SECRET<input readonly value="${escapeHtml(app.client_secret ?? "")}" /></label>
      <label>GITHUB_APP_ID<input readonly value="${escapeHtml(String(app.id ?? ""))}" /></label>
      <label>GITHUB_APP_WEBHOOK_SECRET<input readonly value="${escapeHtml(app.webhook_secret ?? "")}" /></label>
      <label>GITHUB_APP_PRIVATE_KEY<textarea readonly>${escapeHtml(app.pem ?? "")}</textarea></label>
      <p><a href="${escapeHtml(app.html_url ?? "https://github.com/settings/apps")}">Open app settings</a></p>
    </main>
  </body>
</html>`,
    {
      "Set-Cookie": clearOAuthStateCookie(env, request),
    },
  );
}

function htmlResponse(body: string, headers?: Record<string, string>, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function githubAuthNotConfiguredResponse(
  request: Request,
  env: Env,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  const wantsHtml = request.headers.get("Accept")?.includes("text/html");
  if (!wantsHtml) return jsonError(message, 503, extra);

  const localSetup =
    env.ENVIRONMENT !== "production" && env.ENVIRONMENT !== "staging"
      ? `<p><a href="/auth/github/app-manifest">Create the GitHub App</a></p>`
      : "";
  return htmlResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub sign-in unavailable</title>
    <style>${setupPageCss()}</style>
  </head>
  <body>
    <main>
      <h1>GitHub sign-in is not ready yet</h1>
      <p>${escapeHtml(message)}. Configure the GitHub App credentials on the Worker, then try again.</p>
      ${localSetup}
    </main>
  </body>
</html>`,
    undefined,
    503,
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setupPageCss(): string {
  return `body{background:#050608;color:#f4f7fb;font:16px/1.5 system-ui,sans-serif;margin:0;padding:32px}main{max-width:760px;margin:10vh auto;background:#101318;border:1px solid #252b35;border-radius:12px;padding:28px}h1{font-size:28px;margin:0 0 12px}p{color:#b9c0cc}button{background:#4fd27b;border:0;border-radius:8px;color:#061008;font:600 15px system-ui,sans-serif;padding:12px 16px;cursor:pointer}label{display:block;color:#8993a3;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-top:16px}input,textarea{box-sizing:border-box;width:100%;margin-top:6px;border:1px solid #2d3542;border-radius:7px;background:#090b0f;color:#f4f7fb;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;padding:10px}textarea{min-height:180px}a{color:#6ee78e}`;
}

// ─── POST /auth/seed ────────────────────────────────────────────────
// Creates seed accounts from configured env vars. Idempotent.
const SEED_ENV_KEYS = [
  "O11YFLEET_SEED_TENANT_USER_EMAIL",
  "O11YFLEET_SEED_TENANT_USER_PASSWORD",
  "O11YFLEET_SEED_ADMIN_EMAIL",
  "O11YFLEET_SEED_ADMIN_PASSWORD",
] as const;

interface SeedEnv extends Env {
  O11YFLEET_SEED_TENANT_USER_EMAIL?: string;
  O11YFLEET_SEED_TENANT_USER_PASSWORD?: string;
  O11YFLEET_SEED_ADMIN_EMAIL?: string;
  O11YFLEET_SEED_ADMIN_PASSWORD?: string;
}

async function handleSeed(request: Request, env: Env): Promise<Response> {
  const e = env as SeedEnv;
  const results: string[] = [];
  const allowDefaultSeedCredentials = !env.ENVIRONMENT;
  const missingSeedEnv = SEED_ENV_KEYS.filter((key) => !e[key]?.trim());
  if (!allowDefaultSeedCredentials && missingSeedEnv.length > 0) {
    return jsonError(`Missing required seed secrets: ${missingSeedEnv.join(", ")}`, 500);
  }

  // Accept optional tenant_id and tenant_name from request body.
  // Always creates a new tenant (or uses the provided ID if it already exists).
  const body: { tenant_id?: string; tenant_name?: string } = {};
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    if (raw && typeof raw === "object") {
      if (typeof raw["tenant_id"] === "string") body.tenant_id = raw["tenant_id"];
      if (typeof raw["tenant_name"] === "string") body.tenant_name = raw["tenant_name"];
    }
  } catch {
    // If content-type suggests JSON was intended but body is malformed, reject.
    if (request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    // No body / non-JSON content type is fine — use defaults.
  }

  const tenantId = body.tenant_id ?? crypto.randomUUID();
  const tenantName = body.tenant_name ?? "Local Dev";

  // Upsert: create if not exists, otherwise reuse
  const existing = await env.FP_DB.prepare("SELECT id FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first();
  if (!existing) {
    const seedPlan = "growth";
    const { max_configs, max_agents_per_config } = getPlanLimits(seedPlan);
    await env.FP_DB.prepare(
      "INSERT INTO tenants (id, name, plan, max_configs, max_agents_per_config) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(tenantId, tenantName, seedPlan, max_configs, max_agents_per_config)
      .run();
    results.push(`Created tenant: ${tenantId} (${tenantName})`);
  } else {
    results.push(`Using existing tenant: ${tenantId}`);
  }

  // Upsert tenant user — always bind to this tenant
  const tenantEmail = e.O11YFLEET_SEED_TENANT_USER_EMAIL?.trim() || "demo@o11yfleet.com";
  const tenantPassword = e.O11YFLEET_SEED_TENANT_USER_PASSWORD ?? "demo-password";
  const existingTenantUser = await env.FP_DB.prepare(
    "SELECT id, tenant_id FROM users WHERE email = ?",
  )
    .bind(tenantEmail)
    .first<{ id: string; tenant_id: string | null }>();
  if (!existingTenantUser) {
    const hash = await hashPassword(tenantPassword);
    const userId = crypto.randomUUID();
    await env.FP_DB.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, role, tenant_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(userId, tenantEmail, hash, "Demo User", "member", tenantId)
      .run();
    results.push(`Created tenant user: ${tenantEmail}`);
  } else {
    if (existingTenantUser.tenant_id !== tenantId) {
      return Response.json(
        {
          error: `User ${tenantEmail} already belongs to tenant ${existingTenantUser.tenant_id}; refusing to move to ${tenantId}`,
          code: "TENANT_CONFLICT",
        },
        { status: 409 },
      );
    }
    const hash = await hashPassword(tenantPassword);
    await env.FP_DB.prepare("UPDATE users SET password_hash = ? WHERE email = ?")
      .bind(hash, tenantEmail)
      .run();
    results.push(`Updated tenant user: ${tenantEmail}`);
  }

  // Upsert admin user (no tenant binding)
  const adminEmail = e.O11YFLEET_SEED_ADMIN_EMAIL?.trim() || "admin@o11yfleet.com";
  const adminPassword = e.O11YFLEET_SEED_ADMIN_PASSWORD ?? "admin-password";
  const existingAdmin = await env.FP_DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(adminEmail)
    .first();
  if (!existingAdmin) {
    const hash = await hashPassword(adminPassword);
    const userId = crypto.randomUUID();
    await env.FP_DB.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, role, tenant_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(userId, adminEmail, hash, "Admin", "admin", null)
      .run();
    results.push(`Created admin user: ${adminEmail}`);
  } else {
    const hash = await hashPassword(adminPassword);
    await env.FP_DB.prepare("UPDATE users SET password_hash = ? WHERE email = ?")
      .bind(hash, adminEmail)
      .run();
    results.push(`Updated admin user password: ${adminEmail}`);
  }

  return Response.json({ seeded: results, tenantId });
}
