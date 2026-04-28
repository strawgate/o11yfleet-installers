// FleetPlane Worker — main entry point

export { ConfigDurableObject } from "./durable-objects/config-do.js";
import { handleApiRequest } from "./routes/api/index.js";
import { handleAdminRequest } from "./routes/admin/index.js";
import { handleV1Request } from "./routes/v1/index.js";
import { handleAuthRequest, authenticate } from "./routes/auth.js";
import { handleQueueBatch } from "./event-consumer.js";
import { timingSafeEqual } from "./utils/crypto.js";
import { verifyClaim, hashEnrollmentToken } from "@o11yfleet/core/auth";
import type { AnyFleetEvent } from "@o11yfleet/core/events";

export interface Env {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_EVENTS: Queue;
  CONFIG_DO: DurableObjectNamespace;
  FP_ANALYTICS?: AnalyticsEngineDataset;
  CLAIM_SECRET: string;
  API_SECRET?: string;
  SEED_TENANT_USER_EMAIL?: string;
  SEED_TENANT_USER_PASSWORD?: string;
  SEED_ADMIN_EMAIL?: string;
  SEED_ADMIN_PASSWORD?: string;
}

// Allowed CORS origins for credential-based requests
const ALLOWED_ORIGINS = [
  "https://app.o11yfleet.com",
  "https://admin.o11yfleet.com",
  "https://o11yfleet.com",
  "https://www.o11yfleet.com",
  "http://localhost:3000",
  "http://localhost:8788",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8788",
];

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  // Allow *.o11yfleet-site.pages.dev for Cloudflare Pages previews
  const allowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".o11yfleet-site.pages.dev");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : (ALLOWED_ORIGINS[0] ?? ""),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Tenant-Id",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

// Headers we use internally — MUST be stripped from external requests
const INTERNAL_HEADERS = [
  "x-fp-tenant-id",
  "x-fp-config-id",
  "x-fp-instance-uid",
  "x-fp-enrollment",
];

function addCorsHeaders(resp: Response, request: Request): Response {
  const corsResp = new Response(resp.body, resp);
  const corsHeaders = getCorsHeaders(request);
  for (const [k, v] of Object.entries(corsHeaders)) {
    corsResp.headers.set(k, v);
  }
  return corsResp;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error("Unhandled error:", err);
      const corsHeaders = getCorsHeaders(request);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  },

  async queue(batch: MessageBatch<AnyFleetEvent>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env as unknown as { FP_ANALYTICS: AnalyticsEngineDataset });
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Health check
  if (url.pathname === "/healthz") {
    return Response.json(
      { status: "ok", timestamp: new Date().toISOString() },
      { headers: getCorsHeaders(request) },
    );
  }

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  // Auth routes — no auth required (they handle their own)
  if (url.pathname.startsWith("/auth/")) {
    const resp = await handleAuthRequest(request, env, url);
    return addCorsHeaders(resp, request);
  }

  // API routes — with auth + CORS
  if (url.pathname.startsWith("/api/")) {
    // Check Bearer token first (programmatic API access)
    let hasBearerAuth = false;
    if (env.API_SECRET) {
      const auth = request.headers.get("Authorization");
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (token && timingSafeEqual(token, env.API_SECRET)) {
        hasBearerAuth = true;
      }
    }

    // Try session-based auth (cookie)
    const sessionAuth = await authenticate(request, env);

    let resp: Response;

    // Admin routes — /api/admin/*
    if (url.pathname.startsWith("/api/admin/")) {
      // Require either Bearer API_SECRET or admin session
      if (!hasBearerAuth && (!sessionAuth || sessionAuth.role !== "admin")) {
        return addCorsHeaders(
          Response.json({ error: "Admin access required" }, { status: 403 }),
          request,
        );
      }
      resp = await handleAdminRequest(request, env, url);
    }
    // Tenant-scoped routes — /api/v1/*
    else if (url.pathname.startsWith("/api/v1/")) {
      // Resolve tenant: session cookie > X-Tenant-Id header (with Bearer auth)
      let tenantId: string | null = null;
      if (sessionAuth?.tenantId) {
        tenantId = sessionAuth.tenantId;
      } else if (hasBearerAuth) {
        tenantId = request.headers.get("X-Tenant-Id");
      }
      if (!tenantId) {
        return addCorsHeaders(
          Response.json({ error: "Authentication required" }, { status: 401 }),
          request,
        );
      }
      resp = await handleV1Request(request, env, url, tenantId);
    }
    // Legacy routes — /api/*
    else {
      if (!hasBearerAuth && !sessionAuth) {
        return addCorsHeaders(
          Response.json({ error: "Authentication required" }, { status: 401 }),
          request,
        );
      }
      resp = await handleApiRequest(request, env, url, sessionAuth?.tenantId);
    }

    return addCorsHeaders(resp, request);
  }

  // OpAMP WebSocket endpoint
  if (url.pathname === "/v1/opamp") {
    if (!env.CLAIM_SECRET) {
      return new Response("Server misconfigured: CLAIM_SECRET not set", { status: 500 });
    }
    return handleOpampRequest(request, env);
  }

  return new Response("Not found", { status: 404 });
}

/**
 * Phase 3A — Ingress Router for OpAMP WebSocket connections
 *
 * Hot path: Assignment claim in Authorization header → verify locally → route to DO
 * Cold path: Enrollment token → hash → D1 lookup → route to DO
 * Security: Strip all x-fp-* headers from external requests
 */
async function handleOpampRequest(request: Request, env: Env): Promise<Response> {
  // Must be WebSocket upgrade
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }

  // Auth: prefer Authorization header, fall back to ?token= query param
  // Query param is needed because browser/Node.js WebSocket API cannot set custom headers
  const url = new URL(request.url);
  const auth = request.headers.get("Authorization");
  let token: string | null = null;

  if (auth?.startsWith("Bearer ")) {
    token = auth.slice(7);
  } else if (url.searchParams.has("token")) {
    token = url.searchParams.get("token");
  }

  if (!token) {
    return Response.json({ error: "Authorization required" }, { status: 401 });
  }

  // Build clean headers — strip ALL external x-fp-* headers (security: header spoofing prevention)
  const cleanHeaders = new Headers(request.headers);
  for (const h of INTERNAL_HEADERS) {
    cleanHeaders.delete(h);
  }

  // Try hot path: signed assignment claim
  if (!token.startsWith("fp_enroll_")) {
    try {
      const claim = await verifyClaim(token, env.CLAIM_SECRET);
      // Route to DO based on claim
      const doName = `${claim.tenant_id}:${claim.config_id}`;
      const doId = env.CONFIG_DO.idFromName(doName);
      const stub = env.CONFIG_DO.get(doId);

      // Set internal headers for DO
      cleanHeaders.set("x-fp-tenant-id", claim.tenant_id);
      cleanHeaders.set("x-fp-config-id", claim.config_id);
      cleanHeaders.set("x-fp-instance-uid", claim.instance_uid);

      return stub.fetch(
        new Request(request.url, {
          method: request.method,
          headers: cleanHeaders,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid claim";
      return Response.json({ error: msg }, { status: 401 });
    }
  }

  // Cold path: enrollment token
  const tokenHash = await hashEnrollmentToken(token);
  const enrollment = await env.FP_DB.prepare(
    `SELECT et.*, c.tenant_id, c.name as config_name
     FROM enrollment_tokens et
     JOIN configurations c ON et.config_id = c.id
     WHERE et.token_hash = ? AND et.revoked_at IS NULL`,
  )
    .bind(tokenHash)
    .first<{
      config_id: string;
      tenant_id: string;
      expires_at: string | null;
    }>();

  if (!enrollment) {
    return Response.json({ error: "Invalid enrollment token" }, { status: 401 });
  }

  // Check expiry
  if (enrollment.expires_at && new Date(enrollment.expires_at) < new Date()) {
    return Response.json({ error: "Enrollment token expired" }, { status: 401 });
  }

  // Route to DO
  const doName = `${enrollment.tenant_id}:${enrollment.config_id}`;
  const doId = env.CONFIG_DO.idFromName(doName);
  const stub = env.CONFIG_DO.get(doId);

  // Generate a temporary instance UID for the enrolling agent
  const instanceUid = crypto.randomUUID().replace(/-/g, "");

  cleanHeaders.set("x-fp-tenant-id", enrollment.tenant_id);
  cleanHeaders.set("x-fp-config-id", enrollment.config_id);
  cleanHeaders.set("x-fp-instance-uid", instanceUid);
  cleanHeaders.set("x-fp-enrollment", "true");

  return stub.fetch(
    new Request(request.url, {
      method: request.method,
      headers: cleanHeaders,
    }),
  );
}
