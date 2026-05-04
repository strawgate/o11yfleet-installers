// Hono application for o11yfleet Worker /api/admin/* routes.
//
// Phase 3: Hono handles all /api/admin/* routes via middleware + typed route handlers.
// Non-API routes (WebSocket, auth, health, OTLP) remain in the legacy
// router (index.ts).
//
// Architecture:
//   index.ts handleRequest()
//     └─ /api/admin/*  →  adminApp.fetch(request, env, ctx)
//         ├─ middleware: secureHeaders (hono built-in)
//         ├─ middleware: cors (hono built-in, origin allowlist)
//         ├─ middleware: CSRF guard
//         ├─ middleware: admin auth (session role=admin OR OIDC for POST /tenants)
//         ├─ onError: ApiError / AiApiError → JSON
//         └─ adminRouter: all /api/admin/* route handlers

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./index.js";
import type { AuditContext } from "./audit/recorder.js";
import { adminRouter } from "./routes/admin/index.js";
import { authenticate } from "./routes/auth.js";
import { adminAuditContext, systemActor, userActor } from "./audit/recorder.js";
import { verifyGitHubOIDC, looksLikeJWT, type GitHubOIDCClaims } from "./utils/oidc.js";
import { timingSafeEqual } from "./utils/crypto.js";
import { ApiError } from "./shared/errors.js";
import { AiApiError } from "./ai/guidance.js";
import { CSRF_SAFE_METHODS, isTrustedOrigin } from "./shared/http.js";
import { isAllowedCorsOrigin } from "./shared/origins.js";
import { parseRpcError } from "./durable-objects/rpc-types.js";

/** Hono context variables set by admin middleware, available to all handlers. */
export interface AdminAppVariables {
  /** Audit context for recording mutations. */
  audit: AuditContext;
}

function jsonErrorResponse(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Build the Hono app ─────────────────────────────────────────────

type AdminHonoEnv = { Bindings: Env; Variables: AdminAppVariables };

const app = new Hono<AdminHonoEnv>();

// ─── Security + CORS middleware (hono built-in) ─────────────────────

app.use(
  "*",
  secureHeaders({
    strictTransportSecurity: "max-age=63072000; includeSubDomains",
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
  }),
);

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      return isAllowedCorsOrigin(origin, c.env.ENVIRONMENT) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Tenant-Id", "X-Request-Id"],
    exposeHeaders: ["X-Request-Id"],
    credentials: true,
    maxAge: 86400,
  }),
);

// ─── CSRF guard ─────────────────────────────────────────────────────

app.use("*", async (c, next) => {
  const hasCookie = /(?:^|;\s*)fp_session=/.test(c.req.header("Cookie") ?? "");
  if (!CSRF_SAFE_METHODS.has(c.req.method) && hasCookie && !isTrustedOrigin(c.req.raw, c.env)) {
    return jsonErrorResponse("Forbidden — origin not allowed", 403);
  }
  return next();
});

// ─── Admin auth middleware ───────────────────────────────────────────

app.use("*", async (c, next) => {
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
    return jsonErrorResponse(body.error, 403, body);
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
  return next();
});

// ─── Error handling ─────────────────────────────────────────────────

app.onError((err, c) => {
  const rpcErr = parseRpcError(err);
  if (rpcErr) {
    return jsonErrorResponse(rpcErr.message, rpcErr.statusCode);
  }
  if (err instanceof ApiError) {
    return jsonErrorResponse(err.message, err.status, {
      ...(err.code ? { code: err.code } : {}),
      ...(err.field ? { field: err.field } : {}),
      ...(err.detail ? { detail: err.detail } : {}),
    });
  }
  if (err instanceof AiApiError) {
    return jsonErrorResponse(err.message, err.status);
  }
  if (err instanceof HTTPException) {
    return jsonErrorResponse(err.message, err.status);
  }
  console.error("Admin API error:", c.req.path, err);
  return jsonErrorResponse("Internal server error", 500);
});

// ─── Mount admin route group under /api/admin ───────────────────────

app.route("/api/admin", adminRouter);

export { app as adminApp };
