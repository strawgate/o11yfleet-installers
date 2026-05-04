// Admin API routes — full tenant management, system health, impersonation
//
// This file is the thin orchestration layer that mounts domain-specific
// sub-routers. The Hono migration in #724 consolidated the admin entrypoint
// into apps/worker/src/hono-admin-app.ts; the legacy `handleAdminRequest`
// shim was removed in the dead-code sweep.

import { Hono } from "hono";
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
