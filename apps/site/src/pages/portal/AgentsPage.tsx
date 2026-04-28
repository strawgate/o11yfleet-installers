import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useConfigurations,
  useConfigurationAgents,
  type Configuration,
} from "../../api/hooks/portal";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";

function AgentSection({ config }: { config: Configuration }) {
  const { data: agents, isLoading, error } = useConfigurationAgents(config.id);
  const [filter, setFilter] = useState("");

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} />;

  const list = (agents ?? []).filter(
    (a) =>
      !filter ||
      (a.hostname ?? "").toLowerCase().includes(filter.toLowerCase()) ||
      a.id.toLowerCase().includes(filter.toLowerCase()),
  );

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
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td colSpan={4} className="meta" style={{ textAlign: "center", padding: 32 }}>
                No agents connected to this configuration.
              </td>
            </tr>
          ) : (
            list.map((a) => (
              <tr key={a.id} className="clickable">
                <td className="mono-cell">
                  <Link to={`/portal/agents/${config.id}/${a.id}`}>{a.id}</Link>
                </td>
                <td>{a.hostname ?? "—"}</td>
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
                <td className="meta">{relTime(a.last_seen)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
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
        <h1>Agents</h1>
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
