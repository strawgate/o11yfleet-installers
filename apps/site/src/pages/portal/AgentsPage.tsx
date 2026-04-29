import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useConfigurations,
  useConfigurationAgents,
  useConfigurationStats,
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
import { buildInsightRequest, insightTarget, insightSurfaces } from "../../ai/insight-registry";
import { buildBrowserPageContext, pageDetail, pageMetric, pageTable } from "../../ai/page-context";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

function AgentSection({ config }: { config: Configuration }) {
  const { data: agents, isLoading, error } = useConfigurationAgents(config.id);
  const stats = useConfigurationStats(config.id);
  const [filter, setFilter] = useState("");
  const list = (agents ?? []).filter(
    (a) =>
      !filter ||
      agentHost(a).toLowerCase().includes(filter.toLowerCase()) ||
      agentUid(a).toLowerCase().includes(filter.toLowerCase()),
  );
  const visible = list.slice(0, 100);
  const desiredHash =
    stats.data?.desired_config_hash ?? (config["current_config_hash"] as string | undefined);
  const connectedCount = (agents ?? []).filter((agent) => agent.status === "connected").length;
  const healthyCount = (agents ?? []).filter((agent) => agentIsHealthy(agent) === true).length;
  const degradedCount = (agents ?? []).filter((agent) => agent.status === "degraded").length;
  const insightSurface = insightSurfaces.portalAgent;
  const pageContext =
    agents && !isLoading
      ? buildBrowserPageContext({
          title: `${config.name} collectors`,
          filters: filter ? { search: filter } : undefined,
          visible_text: [
            "Status is connectivity; health is collector runtime state; drift is config hash mismatch.",
          ],
          metrics: [
            pageMetric("total_agents", "Total collectors", agents.length),
            pageMetric("visible_agents", "Visible collectors", list.length),
            pageMetric("connected_agents", "Connected collectors", connectedCount),
            pageMetric("healthy_agents", "Healthy collectors", healthyCount),
            pageMetric("degraded_agents", "Degraded collectors", degradedCount),
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
                drift: agentHasDrift(agent, desiredHash),
                current_hash: agentCurrentHash(agent),
                last_seen: agentLastSeen(agent) ?? null,
              })),
              { totalRows: list.length, maxRows: 20 },
            ),
          ],
        })
      : null;
  const guidanceRequest: AiGuidanceRequest | null =
    agents && !isLoading && pageContext
      ? buildInsightRequest(
          insightSurface,
          [
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
          {
            configuration_id: config.id,
            configuration_name: config.name,
            total_agents: agents.length,
            connected_agents: connectedCount,
            healthy_agents: healthyCount,
            degraded_agents: degradedCount,
            agents: agents.slice(0, 12).map((agent) => ({
              id: agentUid(agent),
              hostname: agentHost(agent),
              status: agent.status ?? null,
              last_seen: agentLastSeen(agent) ?? null,
            })),
          },
          { intent: "triage_state", pageContext },
        )
      : null;
  const guidance = usePortalGuidance(guidanceRequest);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} />;

  return (
    <>
      <GuidancePanel
        title={`${config.name} agents`}
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
      />
      <div className="dt-card mt-6">
        <div className="dt-toolbar">
          <h3>
            {config.name} <span className="count">{list.length}</span>
          </h3>
          <div className="spacer" />
          <input
            className="input"
            placeholder="Filter agents…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
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
                const drift = agentHasDrift(a, desiredHash);
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
                        {healthy === false ? "unhealthy" : healthy === true ? "healthy" : "unknown"}
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
        {list.length > visible.length ? (
          <div className="meta" style={{ padding: "12px 16px" }}>
            Showing first {visible.length} collectors. Add server-side pagination before rendering
            the full fleet.
          </div>
        ) : null}
      </div>
    </>
  );
}

export default function AgentsPage() {
  const { data: configs, isLoading, error, refetch } = useConfigurations();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const cfgList = configs ?? [];

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
        cfgList.map((c) => <AgentSection key={c.id} config={c} />)
      )}
    </div>
  );
}
