import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useAdminHealth, useAdminOverview, useAdminTenantsPage } from "../../api/hooks/admin";
import { useAdminGuidance } from "../../api/hooks/ai";
import { GuidancePanel, GuidanceSlot } from "../../components/ai";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { relTime } from "../../utils/format";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import { useRegisterBrowserContext } from "../../ai/browser-context-react";
import { buildBrowserPageContext, pageMetric, pageTable } from "../../ai/page-context";
import { buildAdminAiOverviewContext } from "./ai-context-utils";
import { normalizePlanId } from "../../shared/plans";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

export default function OverviewPage() {
  const overview = useAdminOverview();
  const tenants = useAdminTenantsPage({ page: 1, limit: 25, sort: "newest" });
  const health = useAdminHealth();
  const ov = overview.data;
  const tenantList = tenants.data?.tenants ?? [];
  const tenantPagination = tenants.data?.pagination;
  const totalTenants = ov?.total_tenants ?? ov?.tenants ?? tenantList.length;
  const totalConfigs =
    ov?.total_configurations ?? (ov?.["total_configs"] as number | undefined) ?? 0;
  const totalAgents = ov?.total_agents ?? ov?.agents ?? 0;
  const healthStatus = health.data?.status ?? (ov?.["health"] as string | undefined) ?? "unknown";

  // Plan distribution
  const planCounts: Record<string, number> = {};
  for (const t of tenantList) {
    const plan = normalizePlanId(t.plan);
    planCounts[plan] = (planCounts[plan] ?? 0) + 1;
  }

  const recentTenants = [...tenantList]
    .sort((a, b) => {
      const da = a.created_at ?? "";
      const db = b.created_at ?? "";
      return db.localeCompare(da);
    })
    .slice(0, 5);
  const adminAiContext = buildAdminAiOverviewContext(tenantList, totalTenants, totalConfigs);

  const insightSurface = insightSurfaces.adminOverview;
  const pageContext =
    overview.data && tenants.data && health.data
      ? buildBrowserPageContext({
          title: "Admin overview",
          visible_text: [
            "Admin overview summarizes platform tenants, configurations, collectors, and dependency health.",
          ],
          metrics: [
            pageMetric("total_tenants", "Total tenants", totalTenants),
            pageMetric("total_configurations", "Total configurations", totalConfigs),
            pageMetric("total_agents", "Total agents", totalAgents),
            pageMetric(
              "tenants_without_configs",
              "Tenants without configurations",
              tenantList.filter((tenant) => ((tenant["config_count"] as number) ?? 0) === 0).length,
            ),
          ],
          details: [{ key: "health_status", label: "System health", value: healthStatus }],
          tables: [
            pageTable(
              "recent_tenants",
              "Recent tenants",
              recentTenants.map((tenant) => ({
                id: tenant.id,
                plan: normalizePlanId(tenant.plan),
                config_count: tenant["config_count"] ?? null,
                user_count: tenant["user_count"] ?? null,
                created_at: tenant.created_at ?? null,
              })),
              { totalRows: tenantList.length },
            ),
          ],
        })
      : null;
  const guidanceRequest: AiGuidanceRequest | null =
    overview.data && tenants.data && health.data && pageContext
      ? buildInsightRequest(
          insightSurface,
          [
            insightTarget(insightSurface, insightSurface.targets.page),
            insightTarget(insightSurface, insightSurface.targets.tenants),
            insightTarget(insightSurface, insightSurface.targets.configurations),
            insightTarget(insightSurface, insightSurface.targets.agents),
            insightTarget(insightSurface, insightSurface.targets.recentTenants),
          ],
          {
            total_tenants: totalTenants,
            total_configurations: totalConfigs,
            total_agents: totalAgents,
            health_status: healthStatus,
            plan_distribution: planCounts,
            tenants_without_configs: tenantList.filter(
              (tenant) => ((tenant["config_count"] as number) ?? 0) === 0,
            ).length,
            tenants_without_users: tenantList.filter(
              (tenant) => ((tenant["user_count"] as number) ?? 0) === 0,
            ).length,
            ...adminAiContext,
            recent_tenants: recentTenants.map((tenant) => ({
              id: tenant.id,
              name: tenant.name,
              plan: normalizePlanId(tenant.plan),
              max_configs: tenant["max_configs"] ?? null,
              max_agents_per_config: tenant["max_agents_per_config"] ?? null,
              created_at: tenant.created_at ?? null,
            })),
          },
          { intent: "triage_state", pageContext },
        )
      : null;
  const browserContext = useMemo(
    () => ({
      id: "admin.overview.page",
      title: "Admin overview",
      surface: insightSurface.surface,
      context: guidanceRequest?.context ?? {},
      targets: guidanceRequest?.targets ?? [],
      pageContext: guidanceRequest?.page_context ?? undefined,
    }),
    [
      guidanceRequest?.context,
      guidanceRequest?.page_context,
      guidanceRequest?.targets,
      insightSurface.surface,
    ],
  );
  useRegisterBrowserContext(guidanceRequest ? browserContext : null);
  const guidance = useAdminGuidance(guidanceRequest);
  const tenantInsight = guidance.data?.items.find(
    (item) => item.target_key === "admin.overview.tenants",
  );
  const configInsight = guidance.data?.items.find(
    (item) => item.target_key === "admin.overview.configs",
  );
  const agentInsight = guidance.data?.items.find(
    (item) => item.target_key === "admin.overview.agents",
  );

  if (overview.isLoading || tenants.isLoading || health.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;
  if (tenants.error)
    return <ErrorState error={tenants.error} retry={() => void tenants.refetch()} />;
  if (health.error) return <ErrorState error={health.error} retry={() => void health.refetch()} />;

  return (
    <>
      <div className="page-head">
        <h1>Admin Overview</h1>
        <div className="actions">
          <Link to="/admin/health" className="btn btn-ghost btn-sm">
            System health
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="val">{totalTenants}</div>
          <div className="label">
            {ov?.total_tenants !== undefined || ov?.tenants !== undefined
              ? "Total tenants"
              : `Tenants in page ${tenantPagination?.page ?? 1}`}
          </div>
          <GuidanceSlot item={tenantInsight} loading={guidance.isLoading} />
        </div>
        <div className="stat">
          <div className="val">{totalConfigs}</div>
          <div className="label">Total configs</div>
          <GuidanceSlot item={configInsight} loading={guidance.isLoading} />
        </div>
        <div className="stat">
          <div className="val">{totalAgents}</div>
          <div className="label">Total agents</div>
          <GuidanceSlot item={agentInsight} loading={guidance.isLoading} />
        </div>
        <div className="stat">
          <div className="val">
            <span
              className={`tag tag-${healthStatus === "healthy" || healthStatus === "ok" ? "ok" : "warn"}`}
            >
              {healthStatus}
            </span>
          </div>
          <div className="label">System health</div>
        </div>
      </div>

      <GuidancePanel
        title="Platform operations"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
        excludeTargetKeys={[
          "admin.overview.tenants",
          "admin.overview.configs",
          "admin.overview.agents",
        ]}
      />

      <div className="mt-6" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24 }}>
        {/* Recent tenants */}
        <div className="dt-card">
          <div className="dt-toolbar">
            <h3>Recent tenants</h3>
            <div className="spacer" />
            <Link to="/admin/tenants" className="btn btn-ghost btn-sm">
              View all
            </Link>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>Name</th>
                <th>Plan</th>
                <th>Policy limit</th>
                <th>Collector limit</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {recentTenants.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon="users"
                      title="No tenants yet"
                      description="Create a tenant to start configuring workspaces and enrollment policy."
                    >
                      <Link to="/admin/tenants" className="btn btn-primary btn-sm">
                        Create tenant
                      </Link>
                    </EmptyState>
                  </td>
                </tr>
              ) : (
                recentTenants.map((t) => (
                  <tr key={t.id} className="clickable">
                    <td className="name">
                      <Link to={`/admin/tenants/${t.id}`}>{t.name}</Link>
                    </td>
                    <td>
                      <PlanTag plan={t.plan ?? "starter"} />
                    </td>
                    <td>{(t["max_configs"] as number) ?? "—"}</td>
                    <td>{(t["max_agents_per_config"] as number) ?? "—"}</td>
                    <td className="meta">{relTime(t.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Plan distribution */}
        <div className="dt-card">
          <div className="dt-toolbar">
            <h3>Plan distribution</h3>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Tenants</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(planCounts).length === 0 ? (
                <tr>
                  <td colSpan={2}>
                    <EmptyState
                      icon="activity"
                      title="No plan data"
                      description="Plan distribution appears after tenants are created."
                    />
                  </td>
                </tr>
              ) : (
                Object.entries(planCounts).map(([plan, count]) => (
                  <tr key={plan}>
                    <td>
                      <PlanTag plan={plan} />
                    </td>
                    <td>{count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
