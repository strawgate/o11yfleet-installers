// FleetPlane Worker — main entry point

export { ConfigDurableObject } from "./durable-objects/config-do.js";
import { handleApiRequest } from "./routes/api/index.js";
import { handleQueueBatch } from "./event-consumer.js";
import { verifyClaim, hashEnrollmentToken } from "@o11yfleet/core/auth";
import type { AnyFleetEvent } from "@o11yfleet/core/events";

export interface Env {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_EVENTS: Queue;
  CONFIG_DO: DurableObjectNamespace;
  FP_ANALYTICS: AnalyticsEngineDataset;
  CLAIM_SECRET: string;
  API_SECRET?: string; // C1 fix: optional API auth key
}

// CORS headers for management UI
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Headers we use internally — MUST be stripped from external requests
const INTERNAL_HEADERS = [
  "x-fp-tenant-id",
  "x-fp-config-id",
  "x-fp-instance-uid",
  "x-fp-enrollment",
];

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // API routes — with auth + CORS
    if (url.pathname.startsWith("/api/")) {
      // C1 fix: Authenticate API requests when API_SECRET is set
      if (env.API_SECRET) {
        const auth = request.headers.get("Authorization");
        if (!auth || auth !== `Bearer ${env.API_SECRET}`) {
          return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
        }
      }
      const resp = await handleApiRequest(request, env, url);
      // Add CORS headers to all API responses
      const corsResp = new Response(resp.body, resp);
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        corsResp.headers.set(k, v);
      }
      return corsResp;
    }

    // OpAMP WebSocket endpoint
    if (url.pathname === "/v1/opamp") {
      return handleOpampRequest(request, env);
    }

    return new Response("Not found", { status: 404 });
  },

  async queue(batch: MessageBatch<AnyFleetEvent>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env as unknown as { FP_DB: D1Database; FP_ANALYTICS: AnalyticsEngineDataset });
  },
};

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

      return stub.fetch(new Request(request.url, {
        method: request.method,
        headers: cleanHeaders,
      }));
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

  return stub.fetch(new Request(request.url, {
    method: request.method,
    headers: cleanHeaders,
  }));
}
