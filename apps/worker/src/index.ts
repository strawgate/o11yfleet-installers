// o11yfleet Worker — main entry point (thin routing skeleton).

export { ConfigDurableObject } from "./durable-objects/config-do.js";
export { ConfigValidationWorkflow } from "./workflows/config-validation.js";

import { adminApp } from "./hono-admin-app.js";
import { v1App } from "./hono-app.js";
import { handleAuthRequest } from "./routes/auth.js";
import { handleOpampRequest } from "./routes/opamp.js";
import { handleScheduled } from "./jobs/cron.js";
import {
  getCorsHeaders,
  addCorsHeaders,
  addSecurityHeaders,
  CSRF_SAFE_METHODS,
  isTrustedOrigin,
} from "./shared/http.js";
import type { AuditEvent } from "@o11yfleet/core/audit";
import type { ConfigDurableObject } from "./durable-objects/config-do.js";

export interface Env {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  CONFIG_DO: DurableObjectNamespace<ConfigDurableObject>;
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
  /** When `"1"`, `typedJsonResponse` runs the schema's `safeParse` against
   *  the outgoing payload and `console.warn`s mismatches. Off by default;
   *  also auto-on when `ENVIRONMENT === "dev"`. Set to `"1"` to surface
   *  contract drift in staging. */
  O11YFLEET_RUNTIME_VALIDATION?: string;
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

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleScheduled(controller, env, ctx);
  },
};

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

  // OTLP ingest — no session auth (uses per-collector JWT tokens instead)
  if (url.pathname.startsWith("/otlp/")) {
    if (url.pathname === "/otlp/v1/metrics") {
      const { handleOtlpMetricsDebug } = await import("./routes/otlp.js");
      return handleOtlpMetricsDebug(request, env);
    }
    return new Response("Not found", { status: 404 });
  }

  // Tenant-scoped V1 routes — handled entirely by Hono (auth, CORS, dispatch)
  if (url.pathname.startsWith("/api/v1/")) {
    return v1App.fetch(request, env, ctx);
  }

  // Admin routes — handled entirely by Hono (admin auth, CORS, dispatch)
  if (url.pathname.startsWith("/api/admin/")) {
    return adminApp.fetch(request, env, ctx);
  }

  // Unknown API routes (v1 and admin already short-circuited above)
  if (url.pathname.startsWith("/api/")) {
    return addSecurityHeaders(
      addCorsHeaders(Response.json({ error: "Not found" }, { status: 404 }), request, env),
    );
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
