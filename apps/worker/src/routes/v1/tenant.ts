// Tenant CRUD, team, overview, audit logs, and AI guidance routes

import { Hono } from "hono";
import type { Env } from "../../index.js";
import type { V1Env } from "./shared.js";
import { withAudit } from "./shared.js";
import {
  updateTenantRequestSchema,
  tenantSchema,
  overviewResponseSchema,
  type Tenant,
  type ConfigurationWithStats,
  type ConfigStats,
  type OverviewResponse,
} from "@o11yfleet/core/api";
import { handleTenantGuidanceRequest, handleTenantChatRequest } from "../../ai/guidance.js";
import { jsonError } from "../../shared/errors.js";
import { typedJsonResponse } from "../../shared/responses.js";
import { validateJsonBody } from "../../shared/validation.js";
import { sql, type RawBuilder } from "kysely";
import { getDb } from "../../db/client.js";
import { compileForBatch } from "../../db/queries.js";
import { findTenantById, countConfigsForTenant, type TenantRow } from "../../shared/db-helpers.js";
import { handleListAuditLogs } from "./audit-logs.js";
import { isAnalyticsSqlConfigured, runAnalyticsSql } from "../../analytics-sql.js";
import { latestSnapshotForTenant } from "@o11yfleet/core/metrics";

// ─── Handlers ───────────────────────────────────────────────────────

/**
 * Map a `tenants` D1 row to the public `Tenant` shape. D1 returns `null`
 * for unset optional columns (max_configs, approved_at, etc.) but the
 * `tenantSchema` expects `undefined` for those slots; coerce at the
 * boundary so the contract on the wire stays clean.
 */
function tenantFromRow(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    plan: row.plan,
    status: row.status ?? undefined,
    approved_at: row.approved_at ?? undefined,
    max_configs: row.max_configs ?? undefined,
    max_agents_per_config: row.max_agents_per_config ?? undefined,
    created_at: row.created_at ?? undefined,
    updated_at: row.updated_at ?? undefined,
  } satisfies Tenant;
}

export async function handleGetTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return jsonError("Tenant not found", 404);
  return typedJsonResponse(tenantSchema, tenantFromRow(tenant), env);
}

export async function handleDeleteTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return jsonError("Tenant not found", 404);

  const configCount = await countConfigsForTenant(env, tenantId);
  if (configCount > 0) {
    return jsonError(
      `Cannot delete tenant with ${configCount} configuration(s). Delete configurations first.`,
      409,
    );
  }

  // Atomic batch — sessions, users, tenant must all delete or none.
  // env.FP_DB.batch is the only way to commit multiple D1 statements
  // atomically (kysely-d1 doesn't support transactions); compileForBatch
  // lets us keep the type-safe builder.
  const db = getDb(env.FP_DB);
  await env.FP_DB.batch([
    compileForBatch(
      db
        .deleteFrom("sessions")
        .where((eb) =>
          eb(
            "user_id",
            "in",
            eb.selectFrom("users").select("id").where("tenant_id", "=", tenantId),
          ),
        ),
      env.FP_DB,
    ),
    compileForBatch(db.deleteFrom("users").where("tenant_id", "=", tenantId), env.FP_DB),
    compileForBatch(db.deleteFrom("tenants").where("id", "=", tenantId), env.FP_DB),
  ]);
  return new Response(null, { status: 204 });
}

export async function handleUpdateTenant(
  request: Request,
  env: Env,
  tenantId: string,
): Promise<Response> {
  const body = await validateJsonBody(request, updateTenantRequestSchema);
  const set: {
    name?: string;
    geo_enabled?: 0 | 1;
    updated_at: RawBuilder<string>;
  } = { updated_at: sql<string>`datetime('now')` };
  if (body.name !== undefined) set.name = body.name;
  if (body.geo_enabled !== undefined) set.geo_enabled = body.geo_enabled ? 1 : 0;

  if (Object.keys(set).length === 1) {
    const tenant = await findTenantById(env, tenantId);
    if (!tenant) return jsonError("Tenant not found", 404);
    return typedJsonResponse(tenantSchema, tenantFromRow(tenant), env);
  }

  const updated = await getDb(env.FP_DB)
    .updateTable("tenants")
    .set(set)
    .where("id", "=", tenantId)
    .returningAll()
    .executeTakeFirst();
  if (!updated) return jsonError("Tenant not found", 404);
  return typedJsonResponse(tenantSchema, tenantFromRow(updated), env);
}

// ─── Team Handler ───────────────────────────────────────────────────

export async function handleGetTeam(env: Env, tenantId: string): Promise<Response> {
  const members = await getDb(env.FP_DB)
    .selectFrom("users")
    .select(["id", "email", "display_name", "role", "created_at"])
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "asc")
    .execute();
  return Response.json({ members });
}

// ─── Overview (aggregate stats) ─────────────────────────────────────

interface AeSnapshotRow {
  tenant_id: string;
  config_id: string;
  interval: string;
  timestamp: string | number;
  agent_count: number;
  connected_count: number;
  disconnected_count: number;
  healthy_count: number;
  unhealthy_count: number;
  connected_healthy_count: number;
  config_up_to_date: number;
  config_pending: number;
  agents_with_errors: number;
  agents_stale: number;
  websocket_count: number;
  // Index signature so the row matches the AnalyticsSqlRow base shape;
  // every named column above is one of these.
  [column: string]: string | number | null;
}

/**
 * Build the Overview payload from Analytics Engine fleet metrics snapshots.
 * Overview intentionally does not fan out across Config DOs as a fallback:
 * missing metrics should be visible as unavailable/stale data, not converted
 * into a very expensive page render.
 */
export async function handleGetOverview(env: Env, tenantId: string): Promise<Response> {
  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return jsonError("Tenant not found", 404);

  const configs = await getDb(env.FP_DB)
    .selectFrom("configurations")
    .select(["id", "tenant_id", "name", "current_config_hash", "created_at", "updated_at"])
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc")
    .execute();

  let metricsSource: "analytics_engine" | "unavailable" = "unavailable";
  let metricsError: string | null = null;
  const totals = { totalAgents: 0, connectedAgents: 0, healthyAgents: 0 };
  const byConfig = new Map<string, AeSnapshotRow>();

  if (isAnalyticsSqlConfigured(env)) {
    try {
      const rows = await runAnalyticsSql<AeSnapshotRow>(env, latestSnapshotForTenant(tenantId));
      for (const row of rows) byConfig.set(row.config_id, row);
      metricsSource = "analytics_engine";
    } catch (err) {
      metricsError = err instanceof Error ? err.message : String(err);
      console.error(
        `handleGetOverview: AE snapshot read failed for tenant ${tenantId}:`,
        metricsError,
      );
    }
  }

  const configStats: ConfigurationWithStats[] = configs.map((config) => {
    const snapshot = byConfig.get(config.id);
    const stats: ConfigStats = snapshot
      ? {
          total_agents: snapshot.agent_count,
          connected_agents: snapshot.connected_count,
          healthy_agents: snapshot.healthy_count,
          active_websockets: snapshot.websocket_count,
        }
      : {
          total_agents: 0,
          connected_agents: 0,
          healthy_agents: 0,
          active_websockets: 0,
        };
    totals.totalAgents += stats.total_agents;
    totals.connectedAgents += stats.connected_agents;
    totals.healthyAgents += stats.healthy_agents;
    return { ...config, stats } as ConfigurationWithStats;
  });

  const payload: OverviewResponse = {
    tenant,
    total_agents: totals.totalAgents,
    connected_agents: totals.connectedAgents,
    healthy_agents: totals.healthyAgents,
    configs_count: configs.length,
    configurations: configStats,
    metrics_source: metricsSource,
    metrics_error: metricsError,
  };
  return typedJsonResponse(overviewResponseSchema, payload, env);
}

// ─── Sub-router ─────────────────────────────────────────────────────

export const tenantRoutes = new Hono<V1Env>();

tenantRoutes.get("/tenant", async (c) => {
  return handleGetTenant(c.env, c.get("tenantId"));
});

tenantRoutes.put("/tenant", async (c) => {
  const audit = c.get("audit");
  const tenantId = c.get("tenantId");
  return withAudit(
    audit,
    { action: "tenant.update", resource_type: "tenant", resource_id: tenantId },
    () => handleUpdateTenant(c.req.raw, c.env, tenantId),
  );
});

tenantRoutes.delete("/tenant", async (c) => {
  const audit = c.get("audit");
  const tenantId = c.get("tenantId");
  return withAudit(
    audit,
    { action: "tenant.delete", resource_type: "tenant", resource_id: tenantId },
    () => handleDeleteTenant(c.env, tenantId),
  );
});

tenantRoutes.get("/audit-logs", async (c) => {
  return handleListAuditLogs(c.env, new URL(c.req.url), c.get("tenantId"));
});

tenantRoutes.get("/team", async (c) => {
  return handleGetTeam(c.env, c.get("tenantId"));
});

tenantRoutes.get("/overview", async (c) => {
  return handleGetOverview(c.env, c.get("tenantId"));
});

tenantRoutes.post("/ai/guidance", async (c) => {
  return handleTenantGuidanceRequest(c.req.raw, c.env, c.get("tenantId"));
});

tenantRoutes.post("/ai/chat", async (c) => {
  return handleTenantChatRequest(c.req.raw, c.env, c.get("tenantId"));
});
