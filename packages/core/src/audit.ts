// Audit event types — pure TypeScript so they can be shared between the
// worker (recording) and tests, with zero Cloudflare imports.
//
// Routing → action mapping is intentionally NOT done here. Each handler
// declares its own audit descriptor at the call site (see
// apps/worker/src/audit/recorder.ts). That keeps coverage explicit and
// grep-able instead of mirroring the route table in two places.
//
// Vendor-portability note: this file is the canonical event shape.
// Producers build `AuditEvent`s; the consumer translates them to the
// storage backend. Today that's D1; the swap to WorkOS Audit Logs only
// changes the consumer body (see apps/worker/src/audit/consumer.ts).

export type AuditStatus = "success" | "failure";

/**
 * Customer (tenant-scoped) vs admin (platform-scoped) audit events.
 *
 * Modeled as a discriminated union so it's impossible to "accidentally"
 * route admin activity into a customer's audit stream or vice versa.
 * At the storage boundary, admin scope maps to `tenant_id IS NULL` in
 * the audit_logs table; tenant scope maps to the customer's tenant id.
 *
 * WorkOS migration: admin scope has no WorkOS organization, so the
 * consumer keeps admin-scope events in D1 and only forwards tenant-scope
 * events to WorkOS Audit Logs.
 */
export type AuditScope = { kind: "tenant"; tenant_id: string } | { kind: "admin" };

/**
 * Audit actor — who performed the action.
 *
 * Discriminated union so invalid states (e.g., both user_id and
 * api_key_id set, or both null) are unrepresentable. Maps directly to
 * WorkOS's `actor.type` enum ("user" | "api" | "system") at the
 * consumer boundary.
 */
export type AuditActor =
  | {
      kind: "user";
      user_id: string;
      email: string | null;
      ip: string | null;
      user_agent: string | null;
      /** Set when an admin is impersonating; the customer audit log surfaces
       * "support touched my tenant" entries by reading this field. */
      impersonator_user_id: string | null;
    }
  | {
      kind: "api_key";
      /** jti from the verified API-key claim. Identifies which key drove the action. */
      api_key_id: string;
      ip: string | null;
      user_agent: string | null;
    }
  | {
      /** Bootstrap / automation paths that don't carry a user or API-key identity
       * (e.g., O11YFLEET_API_BEARER_SECRET + X-Tenant-Id). */
      kind: "system";
      ip: string | null;
      user_agent: string | null;
    };

/** Every action emitted to the audit log. Adding a new value requires
 * extending this array, which forces every call site, the UI filter, and
 * (after the WorkOS migration) the schema-registration helper to update
 * together. The literal-union `AuditAction` type is derived from this
 * array — single source of truth, no risk of array vs. type drift. */
export const AUDIT_ACTIONS = [
  // Auth
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  // Tenant (customer self-service)
  "tenant.update",
  "tenant.delete",
  // Configurations
  "configuration.create",
  "configuration.update",
  "configuration.delete",
  "config_version.publish",
  // Tokens
  "enrollment_token.create",
  "enrollment_token.revoke",
  "pending_token.create",
  "pending_token.revoke",
  // Devices
  "pending_device.assign",
  // Rollout / agents
  "rollout.start",
  "agents.disconnect",
  "agents.restart",
  "agent.disconnect",
  "agent.restart",
  // API keys
  "api_key.create",
  // Admin
  "admin.tenant.create",
  "admin.tenant.update",
  "admin.tenant.delete",
  "admin.tenant.approve",
  "admin.tenant.bulk_approve",
  "admin.tenant.impersonate_start",
  "admin.settings.update",
  "admin.do.query",
] as const satisfies readonly string[];

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Resource types referenced in audit entries; same single-source-of-truth
 * pattern as AuditAction. */
export const AUDIT_RESOURCE_TYPES = [
  "tenant",
  "configuration",
  "config_version",
  "enrollment_token",
  "pending_token",
  "pending_device",
  "rollout",
  "agent",
  "api_key",
  "session",
  "settings",
] as const satisfies readonly string[];

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export interface AuditEvent {
  /** Stable producer-generated UUID. Used as the queue idempotency key
   * and as the D1 PRIMARY KEY (and, after WorkOS migration, as the
   * `idempotencyKey` argument to `workos.auditLogs.createEvent`). */
  id: string;
  scope: AuditScope;
  actor: AuditActor;
  action: AuditAction;
  resource_type: AuditResourceType;
  resource_id: string | null;
  status: AuditStatus;
  status_code: number | null;
  metadata: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
}

/**
 * Classify an HTTP status as audit success / failure / skip.
 *
 * Skip is for noisy "expected" outcomes that aren't a real audit signal —
 * 404 (resource doesn't exist) and 405 (method not allowed) most often
 * come from clients probing, not from a security-relevant failure. Other
 * 4xx (auth/auth-z/validation) and all 5xx are recorded as failures.
 */
export function classifyAuditStatus(statusCode: number): AuditStatus | "skip" {
  if (statusCode >= 200 && statusCode < 400) return "success";
  if (statusCode === 404 || statusCode === 405) return "skip";
  return "failure";
}
