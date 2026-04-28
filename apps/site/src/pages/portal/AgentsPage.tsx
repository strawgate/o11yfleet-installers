import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useConfigurations,
  useConfigurationAgents,
  useConfigurationStats,
  type Configuration,
} from "../../api/hooks/portal";
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

function AgentSection({ config }: { config: Configuration }) {
  const { data: agents, isLoading, error } = useConfigurationAgents(config.id);
  const stats = useConfigurationStats(config.id);
  const [filter, setFilter] = useState("");

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} />;

  const list = (agents ?? []).filter(
    (a) =>
      !filter ||
      agentHost(a).toLowerCase().includes(filter.toLowerCase()) ||
      agentUid(a).toLowerCase().includes(filter.toLowerCase()),
  );
  const visible = list.slice(0, 100);
  const desiredHash =
    stats.data?.desired_config_hash ?? (config["current_config_hash"] as string | undefined);

  return (
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
              <td colSpan={6} className="meta" style={{ textAlign: "center", padding: 32 }}>
                No collectors have enrolled into this configuration group yet.
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
          Showing first {visible.length} collectors. Add server-side pagination before rendering the
          full fleet.
        </div>
      ) : null}
    </div>
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
        <div className="card card-pad" style={{ textAlign: "center" }}>
          <p className="meta">No configurations yet.</p>
          <Link to="/portal/getting-started" className="btn btn-primary btn-sm mt-2">
            Get started
          </Link>
        </div>
      ) : (
        cfgList.map((c) => <AgentSection key={c.id} config={c} />)
      )}
    </div>
  );
}
