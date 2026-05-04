// Shared types and helpers for v1 route modules

import type { Env } from "../../index.js";
import type { AppVariables } from "../../hono-app.js";
import {
  recordMutation,
  type AuditContext,
  type AuditCreateMeta,
  type AuditCreateResult,
  type AuditDescriptor,
} from "../../audit/recorder.js";
import { ApiError } from "../../shared/errors.js";
import { AiApiError } from "../../ai/guidance.js";
import { findOwnedConfig, type ConfigurationRow } from "../../shared/db-helpers.js";

export type V1Env = { Bindings: Env; Variables: AppVariables };

/**
 * Wrap a mutating handler so the response is also written to the audit
 * log. Read-only routes don't need this. The wrapper is intentionally
 * thin so coverage is grep-able: each mutating route has exactly one
 * `withAudit(...)` (or `withAuditCreate(...)`) call adjacent to the
 * handler.
 */
export async function withAudit(
  audit: AuditContext | undefined,
  desc: AuditDescriptor,
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    const response = await fn();
    if (audit) recordMutation(audit, response, desc);
    return response;
  } catch (err) {
    if (audit) {
      const status =
        err instanceof ApiError ? err.status : err instanceof AiApiError ? err.status : 500;
      recordMutation(audit, new Response(null, { status }), desc);
    }
    throw err;
  }
}

/**
 * Variant of `withAudit` for create routes. The handler signature
 * forces it to surface the canonical id of the new resource alongside
 * the response, which becomes the audit `resource_id`. This makes
 * "forgot to wire the new id into audit" a compile-time error — the
 * old `resource_id_from_response: "id"` indirection was easy to miss
 * or get wrong (e.g. config_version.publish silently recorded the
 * configuration id instead of the version id).
 */
export async function withAuditCreate(
  audit: AuditContext | undefined,
  meta: AuditCreateMeta,
  fn: () => Promise<AuditCreateResult>,
): Promise<Response> {
  try {
    const { response, resource_id } = await fn();
    if (audit) recordMutation(audit, response, { ...meta, resource_id });
    return response;
  } catch (err) {
    if (audit) {
      const status =
        err instanceof ApiError ? err.status : err instanceof AiApiError ? err.status : 500;
      recordMutation(audit, new Response(null, { status }), { ...meta, resource_id: null });
    }
    throw err;
  }
}

/** Require admin role for destructive operations. Returns a 403 Response
 *  if the actor is a user without admin role. API-key and system actors
 *  bypass — they're already gated by tenant scope and secret auth. */
export function requireAdminRole(audit: AuditContext | undefined): Response | null {
  if (!audit || audit.actor.kind !== "user" || audit.actor.role !== "admin") {
    return new Response(JSON.stringify({ error: "Tenant admin role required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

/** Verify config belongs to tenant and return it */
/**
 * Look up a configuration row scoped to a tenant, returning `null` if
 * the config doesn't exist or belongs to another tenant. Wraps the
 * shared `findOwnedConfig` helper so existing handler code continues
 * to read naturally; new code should call the helper directly.
 */
export async function getOwnedConfig(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<ConfigurationRow | null> {
  return findOwnedConfig(env, tenantId, configId);
}

export function getDoName(tenantId: string, configId: string): string {
  return `${tenantId}:${configId}`;
}
