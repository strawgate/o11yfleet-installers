// Health check, admin overview, settings, and Cloudflare usage endpoints

import { Hono } from "hono";
import type { Env } from "../../index.js";
import type { AdminEnv } from "./shared.js";
import { adminSettingsSchema } from "@o11yfleet/core/api";
import { typedJsonResponse } from "../../shared/responses.js";
import { isAnalyticsSqlConfigured, runAnalyticsSql } from "../../analytics-sql.js";
import { buildCloudflareUsage, cloudflareUsageRequiredEnv } from "../../cloudflare-usage.js";
import { getDb } from "../../db/client.js";
import { currentFleetSummary, currentFleetSummaryByTenant } from "@o11yfleet/core/metrics";
import { isAutoApproveEnabled } from "../../shared/email.js";

// ─── Types ──────────────────────────────────────────────────────────

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

// ─── Metric helpers (exported for tenants.ts) ───────────────────────

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

export function emptyHealthMetrics(): HealthMetrics {
  return { ...EMPTY_HEALTH_METRICS, plan_counts: {} };
}

export function numberMetric(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function timestampMetric(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

// ─── Fleet metrics ──────────────────────────────────────────────────

export async function readFleetMetricsSummary(env: Env): Promise<FleetMetricsSummary> {
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

export async function readTenantFleetSummaries(env: Env): Promise<{
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

// ─── Handlers ───────────────────────────────────────────────────────

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

async function handleGetSettings(env: Env): Promise<Response> {
  return typedJsonResponse(
    adminSettingsSchema,
    { auto_approve_signups: isAutoApproveEnabled(env) },
    env,
  );
}

// ─── Sub-router ─────────────────────────────────────────────────────

export const healthRoutes = new Hono<AdminEnv>();

healthRoutes.get("/health", async (c) => {
  return handleHealthCheck(c.env);
});

healthRoutes.get("/overview", async (c) => {
  return handleAdminOverview(c.env);
});

healthRoutes.get("/settings", async (c) => {
  return handleGetSettings(c.env);
});

healthRoutes.get("/usage", async (c) => {
  return Response.json(await buildCloudflareUsage(c.env));
});
