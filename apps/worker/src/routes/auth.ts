// Auth routes — login, logout, session management, seed accounts

import type { Env } from "../index.js";
import {
  authLoginRequestSchema,
  authLoginResponseSchema,
  authLogoutResponseSchema,
  authMeResponseSchema,
  authSeedResponseSchema,
  type AuthLoginResponse,
  type AuthMeResponse,
  type AuthSeedResponse,
} from "@o11yfleet/core/api";
import { typedJsonResponse } from "../shared/responses.js";
import { base64urlEncode } from "@o11yfleet/core/auth";
import { SignJWT, jwtVerify } from "jose";
import { timingSafeEqual } from "../utils/crypto.js";
import { getPlanLimits, normalizePlan, type PlanId } from "../shared/plans.js";
import { ApiError, jsonApiError, jsonError } from "../shared/errors.js";
import { clearSessionCookie, sessionCookie } from "../shared/cookies.js";
import { validateJsonBody } from "../shared/validation.js";
import { isAllowedSiteOrigin, primarySiteOriginForEnvironment } from "../shared/origins.js";
import { renderGitHubAppManifest } from "../github/manifest.js";
import { isAutoApproveEnabled } from "../shared/email.js";
import { sql } from "kysely";
import { handleGitHubWebhook } from "../github/webhook.js";
import { getDb } from "../db/client.js";
import type { UserRole } from "../db/schema.js";
import { compileForBatch } from "../db/queries.js";
import {
  adminAuditContext,
  recordEvent,
  tenantAuditContext,
  userActor,
  type AuditContext,
} from "../audit/recorder.js";
import { SESSION_TTL_MS, generateSessionId } from "../shared/sessions.js";
import { parse as parseCookies } from "cookie";
import { GitHub as ArcticGitHub, OAuth2RequestError } from "arctic";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_COOKIE = "fp_oauth_state";
const GITHUB_API_VERSION = "2026-03-10";
const SELF_SERVICE_PLANS = new Set<PlanId>(["hobby", "pro", "starter", "growth"]);

interface OAuthState {
  v: 1;
  kind: "github_login" | "github_manifest";
  nonce: string;
  plan?: PlanId;
  returnTo?: string;
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

function randomBase64url(byteLength = 32): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const cookies = parseCookies(header);
  return cookies[name] ?? null;
}

async function signState(state: OAuthState, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ ...state })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);
}

async function verifyState(
  token: string,
  secret: string,
  kind: OAuthState["kind"],
): Promise<OAuthState> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  const state = payload as unknown as OAuthState;
  if (state.v !== 1 || state.kind !== kind) throw new Error("Invalid state kind");
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
  if (explicit) {
    try {
      const explicitOrigin = new URL(explicit).origin;
      if (isAllowedSiteOrigin(explicitOrigin, env.ENVIRONMENT)) return explicitOrigin;
    } catch {
      /* ignore malformed explicit site_origin */
    }
  }

  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const origin = new URL(referer).origin;
      if (isAllowedSiteOrigin(origin, env.ENVIRONMENT)) return origin;
    } catch {
      /* ignore malformed referer */
    }
  }

  return primarySiteOriginForEnvironment(env.ENVIRONMENT);
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
  user: {
    id: string;
    email: string;
    display_name: string;
    role: string;
    tenant_id: string | null;
    tenant_status?: TenantApprovalStatus;
  },
  redirectTo?: string,
): Promise<Response> {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const db = getDb(env.FP_DB);
  await db
    .insertInto("sessions")
    .values({ id: sessionId, user_id: user.id, expires_at: expiresAt, is_impersonation: 0 })
    .execute();
  // GC any expired sessions for this user opportunistically — keeps the
  // sessions table from growing unbounded for users who never log out.
  await db
    .deleteFrom("sessions")
    .where("user_id", "=", user.id)
    .where("expires_at", "<", sql<string>`datetime('now')`)
    .execute();

  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const headers = new Headers({
    "Set-Cookie": sessionCookie(sessionId, maxAge, env, request),
  });
  if (redirectTo) {
    headers.append("Set-Cookie", clearOAuthStateCookie(env, request));
    headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers });
  }
  const payload: AuthLoginResponse = {
    user: {
      userId: user.id,
      // authUserSchema requires either id or userId; we set userId.
      // The transform on authUserSchema fills in `id` for us, but
      // since we send the raw outgoing payload, set both for clarity.
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      tenantId: user.tenant_id,
      // tenantStatus flows through authUserSchema's passthrough().
      tenantStatus: user.tenant_status ?? "pending",
    },
  };
  return typedJsonResponse(authLoginResponseSchema, payload, env, { headers });
}

function githubClientId(env: Env): string | null {
  return env.GITHUB_APP_CLIENT_ID?.trim() || null;
}

function githubClientSecret(env: Env): string | null {
  return env.GITHUB_APP_CLIENT_SECRET?.trim() || null;
}

// ─── Auth context (used by middleware) ──────────────────────────────

export type TenantApprovalStatus = "pending" | "active" | "suspended";

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  tenantId: string | null;
  tenantStatus: TenantApprovalStatus;
  role: UserRole;
  isImpersonation: boolean;
  /** When `isImpersonation` is true, the real admin user id who started the session. */
  impersonatorUserId: string | null;
}

export async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  const sessionId = getCookie(request, "fp_session");
  if (!sessionId) return null;

  const row = await getDb(env.FP_DB)
    .selectFrom("sessions as s")
    .innerJoin("users as u", "u.id", "s.user_id")
    .leftJoin("tenants as t", "t.id", "u.tenant_id")
    .select([
      "u.id as user_id",
      "u.email",
      "u.display_name",
      "u.tenant_id",
      "u.role",
      "s.is_impersonation",
      "s.impersonator_user_id",
      "t.status as tenant_status",
    ])
    .where("s.id", "=", sessionId)
    .where("s.expires_at", ">", sql<string>`datetime('now')`)
    .executeTakeFirst();

  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    tenantId: row.tenant_id,
    tenantStatus: (row.tenant_status as TenantApprovalStatus | null) ?? "pending",
    role: row.role,
    isImpersonation: row.is_impersonation === 1,
    impersonatorUserId: row.impersonator_user_id,
  };
}

// ─── Route handler ──────────────────────────────────────────────────

export async function handleAuthRequest(
  request: Request,
  env: Env,
  url: URL,
  ctx?: ExecutionContext,
): Promise<Response> {
  try {
    const path = url.pathname;
    const method = request.method;

    if (path === "/auth/login" && method === "POST") return await handleLogin(request, env, ctx);
    if (path === "/auth/logout" && method === "POST") return await handleLogout(request, env, ctx);
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
    if (path === "/auth/github/webhook" && method === "POST") {
      return await handleGitHubWebhook(request, env);
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

async function handleLogin(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const body = await validateJsonBody(request, authLoginRequestSchema);

  const email = body.email;
  const password = body.password;

  const user = await getDb(env.FP_DB)
    .selectFrom("users as u")
    .leftJoin("tenants as t", "t.id", "u.tenant_id")
    .select([
      "u.id",
      "u.email",
      "u.password_hash",
      "u.display_name",
      "u.role",
      "u.tenant_id",
      "t.status as tenant_status",
    ])
    .where("u.email", "=", email)
    .executeTakeFirst();

  if (!user) {
    await verifyPassword(
      password,
      "pbkdf2:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000",
    );
    // Unknown email — no tenant to scope the audit event to. Drop.
    return jsonError("Invalid email or password", 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    recordAuthEvent(ctx, env, request, user.tenant_id, user.role, user.id, user.email, false);
    return jsonError("Invalid email or password", 401);
  }

  recordAuthEvent(ctx, env, request, user.tenant_id, user.role, user.id, user.email, true);
  return createSessionResponse(request, env, {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    tenant_id: user.tenant_id,
    tenant_status: (user.tenant_status as TenantApprovalStatus) ?? "pending",
  });
}

// ─── POST /auth/logout ──────────────────────────────────────────────

async function handleLogout(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const sessionId = getCookie(request, "fp_session");
  let session: {
    user_id: string;
    tenant_id: string | null;
    email: string;
    role: string;
  } | null = null;
  if (sessionId) {
    const db = getDb(env.FP_DB);
    session =
      (await db
        .selectFrom("sessions as s")
        .innerJoin("users as u", "u.id", "s.user_id")
        .select(["u.id as user_id", "u.tenant_id", "u.email", "u.role"])
        .where("s.id", "=", sessionId)
        .executeTakeFirst()) ?? null;
    await db.deleteFrom("sessions").where("id", "=", sessionId).execute();
  }
  if (session && ctx) {
    const audit = buildAuthAuditContext(
      ctx,
      env,
      request,
      session.tenant_id,
      session.role,
      session.user_id,
      session.email,
    );
    if (audit) {
      recordEvent(
        audit,
        { action: "auth.logout", resource_type: "session", resource_id: null },
        "success",
        200,
      );
    }
  }
  return typedJsonResponse(authLogoutResponseSchema, { ok: true }, env, {
    headers: { "Set-Cookie": clearSessionCookie(env, request) },
  });
}

function recordAuthEvent(
  ctx: ExecutionContext | undefined,
  env: Env,
  request: Request,
  tenantId: string | null,
  role: string,
  userId: string,
  email: string,
  success: boolean,
): void {
  const audit = buildAuthAuditContext(ctx, env, request, tenantId, role, userId, email);
  if (!audit) return;
  recordEvent(
    audit,
    {
      action: success ? "auth.login" : "auth.login_failed",
      resource_type: "session",
      resource_id: null,
    },
    success ? "success" : "failure",
    success ? 200 : 401,
  );
}

/**
 * Build the AuditContext for an auth event. Customers see events under
 * their tenant; admins (no tenant binding) get the platform-scoped admin
 * audit log. Users with neither a tenant nor admin role are silently
 * dropped — there's nowhere to attribute the event to.
 */
function buildAuthAuditContext(
  ctx: ExecutionContext | undefined,
  env: Env,
  request: Request,
  tenantId: string | null,
  role: string,
  userId: string,
  email: string,
): AuditContext | null {
  if (!ctx) return null;
  const actor = userActor(request, { user_id: userId, email });
  if (tenantId) {
    return tenantAuditContext({ ctx, env, request, tenant_id: tenantId, actor });
  }
  if (role === "admin") {
    return adminAuditContext({ ctx, env, request, actor });
  }
  return null;
}

// ─── GET /auth/me ───────────────────────────────────────────────────

async function handleMe(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth) return jsonError("Not authenticated", 401);
  const payload: AuthMeResponse = { user: auth };
  return typedJsonResponse(authMeResponseSchema, payload, env);
}

async function handleGitHubStart(request: Request, env: Env): Promise<Response> {
  const clientId = githubClientId(env);
  const clientSecret = githubClientSecret(env);
  if (!clientId || !clientSecret) {
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
  };
  const signedState = await signState(state, env.O11YFLEET_CLAIM_HMAC_SECRET);
  const callbackUrl = `${requestOrigin(request)}/auth/github/callback`;
  const github = new ArcticGitHub(clientId, clientSecret, callbackUrl);
  const authorizeUrl = github.createAuthorizationURL(signedState, ["user:email"]);

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

  const callbackUrl = `${requestOrigin(request)}/auth/github/callback`;
  const github = new ArcticGitHub(clientId, clientSecret, callbackUrl);
  let accessToken: string;
  try {
    const tokens = await github.validateAuthorizationCode(code);
    accessToken = tokens.accessToken();
  } catch (err) {
    const message =
      err instanceof OAuth2RequestError
        ? (err.description ?? err.code)
        : "GitHub token exchange failed";
    throw new ApiError(message, 502);
  }
  const profile = await fetchGitHubProfile(accessToken);
  const email = await fetchGitHubPrimaryEmail(accessToken);
  const user = await findOrCreateGitHubUser(env, profile, email, state.plan ?? "starter");

  // Fetch tenant status for the response
  let tenantStatus: TenantApprovalStatus = "pending";
  if (user.tenant_id) {
    const tenant = await getDb(env.FP_DB)
      .selectFrom("tenants")
      .select("status")
      .where("id", "=", user.tenant_id)
      .executeTakeFirst();
    tenantStatus = (tenant?.status as TenantApprovalStatus | null) ?? "pending";
  }

  return createSessionResponse(
    request,
    env,
    { ...user, tenant_status: tenantStatus },
    tenantStatus === "pending" ? undefined : state.returnTo,
  );
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
  tenant_status?: string;
}> {
  const providerUserId = String(profile.id);
  const db = getDb(env.FP_DB);
  const identity = await db
    .selectFrom("auth_identities as ai")
    .innerJoin("users as u", "u.id", "ai.user_id")
    .leftJoin("tenants as t", "t.id", "u.tenant_id")
    .select([
      "u.id",
      "u.email",
      "u.display_name",
      "u.role",
      "u.tenant_id",
      "t.status as tenant_status",
    ])
    .where("ai.provider", "=", "github")
    .where("ai.provider_user_id", "=", providerUserId)
    .executeTakeFirst();
  if (identity) {
    await db
      .updateTable("auth_identities")
      .set({
        provider_login: profile.login,
        provider_email: email,
        updated_at: sql`datetime('now')`,
      })
      .where("provider", "=", "github")
      .where("provider_user_id", "=", providerUserId)
      .execute();
    return {
      ...identity,
      tenant_status: identity.tenant_status ?? undefined,
    };
  }

  let user = await db
    .selectFrom("users")
    .select(["id", "email", "display_name", "role", "tenant_id"])
    .where("email", "=", email)
    .executeTakeFirst();

  if (user && (user.role !== "member" || !user.tenant_id)) {
    throw new ApiError("Existing account is not eligible for self-service GitHub login", 409);
  }

  if (!user) {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const displayName = profile.name?.trim() || profile.login;
    const { max_configs, max_agents_per_config } = getPlanLimits(plan);
    // Determine initial tenant status based on auto-approval setting
    const tenantStatus = isAutoApproveEnabled(env) ? "active" : "pending";

    // Atomic D1 batch — both rows commit or neither does. env.FP_DB.batch
    // is the only way to get atomic multi-statement commits on D1
    // (kysely-d1 doesn't support transactions); compileForBatch keeps the
    // statement bodies type-checked.
    const batchDb = getDb(env.FP_DB);
    await env.FP_DB.batch([
      compileForBatch(
        batchDb.insertInto("tenants").values({
          id: tenantId,
          name: `${profile.login}'s workspace`,
          plan,
          status: tenantStatus,
          max_configs,
          max_agents_per_config,
          approved_at: sql<string>`datetime('now')`,
        }),
        env.FP_DB,
      ),
      compileForBatch(
        batchDb.insertInto("users").values({
          id: userId,
          email,
          password_hash: `external:github:${providerUserId}`,
          display_name: displayName,
          role: "member",
          tenant_id: tenantId,
        }),
        env.FP_DB,
      ),
    ]);
    user = {
      id: userId,
      email,
      display_name: displayName,
      role: "member",
      tenant_id: tenantId,
    };
  }

  await db
    .insertInto("auth_identities")
    .values({
      user_id: user.id,
      provider: "github",
      provider_user_id: providerUserId,
      provider_login: profile.login,
      provider_email: email,
    })
    .onConflict((oc) =>
      oc.columns(["provider", "provider_user_id"]).doUpdateSet({
        user_id: (eb) => eb.ref("excluded.user_id"),
        provider_login: (eb) => eb.ref("excluded.provider_login"),
        provider_email: (eb) => eb.ref("excluded.provider_email"),
        updated_at: sql`datetime('now')`,
      }),
    )
    .execute();

  return {
    ...user,
    tenant_status: undefined, // Will be determined at login time from tenant record
  };
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
  };
  const signedState = await signState(state, env.O11YFLEET_CLAIM_HMAC_SECRET);
  // Canonical manifest lives in infra/github-app/o11yfleet.json so the
  // permission set is diff-reviewable. See that file's README for why.
  const manifest = renderGitHubAppManifest({ origin, siteOrigin });
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
  if (!res.ok) {
    await res.body?.cancel();
    return jsonError("GitHub App manifest conversion failed", 502);
  }
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

function defaultSeedTenantId(env: Env): string {
  const environment = env.ENVIRONMENT?.trim() || "local";
  const suffix = environment.replace(/[^A-Za-z0-9_-]/g, "-");
  return `seed-${suffix || "local"}`;
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

  const tenantEmail = e.O11YFLEET_SEED_TENANT_USER_EMAIL?.trim() || "demo@o11yfleet.com";
  const tenantPassword = e.O11YFLEET_SEED_TENANT_USER_PASSWORD ?? "demo-password";
  const db = getDb(env.FP_DB);
  const existingTenantUser = await db
    .selectFrom("users")
    .select(["id", "tenant_id"])
    .where("email", "=", tenantEmail)
    .executeTakeFirst();

  const requestedTenantId = body.tenant_id ?? existingTenantUser?.tenant_id;
  if (existingTenantUser && !requestedTenantId) {
    return Response.json(
      {
        error: `User ${tenantEmail} has no tenant binding; refusing implicit reseed`,
        code: "TENANT_CONFLICT",
      },
      { status: 409 },
    );
  }
  const tenantId = requestedTenantId ?? defaultSeedTenantId(env);
  const tenantName = body.tenant_name ?? "Local Dev";

  if (existingTenantUser && existingTenantUser.tenant_id !== tenantId) {
    return Response.json(
      {
        error: `User ${tenantEmail} already belongs to tenant ${existingTenantUser.tenant_id ?? "none"}; refusing to move to ${tenantId}`,
        code: "TENANT_CONFLICT",
      },
      { status: 409 },
    );
  }

  const seedPlan = "growth";
  const { max_configs, max_agents_per_config } = getPlanLimits(seedPlan);
  await db
    .insertInto("tenants")
    .values({ id: tenantId, name: tenantName, plan: seedPlan, max_configs, max_agents_per_config })
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        name: (eb) => eb.ref("excluded.name"),
        plan: (eb) => eb.ref("excluded.plan"),
        max_configs: (eb) => eb.ref("excluded.max_configs"),
        max_agents_per_config: (eb) => eb.ref("excluded.max_agents_per_config"),
        updated_at: sql`datetime('now')`,
      }),
    )
    .execute();
  results.push(`Using seed tenant: ${tenantId}`);

  // Upsert tenant user — always bind to this tenant
  const tenantPasswordHash = await hashPassword(tenantPassword);
  if (!existingTenantUser) {
    await db
      .insertInto("users")
      .values({
        id: crypto.randomUUID(),
        email: tenantEmail,
        password_hash: tenantPasswordHash,
        display_name: "Demo User",
        role: "member",
        tenant_id: tenantId,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  const currentTenantUser = await db
    .selectFrom("users")
    .select(["id", "tenant_id"])
    .where("email", "=", tenantEmail)
    .executeTakeFirst();
  if (!currentTenantUser || currentTenantUser.tenant_id !== tenantId) {
    return Response.json(
      {
        error: `User ${tenantEmail} already belongs to tenant ${currentTenantUser?.tenant_id ?? "unknown"}; refusing to move to ${tenantId}`,
        code: "TENANT_CONFLICT",
      },
      { status: 409 },
    );
  }
  await db
    .updateTable("users")
    .set({ password_hash: tenantPasswordHash })
    .where("email", "=", tenantEmail)
    .where("tenant_id", "=", tenantId)
    .execute();
  results.push(`${existingTenantUser ? "Updated" : "Created"} tenant user: ${tenantEmail}`);

  // Upsert admin user (no tenant binding)
  const adminEmail = e.O11YFLEET_SEED_ADMIN_EMAIL?.trim() || "admin@o11yfleet.com";
  const adminPassword = e.O11YFLEET_SEED_ADMIN_PASSWORD ?? "admin-password";
  const existingAdmin = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", adminEmail)
    .executeTakeFirst();
  if (!existingAdmin) {
    const hash = await hashPassword(adminPassword);
    await db
      .insertInto("users")
      .values({
        id: crypto.randomUUID(),
        email: adminEmail,
        password_hash: hash,
        display_name: "Admin",
        role: "admin",
        tenant_id: null,
      })
      .execute();
    results.push(`Created admin user: ${adminEmail}`);
  } else {
    const hash = await hashPassword(adminPassword);
    await db
      .updateTable("users")
      .set({ password_hash: hash })
      .where("email", "=", adminEmail)
      .execute();
    results.push(`Updated admin user password: ${adminEmail}`);
  }

  const payload: AuthSeedResponse = { seeded: results, tenantId };
  return typedJsonResponse(authSeedResponseSchema, payload, env);
}
