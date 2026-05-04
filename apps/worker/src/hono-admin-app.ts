// Hono application for o11yfleet Worker /api/admin/* routes.
//
// Phase 3: Hono handles all /api/admin/* routes via middleware + typed route handlers.
// Non-API routes (WebSocket, auth, health, OTLP) remain in the legacy
// router (index.ts).
//
// Architecture:
//   index.ts handleRequest()
//     └─ /api/admin/*  →  adminApp.fetch(request, env, ctx)
//         ├─ middleware: CSRF guard
//         ├─ middleware: admin auth (session role=admin OR OIDC for POST /tenants)
//         ├─ middleware: CORS + security headers (after handler)
//         ├─ onError: ApiError / AiApiError → JSON
//         └─ adminRouter: all /api/admin/* route handlers

import { Hono } from "hono";
import type { Env } from "./index.js";
import type { AuditContext } from "./audit/recorder.js";
import { adminRouter } from "./routes/admin/index.js";
import { authenticate } from "./routes/auth.js";
import { adminAuditContext, systemActor, userActor } from "./audit/recorder.js";
import { verifyGitHubOIDC, looksLikeJWT, type GitHubOIDCClaims } from "./utils/oidc.js";
import { timingSafeEqual } from "./utils/crypto.js";
import { ApiError } from "./shared/errors.js";
import { AiApiError } from "./ai/guidance.js";
import {
  getCorsHeadersForOrigin as getCorsHeaders,
  addSecurityHeaders,
  CSRF_SAFE_METHODS,
  isTrustedOrigin,
} from "./shared/http.js";

/** Hono context variables set by admin middleware, available to all handlers. */
export interface AdminAppVariables {
  /** Audit context for recording mutations. */
  audit: AuditContext;
}

function jsonErrorResponse(
  message: string,
  status: number,
  origin: string,
  env: Env,
  extra?: Record<string, unknown>,
): Response {
  const corsHeaders = getCorsHeaders(origin, env);
  return addSecurityHeaders(
    new Response(JSON.stringify({ error: message, ...extra }), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    }),
  );
}

// ─── Build the Hono app ─────────────────────────────────────────────

type AdminHonoEnv = { Bindings: Env; Variables: AdminAppVariables };

const app = new Hono<AdminHonoEnv>();

// ─── CSRF guard ─────────────────────────────────────────────────────

app.use("*", async (c, next) => {
  const hasCookie = /(?:^|;\s*)fp_session=/.test(c.req.header("Cookie") ?? "");
  if (!CSRF_SAFE_METHODS.has(c.req.method) && hasCookie && !isTrustedOrigin(c.req.raw, c.env)) {
    return jsonErrorResponse(
      "Forbidden — origin not allowed",
      403,
      c.req.header("Origin") ?? "",
      c.env,
    );
  }
  await next();
});

// ─── Admin auth middleware ───────────────────────────────────────────

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") ?? "";

  // Session auth (cookie) — non-fatal if D1 is overloaded
  let sessionAuth: Awaited<ReturnType<typeof authenticate>> = null;
  try {
    sessionAuth = await authenticate(c.req.raw, c.env);
  } catch {
    // D1 overloaded — session auth unavailable
  }

  // OIDC verification for CI provisioning (POST /api/admin/tenants only)
  let oidcClaims: GitHubOIDCClaims | null = null;
  let oidcError: string | null = null;

  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token && looksLikeJWT(token) && c.env.O11YFLEET_OIDC_ALLOWED_REPOS) {
    const allowedRepos = c.env.O11YFLEET_OIDC_ALLOWED_REPOS.split(",").map((r) => r.trim());
    const audience = c.env.O11YFLEET_OIDC_AUDIENCE ?? "o11yfleet";
    const result = await verifyGitHubOIDC(token, { audience, allowedRepos });
    if (result.ok) {
      oidcClaims = result.claims;
    } else {
      oidcError = result.error;
    }
  }

  // OIDC "provision" scope: only allows POST /api/admin/tenants (tenant creation).
  const isOidcProvision =
    oidcClaims && c.req.method === "POST" && new URL(c.req.url).pathname === "/api/admin/tenants";

  if (!isOidcProvision && sessionAuth?.role !== "admin") {
    // Determine error body based on auth attempt.
    // Only treat the bearer as an API secret if it actually matches the
    // configured secret (timing-safe). This is used purely to pick the
    // error message, but correctness still matters.
    const hasApiSecretBearer =
      token !== null &&
      !looksLikeJWT(token) &&
      !!c.env.O11YFLEET_API_BEARER_SECRET &&
      timingSafeEqual(token, c.env.O11YFLEET_API_BEARER_SECRET);
    const body = hasApiSecretBearer
      ? { error: "Admin session required", code: "admin_session_required" }
      : oidcClaims
        ? { error: "OIDC scope insufficient", code: "oidc_scope_insufficient" }
        : { error: "Admin access required", oidc_error: oidcError };
    return jsonErrorResponse(body.error, 403, origin, c.env, body);
  }

  // Build audit actor
  const adminActor = sessionAuth
    ? userActor(c.req.raw, { user_id: sessionAuth.userId, email: sessionAuth.email })
    : systemActor(c.req.raw);
  const audit = adminAuditContext({
    ctx: c.executionCtx,
    env: c.env,
    request: c.req.raw,
    actor: adminActor,
  });

  c.set("audit", audit);
  await next();
});

// ─── CORS + security headers (after handler) ────────────────────────

app.use("*", async (c, next) => {
  await next();

  const origin = c.req.header("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin, c.env);
  for (const [k, v] of Object.entries(corsHeaders)) {
    c.res.headers.set(k, v);
  }
  addSecurityHeaders(c.res);
});

// ─── Error handling ─────────────────────────────────────────────────

app.onError((err, c) => {
  const origin = c.req.header("Origin") ?? "";
  if (err instanceof ApiError) {
    return jsonErrorResponse(err.message, err.status, origin, c.env, {
      ...(err.code ? { code: err.code } : {}),
      ...(err.field ? { field: err.field } : {}),
      ...(err.detail ? { detail: err.detail } : {}),
    });
  }
  if (err instanceof AiApiError) {
    return jsonErrorResponse(err.message, err.status, origin, c.env);
  }
  console.error("Admin API error:", c.req.path, err);
  return jsonErrorResponse("Internal server error", 500, origin, c.env);
});

// ─── Mount admin route group under /api/admin ───────────────────────

app.route("/api/admin", adminRouter);

export { app as adminApp };
