// Tenant-scoped API routes — user portal operations
// All operations are scoped to a single tenant via authenticated session or API key
//
// This file is the thin orchestration layer that mounts domain-specific
// sub-routers and keeps the deprecated handleV1Request shim for runtime
// test compatibility.

import { Hono } from "hono";
import type { Env } from "../../index.js";
import type { AuditContext } from "../../audit/recorder.js";
import { AiApiError } from "../../ai/guidance.js";
import { jsonApiError, jsonError, ApiError } from "../../shared/errors.js";
import type { V1Env } from "./shared.js";

// Re-export shared helpers for backward compatibility
export { withAudit, withAuditCreate, getOwnedConfig, getDoName } from "./shared.js";
export type { V1Env } from "./shared.js";

// Domain sub-routers
import { tenantRoutes } from "./tenant.js";
import { configRoutes } from "./configurations.js";
import { enrollmentTokenRoutes } from "./enrollment-tokens.js";
import { agentRoutes } from "./agents.js";
import { pendingRoutes } from "./pending.js";

// ─── Hono Router ────────────────────────────────────────────────────
// Composed from domain sub-routers. Each sub-router owns its route
// definitions and audit wiring; this file only mounts them.

export const v1Router = new Hono<V1Env>();

v1Router.route("/", tenantRoutes);
v1Router.route("/", configRoutes);
v1Router.route("/", enrollmentTokenRoutes);
v1Router.route("/", agentRoutes);
v1Router.route("/", pendingRoutes);

// ─── Legacy compat shim ────────────────────────────────────────────
// Some runtime tests still call handleV1Request directly.
// This shim builds a one-shot Hono app that delegates to v1Router.
// @deprecated — prefer v1App (hono-app.ts) for new code.

export async function handleV1Request(
  request: Request,
  env: Env,
  url: URL,
  tenantId: string,
  audit?: AuditContext,
): Promise<Response> {
  try {
    return await routeV1Request(request, env, url, tenantId, audit);
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonApiError(err);
    }
    if (err instanceof AiApiError) {
      return jsonError(err.message, err.status);
    }
    console.error("V1 API error:", url.pathname, err);
    return jsonError("Internal server error", 500);
  }
}

async function routeV1Request(
  request: Request,
  env: Env,
  _url: URL,
  tenantId: string,
  audit?: AuditContext,
): Promise<Response> {
  // Build a one-shot Hono app that injects tenantId/audit into context
  // then delegates to the composed v1Router.
  const app = new Hono<V1Env>();
  app.use("*", async (c, next) => {
    c.set("tenantId", tenantId);
    c.set("audit", audit as AuditContext);
    await next();
  });
  app.route("/api/v1", v1Router);

  return app.fetch(request, env);
}
