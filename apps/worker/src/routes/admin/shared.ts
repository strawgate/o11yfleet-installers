// Shared types and helpers for admin route modules

import type { Env } from "../../index.js";
import type { AdminAppVariables } from "../../hono-admin-app.js";
import {
  recordMutation,
  type AuditContext,
  type AuditCreateMeta,
  type AuditCreateResult,
  type AuditDescriptor,
} from "../../audit/recorder.js";
import { ApiError } from "../../shared/errors.js";
import { AiApiError } from "../../ai/guidance.js";

export type AdminEnv = { Bindings: Env; Variables: AdminAppVariables };

/**
 * Wrap a mutating admin handler so the response is also written to the
 * audit log. The admin event is always recorded against the platform
 * (admin) audit scope. For actions targeting a specific customer tenant,
 * pass `customerTenantId` to also mirror an entry into that tenant's
 * stream so customers can see when support touched their tenant.
 */
export async function withAdminAudit(
  audit: AuditContext | undefined,
  desc: AuditDescriptor,
  fn: () => Promise<Response>,
  customerTenantId?: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fn();
  } catch (err) {
    if (audit) {
      const status =
        err instanceof ApiError ? err.status : err instanceof AiApiError ? err.status : 500;
      const errResp = new Response(null, { status });
      recordOnAdminAndCustomer(audit, desc, errResp, customerTenantId);
    }
    throw err;
  }
  if (audit) recordOnAdminAndCustomer(audit, desc, response, customerTenantId);
  return response;
}

/** Admin counterpart of `withAuditCreate`. Same compile-time guarantee:
 * the create handler must surface `resource_id` alongside its response.
 * Customer-mirror behavior is preserved when `customerTenantId` is set. */
export async function withAdminAuditCreate(
  audit: AuditContext | undefined,
  meta: AuditCreateMeta,
  fn: () => Promise<AuditCreateResult>,
  customerTenantId?: string,
): Promise<Response> {
  let result: AuditCreateResult;
  try {
    result = await fn();
  } catch (err) {
    if (audit) {
      const status =
        err instanceof ApiError ? err.status : err instanceof AiApiError ? err.status : 500;
      const errResp = new Response(null, { status });
      recordOnAdminAndCustomer(audit, { ...meta, resource_id: null }, errResp, customerTenantId);
    }
    throw err;
  }
  if (audit) {
    const desc: AuditDescriptor = { ...meta, resource_id: result.resource_id };
    recordOnAdminAndCustomer(audit, desc, result.response, customerTenantId);
  }
  return result.response;
}

export function recordOnAdminAndCustomer(
  audit: AuditContext,
  desc: AuditDescriptor,
  response: Response,
  customerTenantId: string | undefined,
): void {
  recordMutation(audit, response, desc);
  if (!customerTenantId) return;
  // Mirror to the customer's audit log so they can see admin activity
  // on their tenant. For user actors we set impersonator_user_id to
  // the admin's id so customers can distinguish "support touched my
  // tenant" from ordinary tenant-actor entries. System actors (e.g. an
  // OIDC-authenticated CI workflow) carry forward unchanged — there's
  // no "support operator" to credit.
  const customerAudit: AuditContext = {
    ...audit,
    scope: { kind: "tenant", tenant_id: customerTenantId },
    actor:
      audit.actor.kind === "user"
        ? { ...audit.actor, impersonator_user_id: audit.actor.user_id }
        : audit.actor,
  };
  recordMutation(customerAudit, response, desc);
}
