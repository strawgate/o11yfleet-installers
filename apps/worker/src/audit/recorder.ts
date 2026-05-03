// Producer-side helpers for audit events.
//
// Handlers call `recordMutation(...)` (or `recordEvent(...)` for non-HTTP
// events like login). Both build an AuditEvent and enqueue it on
// `env.AUDIT_QUEUE`. Producer-side failures are extremely rare on
// Cloudflare Queues, but we never throw to the caller — audit must never
// break a user request. Consumer-side D1 errors are retried by the queue
// runtime and ultimately land in the DLQ if persistent.

import {
  classifyAuditStatus,
  type AuditAction,
  type AuditActor,
  type AuditEvent,
  type AuditResourceType,
  type AuditScope,
  type AuditStatus,
} from "@o11yfleet/core/audit";
import type { Env } from "../index.js";

export {
  classifyAuditStatus,
  type AuditAction,
  type AuditActor,
  type AuditEvent,
  type AuditResourceType,
  type AuditScope,
  type AuditStatus,
};

export interface AuditDescriptor {
  action: AuditAction;
  resource_type: AuditResourceType;
  resource_id: string | null;
  metadata?: Record<string, unknown>;
}

/** Descriptor for create routes. Identical fields to `AuditDescriptor`
 * minus `resource_id` — the *handler* supplies the id alongside its
 * response (see `withAuditCreate`), so the wrapper never has to guess
 * or peek into the response body. This makes "forgot to wire the
 * resource id" a compile-time error rather than a silent NULL row. */
export interface AuditCreateMeta {
  action: AuditAction;
  resource_type: AuditResourceType;
  metadata?: Record<string, unknown>;
}

/** What a create handler returns: the HTTP response that flows back to
 * the caller, plus the canonical id of whatever was created. `null` is
 * for the failure paths (e.g. validation 4xx where no row was written)
 * — the recorder still emits the failure event with resource_id NULL. */
export interface AuditCreateResult {
  response: Response;
  resource_id: string | null;
}

export interface AuditContext {
  ctx: ExecutionContext;
  env: Env;
  request: Request;
  scope: AuditScope;
  actor: AuditActor;
}

function networkAttrs(request: Request): { ip: string | null; user_agent: string | null } {
  return {
    ip: request.headers.get("CF-Connecting-IP") ?? null,
    user_agent: request.headers.get("User-Agent") ?? null,
  };
}

/** Build a `kind: "user"` actor from a session-authenticated request. */
export function userActor(
  request: Request,
  args: {
    user_id: string;
    email: string | null;
    /** Real admin id when this request is an impersonation session. */
    impersonator_user_id?: string | null;
  },
): AuditActor {
  return {
    kind: "user",
    user_id: args.user_id,
    email: args.email,
    impersonator_user_id: args.impersonator_user_id ?? null,
    ...networkAttrs(request),
  };
}

/** Build a `kind: "api_key"` actor from a verified API-key claim. */
export function apiKeyActor(request: Request, args: { api_key_id: string }): AuditActor {
  return {
    kind: "api_key",
    api_key_id: args.api_key_id,
    ...networkAttrs(request),
  };
}

/** Build a `kind: "system"` actor for bootstrap/automation paths
 * (O11YFLEET_API_BEARER_SECRET + X-Tenant-Id, etc.) that don't carry a
 * user or API-key identity. */
export function systemActor(request: Request): AuditActor {
  return {
    kind: "system",
    ...networkAttrs(request),
  };
}

/**
 * Record one audit event for an HTTP mutation. Status is classified from
 * the response: 2xx/3xx → success; 404/405 → skipped (not a real signal);
 * other 4xx and all 5xx → failure.
 *
 * The send is registered on `ctx.waitUntil` so the request completes
 * immediately; queue-send failures are logged but never thrown.
 */
export function recordMutation(
  audit: AuditContext,
  response: Response,
  desc: AuditDescriptor,
): void {
  const classification = classifyAuditStatus(response.status);
  if (classification === "skip") return;
  enqueue(audit, desc, classification, response.status);
}

/**
 * Record a non-HTTP audit event (e.g. login, logout). `status` and
 * `status_code` are caller-supplied because there's no Response to derive
 * them from.
 */
export function recordEvent(
  audit: AuditContext,
  desc: AuditDescriptor,
  status: AuditStatus,
  statusCode: number | null,
): void {
  enqueue(audit, desc, status, statusCode);
}

function enqueue(
  audit: AuditContext,
  desc: AuditDescriptor,
  status: AuditStatus,
  statusCode: number | null,
): void {
  const event: AuditEvent = {
    id: crypto.randomUUID(),
    scope: audit.scope,
    actor: audit.actor,
    action: desc.action,
    resource_type: desc.resource_type,
    resource_id: desc.resource_id,
    status,
    status_code: statusCode,
    metadata: desc.metadata ?? null,
    request_id: audit.request.headers.get("CF-Ray") ?? null,
    created_at: new Date().toISOString(),
  };
  audit.ctx.waitUntil(send(audit.env, event));
}

async function send(env: Env, event: AuditEvent): Promise<void> {
  if (!env.AUDIT_QUEUE) {
    // Local dev without the queue binding — log so the event is visible
    // in `wrangler dev` output. Producer-side log; not a substitute for
    // durable delivery.
    console.warn("[audit:no-queue]", event.action, event.resource_type, event.resource_id);
    recordProducerDrop(env, "no_queue", event.action);
    return;
  }
  try {
    await env.AUDIT_QUEUE.send(event);
  } catch (err) {
    // Queue producer failures are rare. We log and drop — nothing to
    // gain from throwing into the user request path. The Analytics
    // Engine counter lets ops alert on sustained loss without grepping
    // logs.
    console.error("[audit] queue send failed:", err, "event:", event.action);
    recordProducerDrop(env, "send_error", event.action);
  }
}

/** Increment the dropped-event counter so alerting can detect sustained
 * audit loss. AE is best-effort by design — we wrap in try/catch so a
 * counter failure can't itself become a way to lose the request. */
function recordProducerDrop(env: Env, reason: "no_queue" | "send_error", action: string): void {
  if (!env.FP_ANALYTICS) return;
  try {
    env.FP_ANALYTICS.writeDataPoint({
      indexes: ["audit"],
      blobs: ["audit", "producer", "drop", reason, action],
      doubles: [1],
    });
  } catch {
    /* best-effort */
  }
}

/** Build an AuditContext that targets the customer-tenant audit log. */
export function tenantAuditContext(args: {
  ctx: ExecutionContext;
  env: Env;
  request: Request;
  tenant_id: string;
  actor: AuditActor;
}): AuditContext {
  return {
    ctx: args.ctx,
    env: args.env,
    request: args.request,
    actor: args.actor,
    scope: { kind: "tenant", tenant_id: args.tenant_id },
  };
}

/** Build an AuditContext that targets the platform-scoped admin audit log. */
export function adminAuditContext(args: {
  ctx: ExecutionContext;
  env: Env;
  request: Request;
  actor: AuditActor;
}): AuditContext {
  return {
    ctx: args.ctx,
    env: args.env,
    request: args.request,
    actor: args.actor,
    scope: { kind: "admin" },
  };
}
