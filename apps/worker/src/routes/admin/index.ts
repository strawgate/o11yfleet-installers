// Admin API routes — full tenant management, system health, impersonation
//
// This file is the thin orchestration layer that mounts domain-specific
// sub-routers and keeps the deprecated handleAdminRequest shim for runtime
// test compatibility.

import { Hono } from "hono";
import type { Env } from "../../index.js";
import type { AuditContext } from "../../audit/recorder.js";
import { AiApiError } from "../../ai/guidance.js";
import { jsonApiError, jsonError, ApiError } from "../../shared/errors.js";
import type { AdminEnv } from "./shared.js";

// Re-export shared helpers for backward compatibility
export { withAdminAudit, withAdminAuditCreate, recordOnAdminAndCustomer } from "./shared.js";
export type { AdminEnv } from "./shared.js";

// Domain sub-routers
import { tenantRoutes } from "./tenants.js";
import { healthRoutes } from "./health.js";
import { doDebugRoutes } from "./do-debug.js";
import { plansRoutes } from "./plans.js";
import { aiRoutes } from "./ai.js";

// ─── Hono Router ────────────────────────────────────────────────────
// Composed from domain sub-routers. Each sub-router owns its route
// definitions and audit wiring; this file only mounts them.

export const adminRouter = new Hono<AdminEnv>();

adminRouter.route("/", tenantRoutes);
adminRouter.route("/", healthRoutes);
adminRouter.route("/", doDebugRoutes);
adminRouter.route("/", plansRoutes);
adminRouter.route("/", aiRoutes);

// ─── Legacy compat shim ────────────────────────────────────────────
// Some runtime tests still call handleAdminRequest directly.
// This shim builds a one-shot Hono app that delegates to adminRouter.
// @deprecated — prefer adminApp (hono-admin-app.ts) for new code.

export async function handleAdminRequest(
  request: Request,
  env: Env,
  url: URL,
  audit?: AuditContext,
): Promise<Response> {
  try {
    return await routeAdminRequest(request, env, url, audit);
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonApiError(err);
    }
    if (err instanceof AiApiError) {
      return jsonError(err.message, err.status);
    }
    console.error("Admin API error:", url.pathname, err);
    return jsonError("Internal server error", 500);
  }
}

async function routeAdminRequest(
  request: Request,
  env: Env,
  _url: URL,
  audit?: AuditContext,
): Promise<Response> {
  // Build a one-shot Hono app that injects audit into context
  // then delegates to the composed adminRouter.
  const app = new Hono<AdminEnv>();
  app.use("*", async (c, next) => {
    c.set("audit", audit as AuditContext);
    await next();
  });
  app.route("/api/admin", adminRouter);

  return app.fetch(request, env);
}
