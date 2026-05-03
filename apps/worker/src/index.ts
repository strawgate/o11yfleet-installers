// o11yfleet Worker — main entry point

export { ConfigDurableObject } from "./durable-objects/config-do.js";
export { ConfigValidationWorkflow } from "./workflows/config-validation.js";
import { handleAdminRequest } from "./routes/admin/index.js";
import { handleV1Request } from "./routes/v1/index.js";
import { handleAuthRequest, authenticate } from "./routes/auth.js";
import { getDb } from "./db/client.js";
import { runManifestDriftCheck } from "./jobs/manifest-drift-check.js";
import { timingSafeEqual } from "./utils/crypto.js";
import { verifyGitHubOIDC, looksLikeJWT, type GitHubOIDCClaims } from "./utils/oidc.js";
import { verifyClaim, verifyEnrollmentToken, isApiKey, verifyApiKey } from "@o11yfleet/core/auth";
import { isAllowedCorsOrigin, PRODUCTION_ORIGINS } from "./shared/origins.js";
import type { AuditEvent } from "@o11yfleet/core/audit";

export interface Env {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  CONFIG_DO: DurableObjectNamespace;
  CONFIG_VALIDATION: Workflow;
  FP_ANALYTICS?: AnalyticsEngineDataset;
  /** Audit log queue. Producer: each mutating handler. Consumer: queue() in this Worker. */
  AUDIT_QUEUE?: Queue<AuditEvent>;
  O11YFLEET_CLAIM_HMAC_SECRET: string;
  O11YFLEET_API_BEARER_SECRET?: string;
  ENVIRONMENT?: "staging" | "dev" | "production";
  O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY?: string;
  O11YFLEET_AI_GUIDANCE_PROVIDER?: string;
  O11YFLEET_AI_GUIDANCE_MODEL?: string;
  O11YFLEET_AI_GUIDANCE_BASE_URL?: string;
  O11YFLEET_SEED_TENANT_USER_EMAIL?: string;
  O11YFLEET_SEED_TENANT_USER_PASSWORD?: string;
  O11YFLEET_SEED_ADMIN_EMAIL?: string;
  O11YFLEET_SEED_ADMIN_PASSWORD?: string;
  CLOUDFLARE_BILLING_ACCOUNT_ID?: string;
  CLOUDFLARE_BILLING_API_TOKEN?: string;
  CLOUDFLARE_METRICS_ACCOUNT_ID?: string;
  CLOUDFLARE_METRICS_API_TOKEN?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_WEBHOOK_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  /** Comma-separated repos allowed to use OIDC provisioning (e.g. "strawgate/o11yfleet-load"). */
  O11YFLEET_OIDC_ALLOWED_REPOS?: string;
  /** OIDC audience claim (defaults to "o11yfleet"). */
  O11YFLEET_OIDC_AUDIENCE?: string;
  /** Enable auto-approval of new tenant signups. Set to "true" to auto-approve (post-soft-launch). */
  O11YFLEET_SIGNUP_AUTO_APPROVE?: string;
  /** Cloudflare Email Service binding for sending emails. */
  CLOUDFLARE_EMAIL_SENDER?: {
    send(options: {
      to: string[];
      from: string;
      subject: string;
      body: string;
      bodyType: "text" | "html";
    }): Promise<void>;
  };
  /** Default email from address for outgoing emails. */
  O11YFLEET_EMAIL_FROM?: string;
  /** Enable OpAMP frame debug logging. Set to "1" to log decoded AgentToServer frames. */
  OPAMP_FRAME_DEBUG?: string;
}

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const allowed = isAllowedCorsOrigin(origin, env.ENVIRONMENT);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : PRODUCTION_ORIGINS[0]!,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Tenant-Id",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

// Headers we use internally — MUST be stripped from external requests.
// Anything an external client could spoof has to be listed here so the
// strip pass in `handleOpampRequest` removes it before forwarding to the
// Config DO.
const INTERNAL_HEADERS = [
  "x-fp-tenant-id",
  "x-fp-config-id",
  "x-fp-instance-uid",
  "x-fp-enrollment",
  "x-fp-codec",
  "x-fp-max-agents-per-config",
];

const CRON_SWEEP_CONCURRENCY = 100;
const CRON_SWEEP_TIMEOUT_MS = 2_000;
const STALE_AGENT_SWEEP_CRON = "17 3 * * *";
const PRODUCT_METRICS_CRON = "0 0 * * *";
const MANIFEST_DRIFT_CHECK_CRON = "12 6 * * *";

type TenantPlanBucket = "free" | "paid" | "enterprise";

function tenantPlanBucket(plan: string): TenantPlanBucket {
  switch (plan) {
    case "enterprise":
      return "enterprise";
    case "hobby":
      return "free";
    case "pro":
    case "starter":
    case "growth":
      return "paid";
    default:
      return "paid";
  }
}

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
    return isAllowedCorsOrigin(origin, env.ENVIRONMENT);
  }
  // Fallback: same-origin requests may omit Origin; check Referer
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return isAllowedCorsOrigin(refOrigin, env.ENVIRONMENT);
    } catch {
      return false;
    }
  }
  // No Origin or Referer — reject (browsers always send one on cross-origin)
  return false;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      console.error("Unhandled error:", new URL(request.url).pathname, err);
      const corsHeaders = getCorsHeaders(request, env);
      return addSecurityHeaders(
        new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }),
      );
    }
  },

  /**
   * Queue consumer dispatch.
   *
   * - `o11yfleet-audit-logs`     → batch-insert to D1; failures retried by runtime
   * - `o11yfleet-audit-logs-dlq` → log to console.error so depth>0 is visible
   */
  async queue(batch: MessageBatch<AuditEvent>, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (batch.queue === "o11yfleet-audit-logs-dlq") {
      const { consumeAuditDlq } = await import("./audit/dlq-consumer.js");
      await consumeAuditDlq(batch, env);
      return;
    }
    if (batch.queue === "o11yfleet-audit-logs") {
      const { consumeAuditBatch } = await import("./audit/consumer.js");
      await consumeAuditBatch(batch, env);
      return;
    }
    console.error("[queue] unknown queue:", batch.queue);
  },

  /** Daily stale-agent audit. This is rare reconciliation for missed close/error events. */
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (controller.cron === PRODUCT_METRICS_CRON) {
      await emitProductMetrics(env);
      return;
    }
    if (controller.cron === MANIFEST_DRIFT_CHECK_CRON) {
      await runManifestDriftCheck(env);
      return;
    }
    if (controller.cron !== STALE_AGENT_SWEEP_CRON) {
      return;
    }

    const configs = await getDb(env.FP_DB)
      .selectFrom("configurations")
      .select(["id", "tenant_id"])
      .execute();

    if (configs.length === 0) {
      return;
    }

    const results = await mapWithConcurrency(configs, CRON_SWEEP_CONCURRENCY, async (config) => {
      const doName = `${config.tenant_id}:${config.id}`;
      const doId = env.CONFIG_DO.idFromName(doName);
      const stub = env.CONFIG_DO.get(doId);
      const resp = await withTimeout(
        (signal) => stub.fetch(new Request("http://do/command/sweep", { method: "POST", signal })),
        CRON_SWEEP_TIMEOUT_MS,
        `[cron] sweep timed out for ${doName}`,
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`[cron] sweep failed for ${doName}: HTTP ${resp.status} ${body}`);
      }
      return resp.json<{ swept: number }>();
    });

    const swept = results
      .filter((r): r is PromiseFulfilledResult<{ swept: number }> => r.status === "fulfilled")
      .reduce((sum, r) => sum + r.value.swept, 0);
    const failed = results.filter((r) => r.status === "rejected").length;

    if (swept > 0 || failed > 0) {
      console.warn(
        `[cron] sweep complete: ${swept} stale agents across ${configs.length} configs (${failed} failures)`,
      );
    }
  },
};

async function emitProductMetrics(env: Env): Promise<void> {
  if (!env.FP_ANALYTICS) return;

  const rows = await getDb(env.FP_DB)
    .selectFrom("tenants")
    .select(["plan", (eb) => eb.fn.countAll<number>().as("c")])
    .groupBy("plan")
    .execute();

  const totals = { total: 0, free: 0, paid: 0, enterprise: 0 };
  for (const row of rows) {
    const bucket = tenantPlanBucket(row.plan);
    totals[bucket] += row.c;
    totals.total += row.c;
  }

  try {
    env.FP_ANALYTICS.writeDataPoint({
      indexes: ["daily"],
      blobs: ["product", "tenants", "daily"],
      doubles: [totals.total, totals.free, totals.paid, totals.enterprise, Date.now() / 1000],
    });
  } catch {
    // Analytics Engine write failures should not fail the cron invocation.
  }
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
    const resp = await handleAuthRequest(request, env, url, ctx);
    return addSecurityHeaders(addCorsHeaders(resp, request, env));
  }

  // API routes — with auth + CORS
  if (url.pathname.startsWith("/api/")) {
    // Check Bearer token first (programmatic API access). O11YFLEET_API_BEARER_SECRET is intentionally
    // limited to bootstrap and tenant-scoped API paths, not the human admin plane.
    let hasApiSecretBearer = false;
    let oidcClaims: GitHubOIDCClaims | null = null;
    let apiKeyTenantId: string | null = null;
    let apiKeyJti: string | null = null;

    const auth = request.headers.get("Authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

    let oidcError: string | null = null;

    if (token) {
      if (isApiKey(token)) {
        // Tenant-scoped signed API key — tenant_id is embedded in the claim.
        // Verified via HMAC-SHA256, no D1 lookup needed.
        try {
          const claim = await verifyApiKey(token, env.O11YFLEET_CLAIM_HMAC_SECRET);
          apiKeyTenantId = claim.tenant_id;
          apiKeyJti = claim.jti;
        } catch (err) {
          return addSecurityHeaders(
            addCorsHeaders(
              Response.json(
                { error: err instanceof Error ? err.message : "Invalid API key" },
                { status: 401 },
              ),
              request,
              env,
            ),
          );
        }
      } else if (
        env.O11YFLEET_API_BEARER_SECRET &&
        timingSafeEqual(token, env.O11YFLEET_API_BEARER_SECRET)
      ) {
        hasApiSecretBearer = true;
      } else if (looksLikeJWT(token) && env.O11YFLEET_OIDC_ALLOWED_REPOS) {
        // Attempt GitHub Actions OIDC verification — scoped to "provision" operations only.
        const allowedRepos = env.O11YFLEET_OIDC_ALLOWED_REPOS.split(",").map((r) => r.trim());
        const audience = env.O11YFLEET_OIDC_AUDIENCE ?? "o11yfleet";
        const result = await verifyGitHubOIDC(token, { audience, allowedRepos });
        if (result.ok) {
          oidcClaims = result.claims;
        } else {
          oidcError = result.error;
          console.warn(`OIDC verification failed: ${result.error}`);
        }
      }
    }

    // Try session-based auth (cookie) — non-fatal if D1 is overloaded
    let sessionAuth: Awaited<ReturnType<typeof authenticate>> = null;
    try {
      sessionAuth = await authenticate(request, env);
    } catch {
      // D1 overloaded — session auth unavailable, fall through to
      // API key / Bearer / OIDC auth which don't need D1
    }

    let resp: Response;

    // Admin routes — /api/admin/*
    if (url.pathname.startsWith("/api/admin/")) {
      const { adminAuditContext, systemActor, userActor } = await import("./audit/recorder.js");
      const adminActor = sessionAuth
        ? userActor(request, { user_id: sessionAuth.userId, email: sessionAuth.email })
        : systemActor(request);
      const adminAudit = adminAuditContext({ ctx, env, request, actor: adminActor });
      // OIDC "provision" scope: only allows POST /api/admin/tenants (tenant creation).
      // This enables CI workflows to provision test infrastructure without full admin access.
      if (oidcClaims && request.method === "POST" && url.pathname === "/api/admin/tenants") {
        resp = await handleAdminRequest(request, env, url, adminAudit);
      } else if (sessionAuth?.role === "admin") {
        resp = await handleAdminRequest(request, env, url, adminAudit);
      } else {
        const body = hasApiSecretBearer
          ? { error: "Admin session required", code: "admin_session_required" }
          : oidcClaims
            ? { error: "OIDC scope insufficient", code: "oidc_scope_insufficient" }
            : { error: "Admin access required", oidc_error: oidcError };
        return addSecurityHeaders(
          addCorsHeaders(Response.json(body, { status: 403 }), request, env),
        );
      }
    }
    // Tenant-scoped routes — /api/v1/*
    else if (url.pathname.startsWith("/api/v1/")) {
      // Resolve tenant: API key claim > session cookie > X-Tenant-Id header (with Bearer auth only)
      let tenantId: string | null = null;
      if (apiKeyTenantId) {
        tenantId = apiKeyTenantId;
      } else if (sessionAuth?.tenantId) {
        tenantId = sessionAuth.tenantId;
      } else if (hasApiSecretBearer) {
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
      // Pick the actor kind based on which credential authenticated the
      // request. The discriminated union prevents mixing user + API-key
      // fields and maps cleanly to WorkOS's actor.type enum at the
      // consumer boundary.
      const { apiKeyActor, systemActor, tenantAuditContext, userActor } =
        await import("./audit/recorder.js");
      let v1Actor;
      if (sessionAuth) {
        v1Actor = userActor(request, {
          user_id: sessionAuth.userId,
          email: sessionAuth.email,
          // Impersonation sessions carry the real admin id alongside
          // the synthetic tenant user; record it so customer audit logs
          // can attribute the action to the actual support operator.
          impersonator_user_id: sessionAuth.isImpersonation
            ? (sessionAuth.impersonatorUserId ?? null)
            : null,
        });
      } else if (apiKeyJti) {
        v1Actor = apiKeyActor(request, { api_key_id: apiKeyJti });
      } else {
        // hasApiSecretBearer + X-Tenant-Id path. No identity beyond
        // "the bootstrap secret"; recorded as system.
        v1Actor = systemActor(request);
      }
      const v1Audit = tenantAuditContext({
        ctx,
        env,
        request,
        tenant_id: tenantId,
        actor: v1Actor,
      });
      resp = await handleV1Request(request, env, url, tenantId, v1Audit);
    }
    // Unknown API routes
    else {
      resp = Response.json({ error: "Not found" }, { status: 404 });
    }

    return addSecurityHeaders(addCorsHeaders(resp, request, env));
  }

  // OpAMP WebSocket endpoint
  if (url.pathname === "/v1/opamp") {
    if (!env.O11YFLEET_CLAIM_HMAC_SECRET) {
      return new Response("Server misconfigured: O11YFLEET_CLAIM_HMAC_SECRET not set", {
        status: 500,
      });
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
  if (!token.startsWith("fp_enroll_") && !token.startsWith("fp_pending_")) {
    try {
      const claim = await verifyClaim(token, env.O11YFLEET_CLAIM_HMAC_SECRET);
      // Route to DO based on claim — HMAC verification is the only auth
      // gate here. The DO enforces agent limits from its own SQLite policy
      // (seeded via /init or /sync-policy), so no D1 query is needed.
      const doName = `${claim.tenant_id}:${claim.config_id}`;
      const doId = env.CONFIG_DO.idFromName(doName);
      const stub = env.CONFIG_DO.get(doId);

      // The DO derives tenant/config identity from ctx.id.name — no
      // x-fp-tenant-id/x-fp-config-id headers needed. Agent limits are
      // enforced from the DO's own SQLite policy (seeded via /init or
      // /sync-policy), so no D1 query is needed here either.
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

  // Pending path: fp_pending_ token — route to tenant:__pending__ DO
  if (token.startsWith("fp_pending_")) {
    return handlePendingTokenRequest(request, env, token, cleanHeaders);
  }

  // Cold path: enrollment token — verify signature, then check the persisted
  // row for revoked_at. The signature alone is not enough: a token revoked
  // through DELETE /api/v1/configurations/:id/enrollment-tokens/:tokenId
  // would still pass signature verification until its expiry, so we have to
  // check the denylist before routing to the DO.

  // Step 1: Verify token signature — auth failure → 401
  let claim: Awaited<ReturnType<typeof verifyEnrollmentToken>>;
  try {
    claim = await verifyEnrollmentToken(token, env.O11YFLEET_CLAIM_HMAC_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid enrollment token";
    return Response.json({ error: msg }, { status: 401 });
  }

  // Step 2: Revocation check (OpAMP §6.1.1). Single PK lookup on
  // enrollment_tokens.id (the claim's jti). Enrollment is the cold path —
  // it runs at most once per agent, so the extra D1 round-trip is
  // acceptable. Heartbeats use signed assignment claims that bypass D1
  // entirely, so this stays out of the per-message critical path.
  //
  // A push-based denylist (admin-revoke fan-out → DO SQLite check) would
  // scale better under enrollment storms, but adds invalidation
  // complexity (which DOs to push to, ordering vs revoke completion,
  // crash recovery). Keeping this pull-based until enrollment QPS
  // actually requires the optimization.
  try {
    const row = await getDb(env.FP_DB)
      .selectFrom("enrollment_tokens")
      .select("revoked_at")
      .where("id", "=", claim.jti)
      .executeTakeFirst();
    if (!row) {
      return Response.json({ error: "Enrollment token not found" }, { status: 401 });
    }
    if (row.revoked_at) {
      return Response.json({ error: "Enrollment token revoked" }, { status: 401 });
    }
  } catch (err) {
    console.error("Enrollment revocation check failed:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  // Step 3: Route to DO. Agent limits are enforced by the DO from its own
  // SQLite policy (seeded via /init or /sync-policy from PR #426). Plan
  // enforcement (hobby/pro → must use pending flow) is handled at token
  // generation time: the admin API refuses to issue fp_enroll_ tokens for
  // plans that don't support direct enrollment.
  try {
    const doName = `${claim.tenant_id}:${claim.config_id}`;
    const doId = env.CONFIG_DO.idFromName(doName);
    const stub = env.CONFIG_DO.get(doId);

    const instanceUid = crypto.randomUUID().replace(/-/g, "");

    // Identity (tenant_id/config_id) flows via ctx.id.name on the DO;
    // only the per-agent uid + enrollment flag travel as headers.
    cleanHeaders.set("x-fp-instance-uid", instanceUid);
    cleanHeaders.set("x-fp-enrollment", "true");

    return stub.fetch(
      new Request(request.url, {
        method: request.method,
        headers: cleanHeaders,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("Enrollment cold path infrastructure error:", msg);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handlePendingTokenRequest(
  request: Request,
  env: Env,
  token: string,
  cleanHeaders: Headers,
): Promise<Response> {
  const PENDING_DO_CONFIG_ID = "__pending__";

  const body = token.slice("fp_pending_".length);
  const dotIdx = body.indexOf(".");
  if (dotIdx === -1) {
    return Response.json({ error: "Invalid pending token format" }, { status: 401 });
  }

  const payload = body.slice(0, dotIdx);
  const signature = body.slice(dotIdx + 1);

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.O11YFLEET_CLAIM_HMAC_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(payload),
    );
    if (!valid) {
      return Response.json({ error: "Invalid pending token signature" }, { status: 401 });
    }
  } catch {
    return Response.json({ error: "Invalid pending token" }, { status: 401 });
  }

  let claim: { tenant_id: string; jti: string; exp: number };
  try {
    claim = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      tenant_id: string;
      jti: string;
      exp: number;
    };
  } catch {
    return Response.json({ error: "Malformed pending token payload" }, { status: 401 });
  }

  if (claim.exp > 0 && claim.exp < Date.now() / 1000) {
    return Response.json({ error: "Pending token expired" }, { status: 401 });
  }

  // Token revocation and geo_enabled — zero D1 queries on the pending path.
  //
  // Revocation: same reasoning as enrollment — HMAC + exp claim is the
  // primary gate. Revocation-push-to-DO is a future concern (avoids
  // permanently growing revocation lists).
  //
  // Geo headers: always forwarded from Cloudflare's cf-* headers (free,
  // already on the request). The DO decides whether to store them based
  // on its own policy.

  try {
    const doName = `${claim.tenant_id}:${PENDING_DO_CONFIG_ID}`;
    const doId = env.CONFIG_DO.idFromName(doName);
    const stub = env.CONFIG_DO.get(doId);

    const instanceUid = crypto.randomUUID().replace(/-/g, "");

    // Identity (tenant + __pending__) flows via ctx.id.name on the DO.
    cleanHeaders.set("x-fp-instance-uid", instanceUid);
    cleanHeaders.set("x-fp-enrollment", "true");

    // Always pass geo headers — CF provides them for free on every request
    const cfCountry = request.headers.get("cf-ipcountry");
    const cfCity = request.headers.get("cf-ipcity");
    const cfLat = request.headers.get("cf-ip-latitude");
    const cfLon = request.headers.get("cf-ip-longitude");
    if (cfCountry) cleanHeaders.set("x-fp-geo-country", cfCountry);
    if (cfCity) cleanHeaders.set("x-fp-geo-city", cfCity);
    if (cfLat) cleanHeaders.set("x-fp-geo-lat", cfLat);
    if (cfLon) cleanHeaders.set("x-fp-geo-lon", cfLon);

    return stub.fetch(
      new Request(request.url, {
        method: request.method,
        headers: cleanHeaders,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("Pending token infrastructure error:", msg);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
