// Admin API routes — full tenant management, system health, impersonation
// These endpoints require admin auth before reaching this router.

import type { Env } from "../../index.js";
import {
  adminCreateTenantRequestSchema,
  adminDoQueryRequestSchema,
  adminUpdateTenantRequestSchema,
} from "@o11yfleet/core/api";
import {
  AiApiError,
  handleAdminChatRequest,
  handleAdminGuidanceRequest,
} from "../../ai/guidance.js";
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
  const sort = normalizeTenantSort(url.searchParams.get("sort"));
  const limit = boundedPositiveInt(url.searchParams.get("limit"), 100, 500);
  const page = boundedPositiveInt(url.searchParams.get("page"), 1, 10_000);
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const whereParams: unknown[] = [];
  if (q.length > 0) {
    whereClauses.push(
      "(LOWER(t.name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(t.id) LIKE LOWER(?) ESCAPE '\\')",
    );
    const escaped = q.replace(/[\\%_]/g, "\\$&");
    const qLike = `%${escaped}%`;
    whereParams.push(qLike, qLike);
  }
  if (plan !== "all") {
    whereClauses.push("t.plan = ?");
    whereParams.push(plan);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const totalRow = await env.FP_DB.prepare(`SELECT COUNT(*) as count FROM tenants t ${whereSql}`)
    .bind(...whereParams)
    .first<{ count: number }>();
  const result = await env.FP_DB.prepare(
    `SELECT
      t.*,
      COALESCE(c.config_count, 0) as config_count,
      COALESCE(a.agent_count, 0) as agent_count,
      COALESCE(a.connected_agents, 0) as connected_agents,
      COALESCE(a.healthy_agents, 0) as healthy_agents
     FROM tenants t
     LEFT JOIN (
       SELECT tenant_id, COUNT(*) as config_count
       FROM configurations
       GROUP BY tenant_id
     ) c ON c.tenant_id = t.id
     LEFT JOIN (
       SELECT
         tenant_id,
         COUNT(*) as agent_count,
         COALESCE(SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END), 0) as connected_agents,
         COALESCE(SUM(CASE WHEN healthy = 1 THEN 1 ELSE 0 END), 0) as healthy_agents
       FROM agent_summaries
       GROUP BY tenant_id
     ) a ON a.tenant_id = t.id
     ${whereSql}
     ORDER BY ${TENANT_SORTS[sort]}
     LIMIT ? OFFSET ?`,
  )
    .bind(...whereParams, limit, offset)
    .all();
  const total = totalRow?.count ?? 0;
  return Response.json({
    tenants: result.results,
    pagination: { page, limit, total, has_more: offset + result.results.length < total },
    filters: { q, plan, sort },
  });
}

async function handleGetTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);
  return Response.json(tenant);
}

async function handleUpdateTenant(request: Request, env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);

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

  if (updates.length === 0) {
    return jsonError("No fields to update", 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(tenantId);

  await env.FP_DB.prepare(`UPDATE tenants SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  return Response.json(updated);
}

async function handleDeleteTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);

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

  await env.FP_DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(tenantId).run();
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
  const tenant = await env.FP_DB.prepare(`SELECT id FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);

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
  latest_configuration_updated_at: string | null;
  plan_counts: Record<string, number>;
}

interface HealthDataSource {
  status: string;
  detail: string;
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
  latest_configuration_updated_at: null,
  plan_counts: {},
};

function emptyHealthMetrics(): HealthMetrics {
  return { ...EMPTY_HEALTH_METRICS, plan_counts: {} };
}

async function handleHealthCheck(env: Env): Promise<Response> {
  const checks: Record<string, HealthCheck> = {};
  let metrics: HealthMetrics = emptyHealthMetrics();

  checks["worker"] = { status: "healthy", detail: "Worker request handler is responding" };

  // D1 health
  const d1Start = Date.now();
  try {
    const nowIso = new Date().toISOString();
    const staleAgentCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const results = await env.FP_DB.batch([
      env.FP_DB.prepare("SELECT COUNT(*) as count FROM tenants"),
      env.FP_DB.prepare("SELECT COUNT(*) as count FROM configurations"),
      env.FP_DB.prepare(
        `SELECT COUNT(*) as count
         FROM tenants t
         LEFT JOIN configurations c ON c.tenant_id = t.id
         WHERE c.id IS NULL`,
      ),
      env.FP_DB.prepare(
        `SELECT COUNT(*) as count
         FROM configurations c
         LEFT JOIN agent_summaries a ON a.config_id = c.id
         WHERE a.instance_uid IS NULL`,
      ),
      env.FP_DB.prepare("SELECT COUNT(*) as count FROM users"),
      env.FP_DB.prepare("SELECT COUNT(*) as count FROM sessions WHERE expires_at > ?").bind(nowIso),
      env.FP_DB.prepare(
        "SELECT COUNT(*) as count FROM sessions WHERE is_impersonation = 1 AND expires_at > ?",
      ).bind(nowIso),
      env.FP_DB.prepare("SELECT COUNT(*) as count FROM enrollment_tokens WHERE revoked_at IS NULL"),
      env.FP_DB.prepare(
        `SELECT
          COUNT(*) as total_agents,
          COALESCE(SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END), 0) as connected_agents,
          COALESCE(SUM(CASE WHEN status = 'disconnected' THEN 1 ELSE 0 END), 0) as disconnected_agents,
          COALESCE(SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END), 0) as unknown_agents,
          COALESCE(SUM(CASE WHEN healthy = 1 THEN 1 ELSE 0 END), 0) as healthy_agents,
          COALESCE(SUM(CASE WHEN healthy = 0 THEN 1 ELSE 0 END), 0) as unhealthy_agents,
          COALESCE(SUM(CASE WHEN last_seen_at IS NOT NULL AND last_seen_at < ? THEN 1 ELSE 0 END), 0) as stale_agents,
          MAX(last_seen_at) as last_agent_seen_at
         FROM agent_summaries`,
      ).bind(staleAgentCutoff),
      env.FP_DB.prepare(
        "SELECT MAX(updated_at) as latest_configuration_updated_at FROM configurations",
      ),
      env.FP_DB.prepare("SELECT plan, COUNT(*) as count FROM tenants GROUP BY plan"),
    ]);

    function countAt(index: number): number {
      const row = results[index]?.results?.[0] as { count?: number } | undefined;
      return row?.count ?? 0;
    }

    const agentRow = results[8]?.results?.[0] as
      | {
          total_agents?: number;
          connected_agents?: number;
          disconnected_agents?: number;
          unknown_agents?: number;
          healthy_agents?: number;
          unhealthy_agents?: number;
          stale_agents?: number;
          last_agent_seen_at?: string | null;
        }
      | undefined;
    const latestConfigRow = results[9]?.results?.[0] as
      | { latest_configuration_updated_at?: string | null }
      | undefined;
    const planRows = (results[10]?.results ?? []) as Array<{ plan?: string; count?: number }>;
    const planCounts: Record<string, number> = {};
    for (const row of planRows) {
      if (row.plan) planCounts[row.plan] = row.count ?? 0;
    }

    metrics = {
      total_tenants: countAt(0),
      total_configurations: countAt(1),
      tenants_without_configurations: countAt(2),
      configurations_without_agents: countAt(3),
      total_users: countAt(4),
      active_sessions: countAt(5),
      impersonation_sessions: countAt(6),
      active_tokens: countAt(7),
      total_agents: agentRow?.total_agents ?? 0,
      connected_agents: agentRow?.connected_agents ?? 0,
      disconnected_agents: agentRow?.disconnected_agents ?? 0,
      unknown_agents: agentRow?.unknown_agents ?? 0,
      healthy_agents: agentRow?.healthy_agents ?? 0,
      unhealthy_agents: agentRow?.unhealthy_agents ?? 0,
      stale_agents: agentRow?.stale_agents ?? 0,
      last_agent_seen_at: agentRow?.last_agent_seen_at ?? null,
      latest_configuration_updated_at: latestConfigRow?.latest_configuration_updated_at ?? null,
      plan_counts: planCounts,
    };

    checks["d1"] = {
      status: "healthy",
      latency_ms: Date.now() - d1Start,
      detail: "Core admin tables and fleet counters are queryable",
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
      detail:
        "O11yFleet D1 tables: tenants, configurations, users, sessions, tokens, and agent summaries",
    },
    binding_probes: {
      status: bindingProbeStatus,
      detail: bindingProbeDetail,
    },
    analytics_engine: {
      status: env.FP_ANALYTICS ? "write_only" : "not_bound",
      detail:
        "Config and product metrics can write datapoints when the binding exists; this health endpoint does not query Analytics Engine yet",
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
    env.FP_DB.prepare(
      `SELECT
        COUNT(*) as total_agents,
        COALESCE(SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END), 0) as connected_agents,
        COALESCE(SUM(CASE WHEN healthy = 1 THEN 1 ELSE 0 END), 0) as healthy_agents
       FROM agent_summaries`,
    ),
  ]);

  function getCount(idx: number): number {
    const row = results[idx]?.results?.[0] as { count?: number } | undefined;
    return row?.count ?? 0;
  }
  const fleetStats = results[4]?.results?.[0] as
    | { total_agents?: number; connected_agents?: number; healthy_agents?: number }
    | undefined;

  return Response.json({
    total_tenants: getCount(0),
    total_configurations: getCount(1),
    total_active_tokens: getCount(2),
    total_users: getCount(3),
    total_agents: fleetStats?.total_agents ?? 0,
    connected_agents: fleetStats?.connected_agents ?? 0,
    healthy_agents: fleetStats?.healthy_agents ?? 0,
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
