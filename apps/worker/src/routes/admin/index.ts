// Admin API routes — full tenant management, system health, impersonation
// These endpoints require admin auth before reaching this router.

import type { Env } from "../../index.js";
import {
  adminCreateTenantRequestSchema,
  adminDoQueryRequestSchema,
  adminUpdateTenantRequestSchema,
  adminApproveTenantRequestSchema,
  adminBulkApproveRequestSchema,
} from "@o11yfleet/core/api";
import {
  AiApiError,
  handleAdminChatRequest,
  handleAdminGuidanceRequest,
} from "../../ai/guidance.js";
import { isAnalyticsSqlConfigured, runAnalyticsSql } from "../../analytics-sql.js";
import { buildCloudflareUsage, cloudflareUsageRequiredEnv } from "../../cloudflare-usage.js";
import {
  DEFAULT_PLAN,
  PLAN_DEFINITIONS,
  PLAN_LIMITS,
  VALID_PLANS,
  normalizePlan,
} from "../../shared/plans.js";
import { jsonApiError, jsonError, ApiError } from "../../shared/errors.js";
import { sessionCookie } from "../../shared/cookies.js";
import { validateJsonBody } from "../../shared/validation.js";
import { deleteTenantById, findTenantById, tenantExists } from "../../shared/db-helpers.js";
import { currentFleetSummary, currentFleetSummaryByTenant } from "@o11yfleet/core/metrics";
import { sendTenantApprovalEmail, isAutoApproveEnabled } from "../../shared/email.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Router ─────────────────────────────────────────────────────────

export async function handleAdminRequest(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    return await routeAdminRequest(request, env, url);
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonApiError(err);
    }
    if (err instanceof AiApiError) {
      return jsonError(err.message, err.status);
    }
    console.error("Admin API error:", err);
    return jsonError("Internal server error", 500);
  }
}

async function routeAdminRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // ─── Overview ────────────────────────────────────────────────

  if (path === "/api/admin/overview" && method === "GET") {
    return handleAdminOverview(env);
  }

  // ─── AI Guidance ───────────────────────────────────────────

  if (path === "/api/admin/ai/guidance" && method === "POST") {
    return handleAdminGuidanceRequest(request, env);
  }
  if (path === "/api/admin/ai/chat" && method === "POST") {
    return handleAdminChatRequest(request, env);
  }

  // ─── Tenants ────────────────────────────────────────────────

  if (path === "/api/admin/tenants" && method === "POST") {
    return handleCreateTenant(request, env);
  }
  if (path === "/api/admin/tenants" && method === "GET") {
    return handleListTenants(env, url);
  }

  const tenantIdMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)$/);
  if (tenantIdMatch) {
    if (method === "GET") return handleGetTenant(env, tenantIdMatch[1]!);
    if (method === "PUT") return handleUpdateTenant(request, env, tenantIdMatch[1]!);
    if (method === "DELETE") return handleDeleteTenant(env, tenantIdMatch[1]!);
  }

  // GET /api/admin/tenants/:id/configurations — admin view of all configs
  const tenantConfigsMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)\/configurations$/);
  if (tenantConfigsMatch && method === "GET") {
    return handleListConfigurations(env, tenantConfigsMatch[1]!);
  }

  // GET /api/admin/tenants/:id/users — admin view of tenant users
  const tenantUsersMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)\/users$/);
  if (tenantUsersMatch && method === "GET") {
    return handleListTenantUsers(env, tenantUsersMatch[1]!);
  }

  const tenantImpersonateMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)\/impersonate$/);
  if (tenantImpersonateMatch && method === "POST") {
    return handleImpersonateTenant(request, env, tenantImpersonateMatch[1]!);
  }

  // POST /api/admin/tenants/:id/approve — approve or reject a tenant
  const tenantApproveMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)\/approve$/);
  if (tenantApproveMatch && method === "POST") {
    return handleApproveTenant(request, env, tenantApproveMatch[1]!);
  }

  // POST /api/admin/bulk-approve — bulk approve pending tenants
  if (path === "/api/admin/bulk-approve" && method === "POST") {
    return handleBulkApproveTenants(request, env);
  }

  // GET /api/admin/settings — get admin settings
  if (path === "/api/admin/settings" && method === "GET") {
    return handleGetSettings(env);
  }

  // PUT /api/admin/settings — update admin settings (e.g., auto-approve)
  if (path === "/api/admin/settings" && method === "PUT") {
    return handleUpdateSettings(request, env);
  }

  const configDOTablesMatch = path.match(/^\/api\/admin\/configurations\/([^/]+)\/do\/tables$/);
  if (configDOTablesMatch && method === "GET") {
    return handleDoTables(env, configDOTablesMatch[1]!);
  }

  const configDOQueryMatch = path.match(/^\/api\/admin\/configurations\/([^/]+)\/do\/query$/);
  if (configDOQueryMatch && method === "POST") {
    return handleDoQuery(request, env, configDOQueryMatch[1]!);
  }

  // ─── Health ─────────────────────────────────────────────────

  if (path === "/api/admin/health" && method === "GET") {
    return handleHealthCheck(env);
  }
  if (path === "/api/admin/usage" && method === "GET") {
    return Response.json(await buildCloudflareUsage(env));
  }

  // ─── Plans ──────────────────────────────────────────────────

  if (path === "/api/admin/plans" && method === "GET") {
    return handleListPlans(env);
  }

  return jsonError("Not found", 404);
}

// ─── Tenant Handlers ────────────────────────────────────────────────

async function handleCreateTenant(request: Request, env: Env): Promise<Response> {
  const body = await validateJsonBody(request, adminCreateTenantRequestSchema);

  const plan = normalizePlan(body.plan ?? DEFAULT_PLAN);
  if (!plan) {
    return jsonError(`Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}`, 400);
  }

  const limits = PLAN_LIMITS[plan];

  const id = crypto.randomUUID();
  await env.FP_DB.prepare(
    `INSERT INTO tenants (id, name, plan, max_configs, max_agents_per_config) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, body.name, plan, limits.max_configs, limits.max_agents_per_config)
    .run();

  return Response.json({ id, name: body.name, plan }, { status: 201 });
}

function boundedPositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

const TENANT_SORTS = {
  newest: "t.created_at DESC, t.id DESC",
  oldest: "t.created_at ASC, t.id ASC",
  name_asc: "t.name COLLATE NOCASE ASC, t.id ASC",
  name_desc: "t.name COLLATE NOCASE DESC, t.id DESC",
} as const;

type TenantSort = keyof typeof TENANT_SORTS;

function normalizeTenantSort(value: string | null): TenantSort {
  if (!value) return "newest";
  if (Object.prototype.hasOwnProperty.call(TENANT_SORTS, value)) return value as TenantSort;
  return "newest";
}

async function handleListTenants(env: Env, url: URL): Promise<Response> {
  const qRaw = url.searchParams.get("q")?.trim() ?? "";
  const q = qRaw.slice(0, 200);
  const requestedPlan = url.searchParams.get("plan");
  const plan = requestedPlan ? (normalizePlan(requestedPlan) ?? "all") : "all";
  const requestedStatus = url.searchParams.get("status");
  const status = ["pending", "active", "suspended"].includes(requestedStatus ?? "")
    ? requestedStatus
    : null;
  const sort = normalizeTenantSort(url.searchParams.get("sort"));
  const limit = boundedPositiveInt(url.searchParams.get("limit"), 100, 500);
  const page = boundedPositiveInt(url.searchParams.get("page"), 1, 10_000);
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const whereParams: unknown[] = [];
  if (q.length > 0) {
    // SQLite's LIKE is case-insensitive by default for ASCII when both
    // sides have the same case folding behavior; `COLLATE NOCASE`
    // lets the planner use indexes on `t.name`/`t.id` instead of
    // recomputing `LOWER(...)` for every row. The previous shape
    // (`LOWER(t.name) LIKE LOWER(?)`) forced a full table scan.
    whereClauses.push(
      "(t.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR t.id LIKE ? ESCAPE '\\' COLLATE NOCASE)",
    );
    const escaped = q.replace(/[\\%_]/g, "\\$&");
    const qLike = `%${escaped}%`;
    whereParams.push(qLike, qLike);
  }
  if (plan !== "all") {
    whereClauses.push("t.plan = ?");
    whereParams.push(plan);
  }
  if (status) {
    whereClauses.push("t.status = ?");
    whereParams.push(status);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const totalRow = await env.FP_DB.prepare(`SELECT COUNT(*) as count FROM tenants t ${whereSql}`)
    .bind(...whereParams)
    .first<{ count: number }>();
  const result = await env.FP_DB.prepare(
    `SELECT
      t.*,
      (SELECT COUNT(*) FROM configurations WHERE tenant_id = t.id) as config_count
     FROM tenants t
     ${whereSql}
     ORDER BY ${TENANT_SORTS[sort]}
     LIMIT ? OFFSET ?`,
  )
    .bind(...whereParams, limit, offset)
    .all();
  const tenantMetrics = await readTenantFleetSummaries(env);
  const tenants = result.results.map((tenant) => {
    const tenantId = String(tenant["id"] ?? "");
    const metrics = tenantMetrics.byTenant.get(tenantId);
    return {
      ...tenant,
      agent_count: numberMetric(metrics?.agent_count),
      connected_agents: numberMetric(metrics?.connected_agents),
      healthy_agents: numberMetric(metrics?.healthy_agents),
      metrics_source: tenantMetrics.available ? "analytics_engine" : "unavailable",
    };
  });
  const total = totalRow?.count ?? 0;

  // Get counts by status for filter badges
  const statusCounts = await env.FP_DB.prepare(
    "SELECT status, COUNT(*) as count FROM tenants GROUP BY status",
  ).all<{ status: string; count: number }>();

  const statusCountsMap: Record<string, number> = {};
  for (const row of statusCounts.results) {
    statusCountsMap[row.status] = row.count;
  }

  return Response.json({
    tenants,
    pagination: { page, limit, total, has_more: offset + result.results.length < total },
    filters: { q, plan, status, sort },
    status_counts: statusCountsMap,
    metrics_source: tenantMetrics.available ? "analytics_engine" : "unavailable",
    metrics_error: tenantMetrics.error,
  });
}

async function handleGetTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return jsonError("Tenant not found", 404);
  return Response.json(tenant);
}

async function handleUpdateTenant(request: Request, env: Env, tenantId: string): Promise<Response> {
  // Validate the body BEFORE the existence check so a 400 doesn't cost
  // an unnecessary D1 read.
  const body = await validateJsonBody(request, adminUpdateTenantRequestSchema);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name) {
    updates.push("name = ?");
    values.push(body.name);
  }
  if (body.plan) {
    const plan = normalizePlan(body.plan);
    if (!plan) {
      return jsonError(`Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}`, 400);
    }
    updates.push("plan = ?");
    values.push(plan);
    const limits = PLAN_LIMITS[plan];
    updates.push("max_configs = ?");
    values.push(limits.max_configs);
    updates.push("max_agents_per_config = ?");
    values.push(limits.max_agents_per_config);
  }
  if (body.geo_enabled !== undefined) {
    updates.push("geo_enabled = ?");
    values.push(body.geo_enabled ? 1 : 0);
  }
  if (body.status) {
    if (!["pending", "active", "suspended"].includes(body.status)) {
      return jsonError("Invalid status. Must be one of: pending, active, suspended", 400);
    }
    updates.push("status = ?");
    values.push(body.status);
    // If approving (setting to active), set approved_at
    if (body.status === "active") {
      updates.push("approved_at = datetime('now')");
      const adminId = request.headers.get("X-Admin-Id") ?? "system";
      updates.push("approved_by = ?");
      values.push(adminId);
    }
  }

  if (updates.length === 0) {
    return jsonError("No fields to update", 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(tenantId);

  // One round-trip: D1 supports `UPDATE ... RETURNING *`, so we can
  // collapse the previous existence-check SELECT, the UPDATE, and the
  // post-update SELECT into a single statement. A missing tenant
  // returns zero rows and we surface 404 from that.
  const updated = await env.FP_DB.prepare(
    `UPDATE tenants SET ${updates.join(", ")} WHERE id = ? RETURNING *`,
  )
    .bind(...values)
    .first();
  if (!updated) return jsonError("Tenant not found", 404);
  return Response.json(updated);
}

async function handleDeleteTenant(env: Env, tenantId: string): Promise<Response> {
  // Cheap existence check — we don't need any tenant columns post-check.
  if (!(await tenantExists(env, tenantId))) {
    return jsonError("Tenant not found", 404);
  }

  const configs = await env.FP_DB.prepare(
    `SELECT COUNT(*) as count FROM configurations WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{ count: number }>();
  if (configs && configs.count > 0) {
    return jsonError(
      `Cannot delete tenant with ${configs.count} configuration(s). Delete configurations first.`,
      409,
    );
  }

  await deleteTenantById(env, tenantId);
  return new Response(null, { status: 204 });
}

async function handleListConfigurations(env: Env, tenantId: string): Promise<Response> {
  const result = await env.FP_DB.prepare(
    `SELECT * FROM configurations WHERE tenant_id = ? ORDER BY created_at DESC`,
  )
    .bind(tenantId)
    .all();
  return Response.json({ configurations: result.results });
}

// ─── Tenant Users ───────────────────────────────────────────────────

async function handleListTenantUsers(env: Env, tenantId: string): Promise<Response> {
  if (!(await tenantExists(env, tenantId))) {
    return jsonError("Tenant not found", 404);
  }

  const result = await env.FP_DB.prepare(
    `SELECT id, email, display_name, role, created_at FROM users WHERE tenant_id = ? ORDER BY created_at DESC`,
  )
    .bind(tenantId)
    .all();
  return Response.json({ users: result.results });
}

async function getConfigDoStub(env: Env, configId: string): Promise<DurableObjectStub> {
  const config = await env.FP_DB.prepare("SELECT id, tenant_id FROM configurations WHERE id = ?")
    .bind(configId)
    .first<{ id: string; tenant_id: string }>();
  if (!config) throw new ApiError("Configuration not found", 404);

  return env.CONFIG_DO.get(env.CONFIG_DO.idFromName(`${config.tenant_id}:${config.id}`));
}

async function handleDoTables(env: Env, configId: string): Promise<Response> {
  const stub = await getConfigDoStub(env, configId);
  return stub.fetch(
    new Request("http://internal/debug/tables", {
      method: "GET",
      headers: { "x-fp-admin-debug": "true" },
    }),
  );
}

async function handleDoQuery(request: Request, env: Env, configId: string): Promise<Response> {
  const body = await validateJsonBody(request, adminDoQueryRequestSchema);
  const stub = await getConfigDoStub(env, configId);
  return stub.fetch(
    new Request("http://internal/debug/query", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fp-admin-debug": "true",
      },
      body: JSON.stringify(body),
    }),
  );
}

// ─── Health Check ───────────────────────────────────────────────────

interface HealthCheck {
  status: string;
  latency_ms?: number;
  error?: string;
  detail?: string;
}

interface HealthMetrics {
  total_tenants: number;
  total_configurations: number;
  tenants_without_configurations: number;
  configurations_without_agents: number;
  total_users: number;
  active_sessions: number;
  impersonation_sessions: number;
  active_tokens: number;
  total_agents: number;
  connected_agents: number;
  disconnected_agents: number;
  unknown_agents: number;
  healthy_agents: number;
  unhealthy_agents: number;
  stale_agents: number;
  last_agent_seen_at: string | null;
  latest_fleet_snapshot_at: string | null;
  latest_configuration_updated_at: string | null;
  plan_counts: Record<string, number>;
}

interface HealthDataSource {
  status: string;
  detail: string;
}

interface FleetMetricsSummary {
  available: boolean;
  error: string | null;
  total_agents: number;
  connected_agents: number;
  disconnected_agents: number;
  unknown_agents: number;
  healthy_agents: number;
  unhealthy_agents: number;
  stale_agents: number;
  configurations_with_agents: number;
  latest_snapshot_at: string | null;
}

interface FleetSummaryRow {
  total_agents: number | null;
  connected_agents: number | null;
  disconnected_agents: number | null;
  healthy_agents: number | null;
  unhealthy_agents: number | null;
  stale_agents: number | null;
  configurations_with_agents: number | null;
  latest_snapshot_at: string | number | null;
  [column: string]: string | number | null;
}

interface TenantFleetSummaryRow {
  tenant_id: string | null;
  agent_count: number | null;
  connected_agents: number | null;
  healthy_agents: number | null;
  configurations_with_agents: number | null;
  latest_snapshot_at: string | number | null;
  [column: string]: string | number | null;
}

const EMPTY_HEALTH_METRICS: HealthMetrics = {
  total_tenants: 0,
  total_configurations: 0,
  tenants_without_configurations: 0,
  configurations_without_agents: 0,
  total_users: 0,
  active_sessions: 0,
  impersonation_sessions: 0,
  active_tokens: 0,
  total_agents: 0,
  connected_agents: 0,
  disconnected_agents: 0,
  unknown_agents: 0,
  healthy_agents: 0,
  unhealthy_agents: 0,
  stale_agents: 0,
  last_agent_seen_at: null,
  latest_fleet_snapshot_at: null,
  latest_configuration_updated_at: null,
  plan_counts: {},
};

function emptyHealthMetrics(): HealthMetrics {
  return { ...EMPTY_HEALTH_METRICS, plan_counts: {} };
}

function numberMetric(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function timestampMetric(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

async function readFleetMetricsSummary(env: Env): Promise<FleetMetricsSummary> {
  const empty: FleetMetricsSummary = {
    available: false,
    error: null,
    total_agents: 0,
    connected_agents: 0,
    disconnected_agents: 0,
    unknown_agents: 0,
    healthy_agents: 0,
    unhealthy_agents: 0,
    stale_agents: 0,
    configurations_with_agents: 0,
    latest_snapshot_at: null,
  };

  if (!isAnalyticsSqlConfigured(env)) return empty;

  try {
    const rows = await runAnalyticsSql<FleetSummaryRow>(env, currentFleetSummary());
    const row = rows[0];
    if (!row) return { ...empty, available: true };
    const totalAgents = numberMetric(row.total_agents);
    const connectedAgents = numberMetric(row.connected_agents);
    const disconnectedAgents = numberMetric(row.disconnected_agents);
    return {
      available: true,
      error: null,
      total_agents: totalAgents,
      connected_agents: connectedAgents,
      disconnected_agents: disconnectedAgents,
      unknown_agents: Math.max(totalAgents - connectedAgents - disconnectedAgents, 0),
      healthy_agents: numberMetric(row.healthy_agents),
      unhealthy_agents: numberMetric(row.unhealthy_agents),
      stale_agents: numberMetric(row.stale_agents),
      configurations_with_agents: numberMetric(row.configurations_with_agents),
      latest_snapshot_at: timestampMetric(row.latest_snapshot_at),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("readFleetMetricsSummary: AE query failed:", error);
    return { ...empty, error };
  }
}

async function readTenantFleetSummaries(env: Env): Promise<{
  available: boolean;
  error: string | null;
  byTenant: Map<string, TenantFleetSummaryRow>;
}> {
  const empty: {
    available: boolean;
    error: string | null;
    byTenant: Map<string, TenantFleetSummaryRow>;
  } = {
    available: false,
    error: null,
    byTenant: new Map<string, TenantFleetSummaryRow>(),
  };
  if (!isAnalyticsSqlConfigured(env)) return empty;

  try {
    const rows = await runAnalyticsSql<TenantFleetSummaryRow>(env, currentFleetSummaryByTenant());
    const byTenant = new Map<string, TenantFleetSummaryRow>();
    for (const row of rows) {
      if (row.tenant_id) byTenant.set(row.tenant_id, row);
    }
    return { available: true, error: null, byTenant };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("readTenantFleetSummaries: AE query failed:", error);
    return { ...empty, error };
  }
}

async function handleHealthCheck(env: Env): Promise<Response> {
  const checks: Record<string, HealthCheck> = {};
  let metrics: HealthMetrics = emptyHealthMetrics();
  const fleetMetrics = await readFleetMetricsSummary(env);

  checks["worker"] = { status: "healthy", detail: "Worker request handler is responding" };

  // D1 health
  const d1Start = Date.now();
  try {
    const nowIso = new Date().toISOString();
    const results = await env.FP_DB.batch([
      env.FP_DB.prepare("SELECT COUNT(*) as count FROM tenants"),
      env.FP_DB.prepare("SELECT COUNT(*) as count FROM configurations"),
      env.FP_DB.prepare(
        `SELECT COUNT(*) as count
         FROM tenants t
         LEFT JOIN configurations c ON c.tenant_id = t.id
         WHERE c.id IS NULL`,
      ),
      env.FP_DB.prepare("SELECT COUNT(*) as count FROM users"),
      env.FP_DB.prepare("SELECT COUNT(*) as count FROM sessions WHERE expires_at > ?").bind(nowIso),
      env.FP_DB.prepare(
        "SELECT COUNT(*) as count FROM sessions WHERE is_impersonation = 1 AND expires_at > ?",
      ).bind(nowIso),
      env.FP_DB.prepare("SELECT COUNT(*) as count FROM enrollment_tokens WHERE revoked_at IS NULL"),
      env.FP_DB.prepare(
        "SELECT MAX(updated_at) as latest_configuration_updated_at FROM configurations",
      ),
      env.FP_DB.prepare("SELECT plan, COUNT(*) as count FROM tenants GROUP BY plan"),
    ]);

    function countAt(index: number): number {
      const row = results[index]?.results?.[0] as { count?: number } | undefined;
      return row?.count ?? 0;
    }

    const latestConfigRow = results[7]?.results?.[0] as
      | { latest_configuration_updated_at?: string | null }
      | undefined;
    const planRows = (results[8]?.results ?? []) as Array<{ plan?: string; count?: number }>;
    const planCounts: Record<string, number> = {};
    for (const row of planRows) {
      if (row.plan) planCounts[row.plan] = row.count ?? 0;
    }

    metrics = {
      total_tenants: countAt(0),
      total_configurations: countAt(1),
      tenants_without_configurations: countAt(2),
      configurations_without_agents: fleetMetrics.available
        ? Math.max(countAt(1) - fleetMetrics.configurations_with_agents, 0)
        : 0,
      total_users: countAt(3),
      active_sessions: countAt(4),
      impersonation_sessions: countAt(5),
      active_tokens: countAt(6),
      total_agents: fleetMetrics.total_agents,
      connected_agents: fleetMetrics.connected_agents,
      disconnected_agents: fleetMetrics.disconnected_agents,
      unknown_agents: fleetMetrics.unknown_agents,
      healthy_agents: fleetMetrics.healthy_agents,
      unhealthy_agents: fleetMetrics.unhealthy_agents,
      stale_agents: fleetMetrics.stale_agents,
      last_agent_seen_at: null,
      latest_fleet_snapshot_at: fleetMetrics.latest_snapshot_at,
      latest_configuration_updated_at: latestConfigRow?.latest_configuration_updated_at ?? null,
      plan_counts: planCounts,
    };

    checks["d1"] = {
      status: "healthy",
      latency_ms: Date.now() - d1Start,
      detail: "Core admin entity tables are queryable",
    };
  } catch (e) {
    checks["d1"] = {
      status: "unhealthy",
      latency_ms: Date.now() - d1Start,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  // R2 health
  const r2Start = Date.now();
  try {
    const listed = await env.FP_CONFIGS.list({ limit: 1 });
    checks["r2"] = {
      status: "healthy",
      latency_ms: Date.now() - r2Start,
      detail:
        listed.objects.length > 0
          ? "Configuration object listing returned at least one object"
          : "Configuration object listing is reachable; no objects sampled",
    };
  } catch (e) {
    checks["r2"] = {
      status: "unhealthy",
      latency_ms: Date.now() - r2Start,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  // Durable Objects — check namespace is bound
  try {
    if (env.CONFIG_DO) {
      checks["durable_objects"] = {
        status: "healthy",
        detail: "Config Durable Object namespace is bound",
      };
    } else {
      checks["durable_objects"] = { status: "unhealthy", error: "Namespace not bound" };
    }
  } catch (e) {
    checks["durable_objects"] = {
      status: "unhealthy",
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  const overall = Object.values(checks).every((c) => c.status === "healthy")
    ? "healthy"
    : "degraded";
  const bindingProbeEntries = Object.entries(checks).filter(([key]) =>
    ["d1", "r2", "durable_objects"].includes(key),
  );
  const degradedBindings = bindingProbeEntries.filter(
    ([, check]) => check.status !== "healthy" && check.status !== "ok",
  );
  const bindingProbeStatus =
    degradedBindings.length === 0
      ? "connected"
      : degradedBindings.some(([, check]) => check.status === "unavailable")
        ? "unavailable"
        : "degraded";
  const bindingProbeDetail =
    degradedBindings.length === 0
      ? "Live Worker binding probes for D1, R2, and Durable Objects"
      : `Needs attention: ${degradedBindings.map(([key]) => key).join(", ")}`;
  const cloudflareAccountMetricsConfigured = cloudflareUsageRequiredEnv(env).length === 0;
  const sources: Record<string, HealthDataSource> = {
    app_database: {
      status: checks["d1"]?.status === "healthy" ? "connected" : "unavailable",
      detail: "O11yFleet D1 entity tables: tenants, configurations, users, sessions, and tokens",
    },
    binding_probes: {
      status: bindingProbeStatus,
      detail: bindingProbeDetail,
    },
    analytics_engine: {
      status: fleetMetrics.available
        ? "connected"
        : isAnalyticsSqlConfigured(env)
          ? "error"
          : env.FP_ANALYTICS
            ? "write_only"
            : "not_bound",
      detail: fleetMetrics.available
        ? "Analytics Engine SQL returned current fleet metrics"
        : fleetMetrics.error
          ? `Analytics Engine SQL failed: ${fleetMetrics.error}`
          : "Analytics Engine SQL credentials are not configured; fleet metrics are unavailable",
    },
    cloudflare_account_metrics: {
      status: cloudflareAccountMetricsConfigured ? "configured" : "not_configured",
      detail: cloudflareAccountMetricsConfigured
        ? "Cloudflare account analytics credentials are configured for usage estimation"
        : "No Cloudflare account analytics or billing API credentials are configured for this endpoint",
    },
  };
  return Response.json({
    status: overall,
    checks,
    metrics,
    sources,
    timestamp: new Date().toISOString(),
  });
}

// ─── Plans ──────────────────────────────────────────────────────────

async function handleListPlans(env: Env): Promise<Response> {
  const planDefs = Object.values(PLAN_DEFINITIONS);

  const counts = await env.FP_DB.prepare(
    `SELECT plan, COUNT(*) as count FROM tenants GROUP BY plan`,
  ).all<{ plan: string; count: number }>();

  const countMap: Record<string, number> = {};
  for (const row of counts.results) {
    const plan = normalizePlan(row.plan) ?? row.plan;
    countMap[plan] = (countMap[plan] ?? 0) + row.count;
  }

  const plans = planDefs.map((p) => ({
    ...p,
    tenant_count: countMap[p.id] ?? 0,
  }));

  return Response.json({ plans });
}

// ─── Admin Overview ─────────────────────────────────────────────────

async function handleAdminOverview(env: Env): Promise<Response> {
  const results = await env.FP_DB.batch([
    env.FP_DB.prepare("SELECT COUNT(*) as count FROM tenants"),
    env.FP_DB.prepare("SELECT COUNT(*) as count FROM configurations"),
    env.FP_DB.prepare("SELECT COUNT(*) as count FROM enrollment_tokens WHERE revoked_at IS NULL"),
    env.FP_DB.prepare("SELECT COUNT(*) as count FROM users"),
  ]);
  const fleetMetrics = await readFleetMetricsSummary(env);

  function getCount(idx: number): number {
    const row = results[idx]?.results?.[0] as { count?: number } | undefined;
    return row?.count ?? 0;
  }

  return Response.json({
    total_tenants: getCount(0),
    total_configurations: getCount(1),
    total_active_tokens: getCount(2),
    total_users: getCount(3),
    total_agents: fleetMetrics.total_agents,
    connected_agents: fleetMetrics.connected_agents,
    healthy_agents: fleetMetrics.healthy_agents,
    metrics_source: fleetMetrics.available ? "analytics_engine" : "unavailable",
    metrics_error: fleetMetrics.error,
  });
}

// ─── Tenant Impersonation ────────────────────────────────────────────

async function handleImpersonateTenant(
  request: Request,
  env: Env,
  tenantId: string,
): Promise<Response> {
  const tenant = await env.FP_DB.prepare(`SELECT id, name FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first<{ id: string; name: string }>();
  if (!tenant) return jsonError("Tenant not found", 404);

  const email = `impersonation+${tenantId}@o11yfleet.local`;
  let user = await env.FP_DB.prepare(
    `SELECT id, email, display_name, role, tenant_id
     FROM users
     WHERE email = ?
     LIMIT 1`,
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      display_name: string;
      role: string;
      tenant_id: string | null;
    }>();

  if (!user) {
    await env.FP_DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role, tenant_id)
       VALUES (?, ?, ?, ?, 'member', ?)`,
    )
      .bind(
        crypto.randomUUID(),
        email,
        "impersonation:disabled",
        `Admin view: ${tenant.name}`,
        tenantId,
      )
      .run();
    user = await env.FP_DB.prepare(
      `SELECT id, email, display_name, role, tenant_id
       FROM users
       WHERE email = ?
       LIMIT 1`,
    )
      .bind(email)
      .first<{
        id: string;
        email: string;
        display_name: string;
        role: string;
        tenant_id: string | null;
      }>();
    if (!user) throw new ApiError("Failed to provision impersonation user", 500);
  }

  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.FP_DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, is_impersonation) VALUES (?, ?, ?, 1)",
  )
    .bind(sessionId, user.id, expiresAt)
    .run();

  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return Response.json(
    {
      user: {
        userId: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        tenantId: user.tenant_id,
        isImpersonation: true,
      },
    },
    { headers: { "Set-Cookie": sessionCookie(sessionId, maxAge, env, request) } },
  );
}

// ─── Tenant Approval ────────────────────────────────────────────────

interface TenantWithUser {
  id: string;
  name: string;
  email: string;
  tenant_status: string | null;
}

async function getTenantWithPrimaryUser(
  env: Env,
  tenantId: string,
): Promise<TenantWithUser | null> {
  const tenant = await env.FP_DB.prepare(
    `SELECT t.id, t.name, u.email
     FROM tenants t
     LEFT JOIN users u ON u.tenant_id = t.id
     WHERE t.id = ?
     LIMIT 1`,
  )
    .bind(tenantId)
    .first<{ id: string; name: string; email: string }>();

  if (!tenant) return null;

  const status = await env.FP_DB.prepare("SELECT status FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ status: string }>();

  return {
    id: tenant.id,
    name: tenant.name,
    email: tenant.email ?? "",
    tenant_status: status?.status ?? null,
  };
}

async function handleApproveTenant(
  request: Request,
  env: Env,
  tenantId: string,
): Promise<Response> {
  const body = await validateJsonBody(request, adminApproveTenantRequestSchema);

  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return jsonError("Tenant not found", 404);

  const adminId = request.headers.get("X-Admin-Id") ?? "system";

  if (body.action === "approve") {
    await env.FP_DB.prepare(
      `UPDATE tenants
       SET status = 'active', approved_at = datetime('now'), approved_by = ?
       WHERE id = ?`,
    )
      .bind(adminId, tenantId)
      .run();

    // Send approval email
    const tenantWithUser = await getTenantWithPrimaryUser(env, tenantId);
    if (tenantWithUser?.email) {
      await sendTenantApprovalEmail(env, {
        tenantName: tenantWithUser.name,
        tenantEmail: tenantWithUser.email,
        action: "approved",
      });
    }

    return Response.json({ success: true, status: "active", tenantId });
  } else if (body.action === "reject") {
    // Mark as suspended (or you could delete the tenant)
    await env.FP_DB.prepare(`UPDATE tenants SET status = 'suspended' WHERE id = ?`)
      .bind(tenantId)
      .run();

    // Send rejection email
    const tenantWithUser = await getTenantWithPrimaryUser(env, tenantId);
    if (tenantWithUser?.email) {
      await sendTenantApprovalEmail(env, {
        tenantName: tenantWithUser.name,
        tenantEmail: tenantWithUser.email,
        action: "rejected",
        reason: body.reason,
      });
    }

    return Response.json({ success: true, status: "suspended", tenantId });
  }

  return jsonError("Invalid action", 400);
}

async function handleBulkApproveTenants(request: Request, env: Env): Promise<Response> {
  const body = await validateJsonBody(request, adminBulkApproveRequestSchema);
  const adminId = request.headers.get("X-Admin-Id") ?? "system";

  const approved: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const tenantId of body.tenant_ids) {
    try {
      const tenant = await findTenantById(env, tenantId);
      if (!tenant) {
        failed.push({ id: tenantId, error: "Tenant not found" });
        continue;
      }

      const tenantStatus = (tenant as Record<string, unknown>)["status"] as string | undefined;
      if (tenantStatus !== "pending") {
        failed.push({ id: tenantId, error: `Tenant is ${tenantStatus ?? "unknown"}, not pending` });
        continue;
      }

      await env.FP_DB.prepare(
        `UPDATE tenants
         SET status = 'active', approved_at = datetime('now'), approved_by = ?
         WHERE id = ? AND status = 'pending'`,
      )
        .bind(adminId, tenantId)
        .run();

      // Send approval email
      const tenantWithUser = await getTenantWithPrimaryUser(env, tenantId);
      if (tenantWithUser?.email) {
        await sendTenantApprovalEmail(env, {
          tenantName: tenantWithUser.name,
          tenantEmail: tenantWithUser.email,
          action: "approved",
        });
      }

      approved.push(tenantId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ id: tenantId, error });
    }
  }

  return Response.json({ approved, failed });
}

// ─── Admin Settings ─────────────────────────────────────────────────

async function handleGetSettings(env: Env): Promise<Response> {
  return Response.json({
    auto_approve_signups: isAutoApproveEnabled(env),
  });
}

async function handleUpdateSettings(_request: Request, _env: Env): Promise<Response> {
  // Note: Settings are controlled via environment variables in production
  // This endpoint is primarily for reading current state
  // In a full implementation, you might persist settings to D1 or KV
  return jsonError(
    "Settings must be updated via environment variables (FP_SIGNUP_AUTO_APPROVE)",
    400,
  );
}
