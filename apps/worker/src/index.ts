// o11yfleet Worker — main entry point

export { ConfigDurableObject } from "./durable-objects/config-do.js";
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
  ENVIRONMENT?: string;
  MINIMAX_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  SEED_TENANT_USER_EMAIL?: string;
  SEED_TENANT_USER_PASSWORD?: string;
  SEED_ADMIN_EMAIL?: string;
  SEED_ADMIN_PASSWORD?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ACCOUNT_ANALYTICS_API_KEY?: string;
  CLOUDFLARE_WORKER_SCRIPT_NAME?: string;
  CLOUDFLARE_D1_DATABASE_ID?: string;
  CLOUDFLARE_R2_BUCKET_NAME?: string;
  CLOUDFLARE_ANALYTICS_DATASET?: string;
}

// Production CORS origins (always allowed)
const PRODUCTION_ORIGINS = [
  "https://app.o11yfleet.com",
  "https://admin.o11yfleet.com",
  "https://o11yfleet.com",
  "https://www.o11yfleet.com",
  "https://o11yfleet-site.pages.dev",
];

function isLocalDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Check if origin is a Cloudflare Pages preview deploy (e.g. abc123.o11yfleet-site.pages.dev). */
function isPagesPreview(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    const parts = host.split(".");
    // Must be exactly <hash>.o11yfleet-site.pages.dev (4 segments)
    return parts.length === 4 && host.endsWith(".o11yfleet-site.pages.dev");
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string, env: Env): boolean {
  return (
    PRODUCTION_ORIGINS.includes(origin) ||
    isPagesPreview(origin) ||
    (env.ENVIRONMENT !== "production" && isLocalDevOrigin(origin))
  );
}

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const allowed = isAllowedOrigin(origin, env);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : PRODUCTION_ORIGINS[0]!,
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
  "x-fp-codec",
];

const CRON_SWEEP_CONCURRENCY = 100;
const CRON_SWEEP_TIMEOUT_MS = 2_000;

async function withTimeout<T>(
  start: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    timer = setTimeout(() => {
      controller.abort(message);
    }, timeoutMs);
    return await start(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(message);
    }
    throw err;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const indexedItems = items.map((item, index) => ({ item, index }));
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(concurrency, indexedItems.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const task = indexedItems[nextIndex];
        nextIndex += 1;
        if (!task) break;

        try {
          results[task.index] = { status: "fulfilled", value: await mapper(task.item, task.index) };
        } catch (reason) {
          results[task.index] = { status: "rejected", reason };
        }
      }
    }),
  );

  return results;
}

function addCorsHeaders(resp: Response, request: Request, env: Env): Response {
  const corsResp = new Response(resp.body, resp);
  const corsHeaders = getCorsHeaders(request, env);
  for (const [k, v] of Object.entries(corsHeaders)) {
    corsResp.headers.set(k, v);
  }
  return corsResp;
}

function addSecurityHeaders(resp: Response): Response {
  resp.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  resp.headers.set("X-Content-Type-Options", "nosniff");
  resp.headers.set("X-Frame-Options", "DENY");
  resp.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  resp.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return resp;
}

// CSRF protection: validate Origin header on state-changing requests with cookie auth.
// Browsers always send Origin on cross-origin requests; if missing, check Referer.
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isTrustedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (origin) {
    return isAllowedOrigin(origin, env);
  }
  // Fallback: same-origin requests may omit Origin; check Referer
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return isAllowedOrigin(refOrigin, env);
    } catch {
      return false;
    }
  }
  // No Origin or Referer — reject (browsers always send one on cross-origin)
  return false;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error("Unhandled error:", err);
      const corsHeaders = getCorsHeaders(request, env);
      return addSecurityHeaders(
        new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }),
      );
    }
  },

  async queue(batch: MessageBatch<AnyFleetEvent>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env as unknown as { FP_ANALYTICS: AnalyticsEngineDataset });
  },

  /** Daily stale-agent audit. This is rare reconciliation for missed close/error events. */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const configs = await env.FP_DB.prepare(`SELECT id, tenant_id FROM configurations`).all<{
      id: string;
      tenant_id: string;
    }>();

    if (!configs.results?.length) return;

    const results = await mapWithConcurrency(
      configs.results,
      CRON_SWEEP_CONCURRENCY,
      async (config) => {
        const doName = `${config.tenant_id}:${config.id}`;
        const doId = env.CONFIG_DO.idFromName(doName);
        const stub = env.CONFIG_DO.get(doId);
        const resp = await withTimeout(
          (signal) =>
            stub.fetch(
              new Request("http://do/command/sweep", {
                method: "POST",
                headers: {
                  "x-fp-tenant-id": config.tenant_id,
                  "x-fp-config-id": config.id,
                },
                signal,
              }),
            ),
          CRON_SWEEP_TIMEOUT_MS,
          `[cron] sweep timed out for ${doName}`,
        );
        if (!resp.ok) {
          throw new Error(`[cron] sweep failed for ${doName}: HTTP ${resp.status}`);
        }
        return resp.json<{ swept: number }>();
      },
    );

    const swept = results
      .filter((r): r is PromiseFulfilledResult<{ swept: number }> => r.status === "fulfilled")
      .reduce((sum, r) => sum + r.value.swept, 0);
    const failed = results.filter((r) => r.status === "rejected").length;

    if (swept > 0 || failed > 0) {
      console.warn(
        `[cron] sweep complete: ${swept} stale agents across ${configs.results.length} configs (${failed} failures)`,
      );
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Health check
  if (url.pathname === "/healthz") {
    return addSecurityHeaders(
      Response.json(
        { status: "ok", timestamp: new Date().toISOString() },
        { headers: getCorsHeaders(request, env) },
      ),
    );
  }

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
  }

  // CSRF protection — reject state-changing cookie-authenticated requests from untrusted origins.
  // Only applies when a session cookie is present; Bearer-token M2M clients are exempt.
  // This is required because we use SameSite=None cookies for cross-origin auth.
  const hasCookie = /(?:^|;\s*)fp_session=/.test(request.headers.get("Cookie") ?? "");
  if (!CSRF_SAFE_METHODS.has(request.method) && hasCookie && !isTrustedOrigin(request, env)) {
    return addSecurityHeaders(
      addCorsHeaders(
        Response.json({ error: "Forbidden — origin not allowed" }, { status: 403 }),
        request,
        env,
      ),
    );
  }

  // Auth routes — no auth required (they handle their own)
  if (url.pathname.startsWith("/auth/")) {
    const resp = await handleAuthRequest(request, env, url);
    return addSecurityHeaders(addCorsHeaders(resp, request, env));
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
        return addSecurityHeaders(
          addCorsHeaders(
            Response.json({ error: "Admin access required" }, { status: 403 }),
            request,
            env,
          ),
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
        return addSecurityHeaders(
          addCorsHeaders(
            Response.json({ error: "Authentication required" }, { status: 401 }),
            request,
            env,
          ),
        );
      }
      resp = await handleV1Request(request, env, url, tenantId);
    }
    // Unknown API routes
    else {
      resp = Response.json({ error: "Not found" }, { status: 404 });
    }

    return addSecurityHeaders(addCorsHeaders(resp, request, env));
  }

  // OpAMP WebSocket endpoint
  if (url.pathname === "/v1/opamp") {
    if (!env.CLAIM_SECRET) {
      return new Response("Server misconfigured: CLAIM_SECRET not set", { status: 500 });
    }
    return handleOpampRequest(request, env);
  }

  return addSecurityHeaders(new Response("Not found", { status: 404 }));
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
