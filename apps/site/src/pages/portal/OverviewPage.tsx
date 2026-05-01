import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useOverview } from "../../api/hooks/portal";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel, GuidanceSlot } from "../../components/ai";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";
import { hashLabel } from "../../utils/agents";
import { configurationAgentMetrics } from "../../utils/config-stats";
import { buildInsightRequest, insightSurfaces, insightTarget } from "../../ai/insight-registry";
import { useRegisterBrowserContext } from "../../ai/browser-context-react";
import { buildBrowserPageContext, pageMetric, pageTable } from "../../ai/page-context";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

export default function OverviewPage() {
  const overview = useOverview();
  const ov = overview.data;
  const cfgList = Array.isArray(ov?.configurations) ? ov.configurations : [];
  const totalConfigs =
    typeof ov?.configs_count === "number"
      ? ov.configs_count
      : Array.isArray(ov?.configurations)
        ? ov.configurations.length
        : cfgList.length;
  const totalAgents = typeof ov?.total_agents === "number" ? ov.total_agents : 0;
  const connectedAgents = typeof ov?.connected_agents === "number" ? ov.connected_agents : 0;
  const healthyAgents = typeof ov?.healthy_agents === "number" ? ov.healthy_agents : 0;
  const activeRollouts = typeof ov?.active_rollouts === "number" ? ov.active_rollouts : null;
  const insightSurface = insightSurfaces.portalOverview;
  const pageContext = overview.data
    ? buildBrowserPageContext({
        title: "Fleet overview",
        visible_text: [
          "Collector status, health, and drift are separate signals.",
          "A collector can be connected and still report unhealthy runtime state.",
        ],
        metrics: [
          pageMetric("configs_count", "Configurations", totalConfigs),
          pageMetric("total_agents", "Total collectors", totalAgents),
          pageMetric("connected_agents", "Connected collectors", connectedAgents),
          pageMetric("healthy_agents", "Healthy collectors", healthyAgents),
          pageMetric("active_rollouts", "Active rollouts", activeRollouts),
        ],
        tables: [
          pageTable(
            "recent_configurations",
            "Recent configurations",
            cfgList.slice(0, 8).map((config) => ({
              id: config.id,
              name: config.name,
              status: config.status ?? null,
              updated_at: config.updated_at ?? null,
            })),
            { totalRows: cfgList.length },
          ),
        ],
      })
    : null;
  const guidanceRequest: AiGuidanceRequest | null =
    overview.data && pageContext
      ? buildInsightRequest(
          insightSurface,
          [
            insightTarget(insightSurface, insightSurface.targets.page),
            insightTarget(insightSurface, insightSurface.targets.configurations, {
              total_configurations: totalConfigs,
            }),
            insightTarget(insightSurface, insightSurface.targets.agents, {
              total_agents: totalAgents,
            }),
            insightTarget(insightSurface, insightSurface.targets.recentConfigurations),
          ],
          {
            configs_count: totalConfigs,
            total_agents: totalAgents,
            connected_agents: connectedAgents,
            healthy_agents: healthyAgents,
            active_rollouts: activeRollouts,
            configurations: cfgList.slice(0, 8).map((config) => ({
              id: config.id,
              name: config.name,
              status: config.status ?? null,
              updated_at: config.updated_at ?? null,
            })),
          },
          { intent: "triage_state", pageContext },
        )
      : null;
  const browserContext = useMemo(
    () => ({
      id: "portal.overview.page",
      title: "Fleet overview",
      surface: insightSurface.surface,
      context: guidanceRequest?.context ?? {},
      targets: guidanceRequest?.targets ?? [],
      pageContext: pageContext ?? undefined,
    }),
    [guidanceRequest?.context, guidanceRequest?.targets, insightSurface.surface, pageContext],
  );
  useRegisterBrowserContext(browserContext);
  const guidance = usePortalGuidance(guidanceRequest);
  const configurationInsight = guidance.data?.items.find(
    (item) => item.target_key === "overview.configurations",
  );
  const agentInsight = guidance.data?.items.find((item) => item.target_key === "overview.agents");

  if (overview.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;

  return (
    <div className="main-wide">
      <div className="page-head">
        <div>
          <h1>Fleet overview</h1>
          <p className="meta">
            Collector status, health, and drift are separate signals. A collector can be connected
            and still report unhealthy runtime state.
          </p>
        </div>
        <div className="actions">
          <Link to="/portal/getting-started" className="btn btn-primary">
            Getting started
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="val">{totalConfigs}</div>
          <div className="label">Configurations</div>
          <GuidanceSlot item={configurationInsight} loading={guidance.isLoading} />
        </div>
        <div className="stat">
          <div className="val">{totalAgents}</div>
          <div className="label">Total collectors</div>
          <GuidanceSlot item={agentInsight} loading={guidance.isLoading} />
        </div>
        <div className="stat">
          <div className="val">
            {connectedAgents > 0 ? <span className="live-dot" /> : null}
            {connectedAgents}
            <span className="denom">/{totalAgents}</span>
          </div>
          <div className="label">Connected</div>
        </div>
        <div className="stat">
          <div className="val">
            {healthyAgents}
            <span className="denom">/{totalAgents}</span>
          </div>
          <div className="label">Healthy</div>
        </div>
        <div className="stat">
          <div className="val">{activeRollouts ?? "—"}</div>
          <div className="label">Active rollouts</div>
          {activeRollouts === null ? <div className="delta">Not exposed by API yet</div> : null}
        </div>
      </div>

      <GuidancePanel
        title="Fleet snapshot"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
        excludeTargetKeys={["overview.configurations", "overview.agents"]}
      />

      <div className="dt-card mt-6">
        <div className="dt-toolbar">
          <h3>Recent configurations</h3>
          <div className="spacer" />
          <Link to="/portal/configurations" className="btn btn-ghost btn-sm">
            View all
          </Link>
        </div>
        <table className="dt">
          <thead>
            <tr>
              <th>Name</th>
              <th>Collectors</th>
              <th>Desired config</th>
              <th>Updated</th>
              <th>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {cfgList.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon="file"
                    title="No configurations yet"
                    description="Create a configuration to start managing collectors and rollouts."
                  >
                    <Link to="/portal/getting-started" className="btn btn-primary btn-sm">
                      Get started
                    </Link>
                  </EmptyState>
                </td>
              </tr>
            ) : (
              cfgList.slice(0, 5).map((c) => {
                const metrics = configurationAgentMetrics(
                  c.stats,
                  [],
                  c.current_config_hash ?? undefined,
                );
                const hasSnapshot =
                  typeof c.stats?.snapshot_at === "string" ||
                  typeof c.stats?.snapshot_at === "number";
                const healthyTagClass =
                  metrics.totalAgents === 0
                    ? "tag"
                    : metrics.healthyAgents === metrics.totalAgents
                      ? "tag tag-ok"
                      : metrics.healthyAgents > 0
                        ? "tag tag-warn"
                        : "tag tag-err";
                const desiredHash = c.current_config_hash ?? undefined;
                return (
                  <tr key={c.id}>
                    <td className="name">
                      <Link to={`/portal/configurations/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>
                      {hasSnapshot ? (
                        <>
                          <span className="tag">
                            {metrics.connectedAgents} / {metrics.totalAgents} connected
                          </span>
                          <span className={healthyTagClass} style={{ marginLeft: 6 }}>
                            {metrics.healthyAgents} healthy
                          </span>
                        </>
                      ) : (
                        <span className="tag">Snapshot unavailable</span>
                      )}
                    </td>
                    <td className="mono-cell">{hashLabel(desiredHash)}</td>
                    <td className="meta">{relTime(c.updated_at)}</td>
                    <td style={{ width: 32 }}>
                      <Link to={`/portal/configurations/${c.id}`}>→</Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
