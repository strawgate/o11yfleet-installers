import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useOverview,
  useConfigurationAgents,
  useConfigurationStats,
  type Agent,
  type Configuration,
} from "../../api/hooks/portal";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel } from "../../components/ai";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";
import {
  agentCurrentHash,
  agentHasDrift,
  agentHost,
  agentIsHealthy,
  agentLastSeen,
  agentUid,
  hashLabel,
} from "../../utils/agents";
import { configurationAgentMetrics } from "../../utils/config-stats";
import { buildInsightRequest, insightTarget, insightSurfaces } from "../../ai/insight-registry";
import { useRegisterBrowserContext } from "../../ai/browser-context-react";
import { buildBrowserPageContext, pageDetail, pageMetric, pageTable } from "../../ai/page-context";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

const EMPTY_AGENTS: Agent[] = [];

function AgentSection({
  config,
  expanded,
  onToggle,
}: {
  config: Configuration;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const setFilterAndResetCursor = (next: string) => {
    setFilter(next);
    setCursor(undefined);
  };
  const {
    data: agentsPage,
    isLoading,
    error,
  } = useConfigurationAgents(config.id, {
    limit: 50,
    cursor,
    q: filter || undefined,
    enabled: expanded,
  });
  const agents = agentsPage?.agents ?? EMPTY_AGENTS;
  const stats = useConfigurationStats(config.stats || !expanded ? undefined : config.id);
  const statsData = config.stats ?? stats.data;
  const list = agents;
  const visible = list;
  const fallbackHash = config.current_config_hash ?? undefined;
  const agentMetrics = useMemo(
    () => configurationAgentMetrics(statsData, agents, fallbackHash),
    [agents, fallbackHash, statsData],
  );
  const desiredHash = agentMetrics.desiredConfigHash;
  const connectedCount = agentMetrics.connectedAgents;
  const healthyCount = agentMetrics.healthyAgents;
  const degradedCount = agentMetrics.degradedAgents;
  const insightSurface = insightSurfaces.portalAgent;
  const driftedCount = agentMetrics.driftedAgents;
  const hasSnapshotStats = Boolean(statsData);
  const hasDegradedStats = typeof statsData?.status_counts?.["degraded"] === "number";
  const hasDriftStats = typeof statsData?.drifted_agents === "number";
  const aggregateStatsReady = Boolean(config.stats) || (stats.isFetched && !stats.error);
  const sectionId = `agents-${config.id}`;
  const guidanceTargets = useMemo(
    () => [
      insightTarget(insightSurface, {
        key: `agents.${config.id}.section`,
        label: `${config.name} agents`,
        kind: "section",
      }),
      insightTarget(insightSurface, {
        key: `agents.${config.id}.table`,
        label: `${config.name} agent table`,
        kind: "table",
      }),
    ],
    [config.id, config.name, insightSurface],
  );
  const guidanceContext = useMemo(
    () => ({
      configuration_id: config.id,
      configuration_name: config.name,
      total_agents: agentMetrics.totalAgents,
      visible_agents: agentMetrics.visibleAgents,
      connected_agents: connectedCount,
      healthy_agents: healthyCount,
      degraded_agents: degradedCount,
      drifted_agents: driftedCount,
      agents: agents.slice(0, 12).map((agent) => ({
        id: agentUid(agent),
        hostname: agentHost(agent),
        status: agent.status ?? null,
        last_seen: agentLastSeen(agent) ?? null,
      })),
    }),
    [
      agentMetrics.totalAgents,
      agentMetrics.visibleAgents,
      agents,
      config.id,
      config.name,
      connectedCount,
      degradedCount,
      driftedCount,
      healthyCount,
    ],
  );
  const shouldRequestGuidance = hasMaterialAgentGuidanceSignal({
    totalAgents: agentMetrics.totalAgents,
    connectedAgents: connectedCount,
    degradedAgents: degradedCount,
    driftedAgents: driftedCount,
  });
  const pageContext =
    expanded && !error && agents && !isLoading && aggregateStatsReady
      ? buildBrowserPageContext({
          title: `${config.name} collectors`,
          filters: filter ? { search: filter } : undefined,
          visible_text: [
            "Status is connectivity; health is collector runtime state; drift is config hash mismatch.",
          ],
          metrics: [
            pageMetric("total_agents", "Total collectors", agentMetrics.totalAgents),
            pageMetric("visible_agents", "Visible collectors", list.length),
            pageMetric("connected_agents", "Connected collectors", connectedCount),
            pageMetric("healthy_agents", "Healthy collectors", healthyCount),
            pageMetric("degraded_agents", "Degraded collectors", degradedCount),
            pageMetric("drifted_agents", "Drifted collectors", driftedCount),
          ],
          details: [
            pageDetail("configuration_id", "Configuration ID", config.id),
            pageDetail("configuration_name", "Configuration name", config.name),
            pageDetail("desired_config_hash", "Desired config hash", desiredHash ?? null),
          ],
          tables: [
            pageTable(
              "agents",
              "Visible collectors",
              visible.map((agent) => ({
                id: agentUid(agent),
                hostname: agentHost(agent),
                status: agent.status ?? null,
                health: agentIsHealthy(agent),
                drift:
                  Number(agent.capabilities ?? 0) & 0x02
                    ? (agent.is_drifted ?? agentHasDrift(agent, desiredHash))
                    : false,
                current_hash: agentCurrentHash(agent),
                last_seen: agentLastSeen(agent) ?? null,
              })),
              { totalRows: list.length, maxRows: 20 },
            ),
          ],
        })
      : null;
  const guidanceRequest: AiGuidanceRequest | null =
    expanded &&
    shouldRequestGuidance &&
    !error &&
    agents &&
    !isLoading &&
    aggregateStatsReady &&
    pageContext
      ? buildInsightRequest(insightSurface, guidanceTargets, guidanceContext, {
          intent: "triage_state",
          pageContext,
        })
      : null;
  const browserContext = useMemo(
    () => ({
      id: `portal.agents.${config.id}`,
      title: `${config.name} collectors`,
      surface: insightSurface.surface,
      context: guidanceContext,
      targets: guidanceTargets,
      pageContext: pageContext ?? undefined,
    }),
    [config.id, config.name, guidanceContext, guidanceTargets, insightSurface.surface, pageContext],
  );
  useRegisterBrowserContext(browserContext);
  const guidance = usePortalGuidance(guidanceRequest);

  return (
    <div className="dt-card mt-6">
      <div className="dt-toolbar">
        <h3>
          {config.name}{" "}
          <span className="count">
            {expanded && list.length !== agentMetrics.totalAgents
              ? `${list.length} visible / ${agentMetrics.totalAgents} total`
              : `${agentMetrics.totalAgents} total`}
          </span>
        </h3>
        <div className="spacer" />
        {expanded ? (
          <input
            className="input"
            aria-label={`Filter agents for ${config.name}`}
            placeholder="Filter agents…"
            value={filter}
            onChange={(e) => setFilterAndResetCursor(e.target.value)}
          />
        ) : null}
        <button
          className={expanded ? "btn btn-ghost btn-sm" : "btn btn-secondary btn-sm"}
          type="button"
          aria-expanded={expanded}
          aria-controls={sectionId}
          onClick={onToggle}
        >
          {expanded ? "Hide collectors" : "View collectors"}
        </button>
      </div>

      {!expanded ? (
        <div className="agent-summary" id={sectionId}>
          <div className="agent-summary-grid" aria-label={`${config.name} collector summary`}>
            <div>
              <span className="meta">Total</span>
              <strong>{hasSnapshotStats ? agentMetrics.totalAgents.toLocaleString() : "—"}</strong>
            </div>
            <div>
              <span className="meta">Connected</span>
              <strong>{hasSnapshotStats ? connectedCount.toLocaleString() : "—"}</strong>
            </div>
            <div>
              <span className="meta">Healthy</span>
              <strong>{hasSnapshotStats ? healthyCount.toLocaleString() : "—"}</strong>
            </div>
            {hasDegradedStats ? (
              <div>
                <span className="meta">Degraded</span>
                <strong>{degradedCount.toLocaleString()}</strong>
              </div>
            ) : null}
            {hasDriftStats ? (
              <div>
                <span className="meta">Drifted</span>
                <strong>{driftedCount.toLocaleString()}</strong>
              </div>
            ) : null}
          </div>
          <p className="meta">
            {hasSnapshotStats
              ? "Summary uses the fleet metrics snapshot. Collector rows load only when you open this configuration."
              : "Metrics snapshot unavailable. Open this configuration to query its live agent page."}
          </p>
        </div>
      ) : (
        <div id={sectionId}>
          <GuidancePanel
            title={`${config.name} agents`}
            guidance={guidance.data}
            isLoading={guidance.isLoading}
            error={guidance.error}
            onRefresh={() => void guidance.refetch()}
          />
          {isLoading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorState error={error} />
          ) : (
            <>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Instance UID</th>
                    <th>Hostname</th>
                    <th>Status</th>
                    <th>Health</th>
                    <th>Config sync</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {list.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          icon="plug"
                          title={filter ? "No agents match your filter" : "No agents connected"}
                          description={
                            filter
                              ? "Clear the filter to see all collectors for this configuration."
                              : "Enroll a collector from the configuration page to start reporting status."
                          }
                        >
                          {!filter ? (
                            <Link
                              to={`/portal/configurations/${config.id}`}
                              className="btn btn-primary btn-sm"
                            >
                              Enroll agent
                            </Link>
                          ) : null}
                        </EmptyState>
                      </td>
                    </tr>
                  ) : (
                    visible.map((a) => {
                      const uid = agentUid(a);
                      const healthy = agentIsHealthy(a);
                      const hasConfigCap = Boolean(Number(a.capabilities ?? 0) & 0x02);
                      const drift = hasConfigCap
                        ? (a.is_drifted ?? agentHasDrift(a, desiredHash))
                        : false;
                      return (
                        <tr key={uid} className="clickable">
                          <td className="mono-cell">
                            <Link to={`/portal/agents/${config.id}/${uid}`}>{uid}</Link>
                          </td>
                          <td>{agentHost(a)}</td>
                          <td>
                            <span
                              className={`tag ${
                                a.status === "connected"
                                  ? "tag-ok"
                                  : a.status === "degraded"
                                    ? "tag-warn"
                                    : "tag-err"
                              }`}
                            >
                              {a.status ?? "unknown"}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`tag ${healthy === false ? "tag-err" : healthy === true ? "tag-ok" : ""}`}
                            >
                              {healthy === false
                                ? "unhealthy"
                                : healthy === true
                                  ? "healthy"
                                  : "unknown"}
                            </span>
                          </td>
                          <td>
                            <span className={`tag ${drift ? "tag-warn" : ""}`}>
                              {drift ? "drift" : agentCurrentHash(a) ? "in sync" : "not reported"}
                            </span>
                            <span className="mono-cell" style={{ marginLeft: 6 }}>
                              {hashLabel(agentCurrentHash(a))}
                            </span>
                          </td>
                          <td className="meta">{relTime(agentLastSeen(a))}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <div className="meta" style={{ padding: "12px 16px", display: "flex", gap: 12 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!cursor}
                  onClick={() => setCursor(undefined)}
                >
                  First page
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={!agentsPage?.pagination?.has_more}
                  onClick={() => setCursor(agentsPage?.pagination?.next_cursor ?? undefined)}
                >
                  Next page
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function hasMaterialAgentGuidanceSignal(input: {
  totalAgents: number;
  connectedAgents: number;
  degradedAgents: number;
  driftedAgents: number;
}): boolean {
  if (input.totalAgents < 5) return false;
  const disconnectedAgents = Math.max(input.totalAgents - input.connectedAgents, 0);
  return (
    hasMaterialShare(disconnectedAgents, input.totalAgents, 0.5) ||
    hasMaterialShare(input.degradedAgents, input.totalAgents, 0.25) ||
    hasMaterialShare(input.driftedAgents, input.totalAgents, 0.25)
  );
}

function hasMaterialShare(affected: number, total: number, ratio: number): boolean {
  return affected >= 3 && affected / Math.max(total, 1) >= ratio;
}

export default function AgentsPage() {
  const overview = useOverview();
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);

  if (overview.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;

  const cfgList = overview.data?.configurations ?? [];

  return (
    <div className="main-wide">
      <div className="page-head">
        <div>
          <h1>Collectors</h1>
          <p className="meta">
            Each row is one managed OpAMP agent identity for a running OpenTelemetry Collector.
            Status is connectivity; health is collector runtime state; drift is config hash
            mismatch.
          </p>
        </div>
      </div>

      {cfgList.length === 0 ? (
        <div className="card card-pad">
          <EmptyState
            icon="file"
            title="No configurations yet"
            description="Create a configuration first, then enroll collectors into it."
          >
            <Link to="/portal/configurations" className="btn btn-primary btn-sm">
              Create configuration
            </Link>
            <Link to="/portal/getting-started" className="btn btn-ghost btn-sm">
              Guided setup
            </Link>
          </EmptyState>
        </div>
      ) : (
        cfgList.map((c) => (
          <AgentSection
            key={c.id}
            config={c}
            expanded={expandedConfigId === c.id}
            onToggle={() => setExpandedConfigId((current) => (current === c.id ? null : c.id))}
          />
        ))
      )}
    </div>
  );
}
