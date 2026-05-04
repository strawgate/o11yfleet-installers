// Hono application for o11yfleet Worker /api/v1/* routes.
//
// Phase 1: Hono handles all /api/v1/* routes via middleware + typed route handlers.
// Non-API routes (WebSocket, auth, health, OTLP, admin) remain in the legacy
// router (index.ts) and will be migrated in future phases.
//
// Architecture:
//   index.ts handleRequest()
//     └─ /api/v1/*  →  v1App.fetch(request, env, ctx)
//         ├─ middleware: CSRF guard
//         ├─ middleware: auth (resolves tenantId + audit context)
//         ├─ middleware: CORS + security headers (after handler)
//         ├─ onError: ApiError / AiApiError → JSON
//         └─ v1Router: all /api/v1/* route handlers

import { Hono } from "hono";
import type { Env } from "./index.js";
import type { AuditContext } from "./audit/recorder.js";
import { v1Router } from "./routes/v1/index.js";
import { authenticate } from "./routes/auth.js";
import {
  apiKeyActor,
  systemActor,
  tenantAuditContext,
  userActor,
} from "./audit/recorder.js";
import { isApiKey, verifyApiKey } from "@o11yfleet/core/auth";
import { timingSafeEqual } from "./utils/crypto.js";
import { isAllowedCorsOrigin, PRODUCTION_ORIGINS } from "./shared/origins.js";
import { ApiError } from "./shared/errors.js";
import { AiApiError } from "./ai/guidance.js";

/** Hono context variables set by middleware, available to all handlers. */
export interface AppVariables {
  /** Resolved tenant ID from API key, session, or Bearer+header. */
  tenantId: string;
  /** Audit context for recording mutations. */
  audit: AuditContext;
}

// ─── CORS helpers ────────────────────────────────────────────────────

function getCorsHeaders(origin: string, env: Env): Record<string, string> {
  const allowed = isAllowedCorsOrigin(origin, env.ENVIRONMENT);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : PRODUCTION_ORIGINS[0]!,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Tenant-Id",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function addSecurityHeaders(resp: Response): Response {
  resp.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  resp.headers.set("X-Content-Type-Options", "nosniff");
  resp.headers.set("X-Frame-Options", "DENY");
  resp.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  resp.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return resp;
}

// ─── CSRF helpers ───────────────────────────────────────────────────

const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isTrustedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (origin) return isAllowedCorsOrigin(origin, env.ENVIRONMENT);
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return isAllowedCorsOrigin(new URL(referer).origin, env.ENVIRONMENT);
    } catch {
      return false;
    }
  }
  return false;
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

type V1HonoEnv = { Bindings: Env; Variables: AppVariables };

const app = new Hono<V1HonoEnv>();

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

// ─── Auth middleware: resolves tenantId + audit context ──────────────

app.use("*", async (c, next) => {
  let apiKeyTenantId: string | null = null;
  let apiKeyJti: string | null = null;
  let hasApiSecretBearer = false;

  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const origin = c.req.header("Origin") ?? "";

  if (token) {
    if (isApiKey(token)) {
      try {
        const claim = await verifyApiKey(token, c.env.O11YFLEET_CLAIM_HMAC_SECRET);
        apiKeyTenantId = claim.tenant_id;
        apiKeyJti = claim.jti;
      } catch (err) {
        return jsonErrorResponse(
          err instanceof Error ? err.message : "Invalid API key",
          401,
          origin,
          c.env,
        );
      }
    } else if (
      c.env.O11YFLEET_API_BEARER_SECRET &&
      timingSafeEqual(token, c.env.O11YFLEET_API_BEARER_SECRET)
    ) {
      hasApiSecretBearer = true;
    }
    // OIDC is only for admin routes — not handled here
  }

  // Session auth (cookie) — non-fatal if D1 is overloaded
  let sessionAuth: Awaited<ReturnType<typeof authenticate>> = null;
  try {
    sessionAuth = await authenticate(c.req.raw, c.env);
  } catch {
    // D1 overloaded — session auth unavailable
  }

  // Resolve tenant: API key claim > session cookie > X-Tenant-Id header (with Bearer auth only)
  let tenantId: string | null = null;
  if (apiKeyTenantId) {
    tenantId = apiKeyTenantId;
  } else if (sessionAuth?.tenantId) {
    tenantId = sessionAuth.tenantId;
  } else if (hasApiSecretBearer) {
    tenantId = c.req.header("X-Tenant-Id") ?? null;
  }

  if (!tenantId) {
    return jsonErrorResponse("Authentication required", 401, origin, c.env);
  }

  // Build audit actor
  let actor;
  if (sessionAuth) {
    actor = userActor(c.req.raw, {
      user_id: sessionAuth.userId,
      email: sessionAuth.email,
      impersonator_user_id: sessionAuth.isImpersonation
        ? (sessionAuth.impersonatorUserId ?? null)
        : null,
    });
  } else if (apiKeyJti) {
    actor = apiKeyActor(c.req.raw, { api_key_id: apiKeyJti });
  } else {
    actor = systemActor(c.req.raw);
  }

  const audit = tenantAuditContext({
    ctx: c.executionCtx,
    env: c.env,
    request: c.req.raw,
    tenant_id: tenantId,
    actor,
  });

  c.set("tenantId", tenantId);
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
  console.error("V1 API error:", c.req.path, err);
  return jsonErrorResponse("Internal server error", 500, origin, c.env);
});

// ─── Mount v1 route group under /api/v1 ─────────────────────────────

app.route("/api/v1", v1Router);

export { app as v1App };
