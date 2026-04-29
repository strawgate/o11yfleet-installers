import { Link } from "react-router-dom";
import { useAdminOverview, useAdminTenants } from "../../api/hooks/admin";
import { useAdminGuidance } from "../../api/hooks/ai";
import { GuidancePanel, GuidanceSlot } from "../../components/ai";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";
import { relTime } from "../../utils/format";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

export default function OverviewPage() {
  const overview = useAdminOverview();
  const tenants = useAdminTenants();
  const ov = overview.data;
  const tenantList = tenants.data ?? [];
  const totalTenants = ov?.tenants ?? tenantList.length;
  const totalConfigs = (ov?.["total_configs"] as number) ?? 0;
  const totalAgents = ov?.agents ?? 0;
  const healthStatus = (ov?.["health"] as string) ?? "ok";

  // Plan distribution
  const planCounts: Record<string, number> = {};
  for (const t of tenantList) {
    const plan = t.plan ?? "free";
    planCounts[plan] = (planCounts[plan] ?? 0) + 1;
  }

  const recentTenants = [...tenantList]
    .sort((a, b) => {
      const da = a.created_at ?? "";
      const db = b.created_at ?? "";
      return db.localeCompare(da);
    })
    .slice(0, 5);

  const insightSurface = insightSurfaces.adminOverview;
  const guidanceRequest: AiGuidanceRequest | null =
    overview.data && tenants.data
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
            recent_tenants: recentTenants.map((tenant) => ({
              id: tenant.id,
              name: tenant.name,
              plan: tenant.plan ?? "free",
              max_configs: tenant["max_configs"] ?? null,
              max_agents_per_config: tenant["max_agents_per_config"] ?? null,
              created_at: tenant.created_at ?? null,
            })),
          },
        )
      : null;
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

  if (overview.isLoading || tenants.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;
  if (tenants.error)
    return <ErrorState error={tenants.error} retry={() => void tenants.refetch()} />;

  return (
    <>
      <div className="page-head">
        <h1>Admin Overview</h1>
        <div className="actions">
          <Link to="/admin/events" className="btn btn-ghost btn-sm">
            Audit events
          </Link>
          <Link to="/admin/health" className="btn btn-ghost btn-sm">
            System health
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="val">{totalTenants}</div>
          <div className="label">Total tenants</div>
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
                <th>Config limit</th>
                <th>Agent limit / config</th>
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
                      <PlanTag plan={t.plan ?? "free"} />
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
