// Hono application for o11yfleet Worker /api/v1/* routes.
//
// Phase 1: Hono handles all /api/v1/* routes via middleware + typed route handlers.
// Non-API routes (WebSocket, auth, health, OTLP, admin) remain in the legacy
// router (index.ts) and will be migrated in future phases.
//
// Architecture:
//   index.ts handleRequest()
//     └─ /api/v1/*  →  v1App.fetch(request, env, ctx)
//         ├─ middleware: secureHeaders (hono built-in)
//         ├─ middleware: cors (hono built-in, origin allowlist)
//         ├─ middleware: CSRF guard
//         ├─ middleware: auth (resolves tenantId + audit context)
//         ├─ onError: ApiError / AiApiError → JSON
//         └─ v1Router: all /api/v1/* route handlers

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./index.js";
import type { AuditContext } from "./audit/recorder.js";
import { v1Router } from "./routes/v1/index.js";
import { authenticate } from "./routes/auth.js";
import { apiKeyActor, systemActor, tenantAuditContext, userActor } from "./audit/recorder.js";
import { isApiKey, verifyApiKey } from "@o11yfleet/core/auth";
import { timingSafeEqual } from "./utils/crypto.js";
import { ApiError } from "./shared/errors.js";
import { AppError } from "./errors.js";
import { AiApiError } from "./ai/guidance.js";
import { CSRF_SAFE_METHODS, isTrustedOrigin } from "./shared/http.js";
import { isAllowedCorsOrigin } from "./shared/origins.js";
import { parseRpcError } from "./durable-objects/rpc-types.js";

/** Hono context variables set by middleware, available to all handlers. */
export interface AppVariables {
  /** Resolved tenant ID from API key, session, or Bearer+header. */
  tenantId: string;
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

type V1HonoEnv = { Bindings: Env; Variables: AppVariables };

const app = new Hono<V1HonoEnv>();

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

// ─── Auth middleware: resolves tenantId + audit context ──────────────

app.use("*", async (c, next) => {
  let apiKeyTenantId: string | null = null;
  let apiKeyJti: string | null = null;
  let hasApiSecretBearer = false;

  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (token) {
    if (isApiKey(token)) {
      try {
        const claim = await verifyApiKey(token, c.env.O11YFLEET_CLAIM_HMAC_SECRET);
        apiKeyTenantId = claim.tenant_id;
        apiKeyJti = claim.jti;
      } catch (err) {
        return jsonErrorResponse(err instanceof Error ? err.message : "Invalid API key", 401);
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
    return jsonErrorResponse("Authentication required", 401);
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
  return next();
});

// ─── Error handling ─────────────────────────────────────────────────

app.onError((err, c) => {
  if (err instanceof AppError) {
    return jsonErrorResponse(err.message, err.statusCode, {
      code: err.code,
      ...(err.requestId ? { request_id: err.requestId } : {}),
    });
  }
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
  console.error("V1 API error:", c.req.path, err);
  return jsonErrorResponse("Internal server error", 500);
});

// ─── Mount v1 route group under /api/v1 ─────────────────────────────

app.route("/api/v1", v1Router);

export { app as v1App };
