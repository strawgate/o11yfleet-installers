// Audit event types — shared between the worker (recording) and tests,
// with zero Cloudflare imports. Each handler declares its own audit
// descriptor at the call site (see apps/worker/src/audit/recorder.ts);
// the route table is not mirrored here.

export type AuditStatus = "success" | "failure";

/** Tenant-scoped vs admin (platform-scoped) audit events. The discriminated
 *  union prevents routing admin activity into a customer's audit stream
 *  (or vice versa). At the storage boundary, admin scope persists with
 *  `tenant_id IS NULL`. */
export type AuditScope = { kind: "tenant"; tenant_id: string } | { kind: "admin" };

/** Who performed the action. Discriminated union so invalid states
 *  (both user_id and api_key_id set, neither set) are unrepresentable. */
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

/** Every action emitted to the audit log. The literal-union `AuditAction`
 *  type is derived from this array — single source of truth. */
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

/** Resource types referenced in audit entries (single source of truth). */
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
   *  and as the D1 PRIMARY KEY. */
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

/** Classify an HTTP status as audit success / failure / skip.
 *  Skip covers 404/405 — typically client probing, not a security signal.
 *  Other 4xx (auth/auth-z/validation) and all 5xx are failures. */
export function classifyAuditStatus(statusCode: number): AuditStatus | "skip" {
  if (statusCode >= 200 && statusCode < 400) return "success";
  if (statusCode === 404 || statusCode === 405) return "skip";
  return "failure";
}
