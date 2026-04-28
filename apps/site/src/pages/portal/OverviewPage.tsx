import { Link } from "react-router-dom";
import { useOverview, useConfigurations } from "../../api/hooks/portal";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";
import { hashLabel } from "../../utils/agents";

export default function OverviewPage() {
  const overview = useOverview();
  const configs = useConfigurations();

  if (overview.isLoading || configs.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;
  if (configs.error)
    return <ErrorState error={configs.error} retry={() => void configs.refetch()} />;

  const ov = overview.data;
  const cfgList = Array.isArray(ov?.configurations) ? ov.configurations : (configs.data ?? []);

  const totalConfigs =
    typeof ov?.configs_count === "number"
      ? ov.configs_count
      : Array.isArray(ov?.configurations)
        ? ov.configurations.length
        : cfgList.length;
  const totalAgents =
    typeof ov?.total_agents === "number"
      ? ov.total_agents
      : typeof ov?.agents === "number"
        ? ov.agents
        : 0;
  const connectedAgents = typeof ov?.connected_agents === "number" ? ov.connected_agents : 0;
  const healthyAgents = typeof ov?.healthy_agents === "number" ? ov.healthy_agents : 0;
  const activeRollouts = typeof ov?.active_rollouts === "number" ? ov.active_rollouts : null;

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
        </div>
        <div className="stat">
          <div className="val">{totalAgents}</div>
          <div className="label">Total collectors</div>
        </div>
        <div className="stat">
          <div className="val">{connectedAgents}</div>
          <div className="label">Connected</div>
        </div>
        <div className="stat">
          <div className="val">{healthyAgents}</div>
          <div className="label">Healthy</div>
        </div>
        <div className="stat">
          <div className="val">{activeRollouts ?? "—"}</div>
          <div className="label">Active rollouts</div>
          {activeRollouts === null ? <div className="delta">Not exposed by API yet</div> : null}
        </div>
      </div>

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
              <th />
            </tr>
          </thead>
          <tbody>
            {cfgList.length === 0 ? (
              <tr>
                <td colSpan={5} className="meta" style={{ textAlign: "center", padding: 32 }}>
                  No configurations yet. <Link to="/portal/getting-started">Get started →</Link>
                </td>
              </tr>
            ) : (
              cfgList.slice(0, 5).map((c) => {
                const stats = c.stats;
                const desiredHash = c["current_config_hash"] as string | undefined;
                return (
                  <tr key={c.id} className="clickable" onClick={() => {}}>
                    <td className="name">
                      <Link to={`/portal/configurations/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>
                      <span className="tag">
                        {stats ? `${stats.connected ?? 0} / ${stats.total ?? 0} connected` : "—"}
                      </span>
                      {typeof stats?.healthy === "number" ? (
                        <span className="tag tag-ok" style={{ marginLeft: 6 }}>
                          {stats.healthy} healthy
                        </span>
                      ) : null}
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
