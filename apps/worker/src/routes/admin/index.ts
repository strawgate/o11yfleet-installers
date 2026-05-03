// Admin API routes — full tenant management, system health, impersonation
// These endpoints require admin auth before reaching this router.

import type { Env } from "../../index.js";
import {
  recordEvent,
  recordMutation,
  type AuditContext,
  type AuditCreateMeta,
  type AuditCreateResult,
  type AuditDescriptor,
} from "../../audit/recorder.js";
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
import { sql, type RawBuilder } from "kysely";
import { getDb } from "../../db/client.js";
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
    console.error("Admin API error:", err);
    return jsonError("Internal server error", 500);
  }
}

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

function recordOnAdminAndCustomer(
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

async function routeAdminRequest(
  request: Request,
  env: Env,
  url: URL,
  audit?: AuditContext,
): Promise<Response> {
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
    return withAdminAuditCreate(
      audit,
      { action: "admin.tenant.create", resource_type: "tenant" },
      () => handleCreateTenant(request, env),
    );
  }
  if (path === "/api/admin/tenants" && method === "GET") {
    return handleListTenants(env, url);
  }

  const tenantIdMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)$/);
  if (tenantIdMatch) {
    const targetId = tenantIdMatch[1]!;
    if (method === "GET") return handleGetTenant(env, targetId);
    if (method === "PUT") {
      return withAdminAudit(
        audit,
        { action: "admin.tenant.update", resource_type: "tenant", resource_id: targetId },
        () => handleUpdateTenant(request, env, targetId),
        targetId,
      );
    }
    if (method === "DELETE") {
      return withAdminAudit(
        audit,
        { action: "admin.tenant.delete", resource_type: "tenant", resource_id: targetId },
        () => handleDeleteTenant(env, targetId),
        targetId,
      );
    }
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
    const targetId = tenantImpersonateMatch[1]!;
    // Only user-actor admins can start an impersonation; system actors
    // (OIDC bootstrap path) shouldn't be able to mint impersonation
    // sessions, so adminUserId is null in that case.
    const adminUserId = audit?.actor.kind === "user" ? audit.actor.user_id : null;
    return withAdminAudit(
      audit,
      {
        action: "admin.tenant.impersonate_start",
        resource_type: "tenant",
        resource_id: targetId,
      },
      () => handleImpersonateTenant(request, env, targetId, adminUserId),
      targetId,
    );
  }

  // POST /api/admin/tenants/:id/approve — approve or reject a tenant
  const tenantApproveMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)\/approve$/);
  if (tenantApproveMatch && method === "POST") {
    const targetId = tenantApproveMatch[1]!;
    return withAdminAudit(
      audit,
      { action: "admin.tenant.approve", resource_type: "tenant", resource_id: targetId },
      () => handleApproveTenant(request, env, targetId),
      targetId,
    );
  }

  // POST /api/admin/bulk-approve — bulk approve pending tenants
  if (path === "/api/admin/bulk-approve" && method === "POST") {
    const resp = await withAdminAudit(
      audit,
      { action: "admin.tenant.bulk_approve", resource_type: "tenant", resource_id: null },
      () => handleBulkApproveTenants(request, env),
    );
    // Mirror an `admin.tenant.approve` event into each approved tenant's
    // own audit log so customers see the action under their tenant. The
    // wrapper records the admin-stream event; we add the per-tenant
    // mirrors here because the approved set is only known post-response.
    if (audit && resp.ok) {
      const cloned = resp.clone();
      try {
        const body = (await cloned.json()) as { approved?: unknown };
        // Defensive: only treat entries as tenant ids if they're plain
        // non-empty strings. A malformed handler response or future
        // shape change shouldn't write audit rows under arbitrary
        // tenant ids.
        const approvedIds: string[] = Array.isArray(body.approved)
          ? body.approved.filter((id): id is string => typeof id === "string" && id.length > 0)
          : [];
        for (const customerTenantId of approvedIds) {
          const customerAudit: AuditContext = {
            ...audit,
            scope: { kind: "tenant", tenant_id: customerTenantId },
            actor:
              audit.actor.kind === "user"
                ? { ...audit.actor, impersonator_user_id: audit.actor.user_id }
                : audit.actor,
          };
          recordEvent(
            customerAudit,
            {
              action: "admin.tenant.approve",
              resource_type: "tenant",
              resource_id: customerTenantId,
            },
            "success",
            200,
          );
        }
      } catch {
        // Body wasn't JSON or didn't contain approved[]; skip per-tenant mirroring.
      }
    }
    return resp;
  }

  // GET /api/admin/settings — get admin settings
  if (path === "/api/admin/settings" && method === "GET") {
    return handleGetSettings(env);
  }

  // PUT /api/admin/settings — update admin settings (e.g., auto-approve)
  if (path === "/api/admin/settings" && method === "PUT") {
    return withAdminAudit(
      audit,
      { action: "admin.settings.update", resource_type: "settings", resource_id: null },
      () => handleUpdateSettings(request, env),
    );
  }

  const configDOTablesMatch = path.match(/^\/api\/admin\/configurations\/([^/]+)\/do\/tables$/);
  if (configDOTablesMatch && method === "GET") {
    return handleDoTables(env, configDOTablesMatch[1]!);
  }

  const configDOQueryMatch = path.match(/^\/api\/admin\/configurations\/([^/]+)\/do\/query$/);
  if (configDOQueryMatch && method === "POST") {
    const configId = configDOQueryMatch[1]!;
    const owner = await getDb(env.FP_DB)
      .selectFrom("configurations")
      .select("tenant_id")
      .where("id", "=", configId)
      .executeTakeFirst();
    return withAdminAudit(
      audit,
      { action: "admin.do.query", resource_type: "configuration", resource_id: configId },
      () => handleDoQuery(request, env, configId),
      owner?.tenant_id,
    );
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

async function handleCreateTenant(request: Request, env: Env): Promise<AuditCreateResult> {
  const body = await validateJsonBody(request, adminCreateTenantRequestSchema);

  const plan = normalizePlan(body.plan ?? DEFAULT_PLAN);
  if (!plan) {
    return {
      response: jsonError(`Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}`, 400),
      resource_id: null,
    };
  }

  const limits = PLAN_LIMITS[plan];

  const id = crypto.randomUUID();
  await getDb(env.FP_DB)
    .insertInto("tenants")
    .values({
      id,
      name: body.name,
      plan,
      max_configs: limits.max_configs,
      max_agents_per_config: limits.max_agents_per_config,
    })
    .execute();

  return {
    response: Response.json({ id, name: body.name, plan }, { status: 201 }),
    resource_id: id,
  };
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
  const status: "pending" | "active" | "suspended" | null =
    requestedStatus === "pending" || requestedStatus === "active" || requestedStatus === "suspended"
      ? requestedStatus
      : null;
  const sort = normalizeTenantSort(url.searchParams.get("sort"));
  const limit = boundedPositiveInt(url.searchParams.get("limit"), 100, 500);
  const page = boundedPositiveInt(url.searchParams.get("page"), 1, 10_000);
  const offset = (page - 1) * limit;

  const db = getDb(env.FP_DB);

  // Compose WHERE filters once; reuse for both the count and the page query.
  // Kysely's `eb.and([...])` lets the column references stay typed and the
  // planner still gets to use the same index-friendly shapes the previous
  // raw SQL did (LIKE ESCAPE '\' COLLATE NOCASE on t.name/t.id).
  const applyFilters = <T extends ReturnType<typeof db.selectFrom<"tenants as t">>>(qb: T): T => {
    let next = qb;
    if (q.length > 0) {
      const escaped = q.replace(/[\\%_]/g, "\\$&");
      const qLike = `%${escaped}%`;
      next = next.where((eb) =>
        eb.or([
          sql<boolean>`t.name LIKE ${qLike} ESCAPE '\\' COLLATE NOCASE`,
          sql<boolean>`t.id LIKE ${qLike} ESCAPE '\\' COLLATE NOCASE`,
        ]),
      ) as T;
    }
    if (plan !== "all") next = next.where("t.plan", "=", plan) as T;
    if (status) next = next.where("t.status", "=", status) as T;
    return next;
  };

  const totalRow = await applyFilters(db.selectFrom("tenants as t"))
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .executeTakeFirst();

  // The TENANT_SORTS values are already SQL fragments (table-qualified column
  // refs with direction); pass them through as raw expressions so the planner
  // sees the same ORDER BY shape as the previous inline SQL.
  const rows = await applyFilters(db.selectFrom("tenants as t"))
    .selectAll("t")
    .select((eb) =>
      eb
        .selectFrom("configurations")
        .select((cb) => cb.fn.countAll<number>().as("c"))
        .whereRef("configurations.tenant_id", "=", "t.id")
        .as("config_count"),
    )
    .orderBy(sql.raw(TENANT_SORTS[sort]))
    .limit(limit)
    .offset(offset)
    .execute();

  const tenantMetrics = await readTenantFleetSummaries(env);
  const tenants = rows.map((tenant) => {
    const metrics = tenantMetrics.byTenant.get(tenant.id);
    return {
      ...tenant,
      agent_count: numberMetric(metrics?.agent_count),
      connected_agents: numberMetric(metrics?.connected_agents),
      healthy_agents: numberMetric(metrics?.healthy_agents),
      metrics_source: tenantMetrics.available ? "analytics_engine" : "unavailable",
    };
  });
  const total = totalRow?.count ?? 0;

  // Get counts by status for filter badges.
  const statusCounts = await db
    .selectFrom("tenants")
    .select(["status", (eb) => eb.fn.countAll<number>().as("count")])
    .groupBy("status")
    .execute();

  const statusCountsMap: Record<string, number> = {};
  for (const row of statusCounts) statusCountsMap[row.status] = row.count;

  return Response.json({
    tenants,
    pagination: { page, limit, total, has_more: offset + rows.length < total },
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
  const set: {
    name?: string;
    plan?: NonNullable<ReturnType<typeof normalizePlan>>;
    max_configs?: number;
    max_agents_per_config?: number;
    geo_enabled?: 0 | 1;
    status?: "pending" | "active" | "suspended";
    approved_at?: RawBuilder<string>;
    approved_by?: string;
    updated_at: RawBuilder<string>;
  } = { updated_at: sql<string>`datetime('now')` };

  if (body.name) set.name = body.name;
  if (body.plan) {
    const plan = normalizePlan(body.plan);
    if (!plan) {
      return jsonError(`Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}`, 400);
    }
    set.plan = plan;
    const limits = PLAN_LIMITS[plan];
    set.max_configs = limits.max_configs;
    set.max_agents_per_config = limits.max_agents_per_config;
  }
  if (body.geo_enabled !== undefined) set.geo_enabled = body.geo_enabled ? 1 : 0;
  if (body.status) {
    if (!["pending", "active", "suspended"].includes(body.status)) {
      return jsonError("Invalid status. Must be one of: pending, active, suspended", 400);
    }
    set.status = body.status as "pending" | "active" | "suspended";
    // If approving (setting to active), set approved_at + approved_by
    if (body.status === "active") {
      set.approved_at = sql<string>`datetime('now')`;
      set.approved_by = request.headers.get("X-Admin-Id") ?? "system";
    }
  }

  if (Object.keys(set).length === 1) {
    return jsonError("No fields to update", 400);
  }

  // One round-trip: D1 supports `UPDATE ... RETURNING *`, so we can
  // collapse the previous existence-check SELECT, the UPDATE, and the
  // post-update SELECT into a single statement. A missing tenant
  // returns zero rows and we surface 404 from that.
  const updated = await getDb(env.FP_DB)
    .updateTable("tenants")
    .set(set)
    .where("id", "=", tenantId)
    .returningAll()
    .executeTakeFirst();
  if (!updated) return jsonError("Tenant not found", 404);
  return Response.json(updated);
}

async function handleDeleteTenant(env: Env, tenantId: string): Promise<Response> {
  // Cheap existence check — we don't need any tenant columns post-check.
  if (!(await tenantExists(env, tenantId))) {
    return jsonError("Tenant not found", 404);
  }

  const configs = await getDb(env.FP_DB)
    .selectFrom("configurations")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();
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
  const configurations = await getDb(env.FP_DB)
    .selectFrom("configurations")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc")
    .execute();
  return Response.json({ configurations });
}

// ─── Tenant Users ───────────────────────────────────────────────────

async function handleListTenantUsers(env: Env, tenantId: string): Promise<Response> {
  if (!(await tenantExists(env, tenantId))) {
    return jsonError("Tenant not found", 404);
  }

  const users = await getDb(env.FP_DB)
    .selectFrom("users")
    .select(["id", "email", "display_name", "role", "created_at"])
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc")
    .execute();
  return Response.json({ users });
}

async function getConfigDoStub(env: Env, configId: string): Promise<DurableObjectStub> {
  const config = await getDb(env.FP_DB)
    .selectFrom("configurations")
    .select(["id", "tenant_id"])
    .where("id", "=", configId)
    .executeTakeFirst();
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
    const db = getDb(env.FP_DB);
    // Run the count queries in parallel via Promise.all. The previous
    // env.FP_DB.batch([...]) was being used for parallelism, not
    // atomicity, so this preserves the original behaviour.
    const [
      tenantsCount,
      configsCount,
      tenantsWithoutConfigsCount,
      usersCount,
      activeSessionsCount,
      impersonationSessionsCount,
      activeTokensCount,
      latestConfigRow,
      planRows,
    ] = await Promise.all([
      db
        .selectFrom("tenants")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirst(),
      db
        .selectFrom("configurations")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirst(),
      db
        .selectFrom("tenants as t")
        .leftJoin("configurations as c", "c.tenant_id", "t.id")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("c.id", "is", null)
        .executeTakeFirst(),
      db
        .selectFrom("users")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirst(),
      db
        .selectFrom("sessions")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("expires_at", ">", nowIso)
        .executeTakeFirst(),
      db
        .selectFrom("sessions")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("is_impersonation", "=", 1)
        .where("expires_at", ">", nowIso)
        .executeTakeFirst(),
      db
        .selectFrom("enrollment_tokens")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("revoked_at", "is", null)
        .executeTakeFirst(),
      db
        .selectFrom("configurations")
        .select((eb) => eb.fn.max("updated_at").as("latest_configuration_updated_at"))
        .executeTakeFirst(),
      db
        .selectFrom("tenants")
        .select(["plan", (eb) => eb.fn.countAll<number>().as("count")])
        .groupBy("plan")
        .execute(),
    ]);

    const planCounts: Record<string, number> = {};
    for (const row of planRows) planCounts[row.plan] = row.count;

    metrics = {
      total_tenants: tenantsCount?.count ?? 0,
      total_configurations: configsCount?.count ?? 0,
      tenants_without_configurations: tenantsWithoutConfigsCount?.count ?? 0,
      configurations_without_agents: fleetMetrics.available
        ? Math.max((configsCount?.count ?? 0) - fleetMetrics.configurations_with_agents, 0)
        : 0,
      total_users: usersCount?.count ?? 0,
      active_sessions: activeSessionsCount?.count ?? 0,
      impersonation_sessions: impersonationSessionsCount?.count ?? 0,
      active_tokens: activeTokensCount?.count ?? 0,
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

  const counts = await getDb(env.FP_DB)
    .selectFrom("tenants")
    .select(["plan", (eb) => eb.fn.countAll<number>().as("count")])
    .groupBy("plan")
    .execute();

  const countMap: Record<string, number> = {};
  for (const row of counts) {
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
  const db = getDb(env.FP_DB);
  const [tenantsCount, configsCount, activeTokensCount, usersCount, fleetMetrics] =
    await Promise.all([
      db
        .selectFrom("tenants")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirst(),
      db
        .selectFrom("configurations")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirst(),
      db
        .selectFrom("enrollment_tokens")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("revoked_at", "is", null)
        .executeTakeFirst(),
      db
        .selectFrom("users")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .executeTakeFirst(),
      readFleetMetricsSummary(env),
    ]);

  return Response.json({
    total_tenants: tenantsCount?.count ?? 0,
    total_configurations: configsCount?.count ?? 0,
    total_active_tokens: activeTokensCount?.count ?? 0,
    total_users: usersCount?.count ?? 0,
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
  adminUserId: string | null,
): Promise<Response> {
  const db = getDb(env.FP_DB);
  const tenant = await db
    .selectFrom("tenants")
    .select(["id", "name"])
    .where("id", "=", tenantId)
    .executeTakeFirst();
  if (!tenant) return jsonError("Tenant not found", 404);

  const email = `impersonation+${tenantId}@o11yfleet.local`;
  let user = await db
    .selectFrom("users")
    .select(["id", "email", "display_name", "role", "tenant_id"])
    .where("email", "=", email)
    .limit(1)
    .executeTakeFirst();

  if (!user) {
    await db
      .insertInto("users")
      .values({
        id: crypto.randomUUID(),
        email,
        password_hash: "impersonation:disabled",
        display_name: `Admin view: ${tenant.name}`,
        role: "member",
        tenant_id: tenantId,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    user = await db
      .selectFrom("users")
      .select(["id", "email", "display_name", "role", "tenant_id"])
      .where("email", "=", email)
      .limit(1)
      .executeTakeFirst();
    if (!user) throw new ApiError("Failed to provision impersonation user", 500);
  }

  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  // impersonator_user_id records the *real* admin so customer audit
  // logs can surface "support touched my tenant" entries with the
  // actual operator, not the synthetic impersonation+ user.
  await db
    .insertInto("sessions")
    .values({
      id: sessionId,
      user_id: user.id,
      expires_at: expiresAt,
      is_impersonation: 1,
      impersonator_user_id: adminUserId,
    })
    .execute();

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
  const db = getDb(env.FP_DB);
  const tenant = await db
    .selectFrom("tenants as t")
    .leftJoin("users as u", "u.tenant_id", "t.id")
    .select(["t.id", "t.name", "u.email"])
    .where("t.id", "=", tenantId)
    .limit(1)
    .executeTakeFirst();

  if (!tenant) return null;

  const status = await db
    .selectFrom("tenants")
    .select("status")
    .where("id", "=", tenantId)
    .executeTakeFirst();

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
    await getDb(env.FP_DB)
      .updateTable("tenants")
      .set({
        status: "active",
        approved_at: sql<string>`datetime('now')`,
        approved_by: adminId,
      })
      .where("id", "=", tenantId)
      .execute();

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
    await getDb(env.FP_DB)
      .updateTable("tenants")
      .set({ status: "suspended" })
      .where("id", "=", tenantId)
      .execute();

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

      await getDb(env.FP_DB)
        .updateTable("tenants")
        .set({
          status: "active",
          approved_at: sql<string>`datetime('now')`,
          approved_by: adminId,
        })
        .where("id", "=", tenantId)
        .where("status", "=", "pending")
        .execute();

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
    "Settings must be updated via environment variables (O11YFLEET_SIGNUP_AUTO_APPROVE)",
    400,
  );
}
