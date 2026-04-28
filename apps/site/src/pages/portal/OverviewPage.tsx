import { Link } from "react-router-dom";
import { useOverview, useConfigurations } from "../../api/hooks/portal";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";

export default function OverviewPage() {
  const overview = useOverview();
  const configs = useConfigurations();

  if (overview.isLoading || configs.isLoading) return <LoadingSpinner />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;
  if (configs.error)
    return <ErrorState error={configs.error} retry={() => void configs.refetch()} />;

  const ov = overview.data;
  const cfgList = configs.data ?? [];

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
  const activeRollouts = typeof ov?.active_rollouts === "number" ? ov.active_rollouts : null;

  return (
    <div className="main-wide">
      <div className="page-head">
        <h1>Overview</h1>
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
          <div className="label">Total agents</div>
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
              <th>Status</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cfgList.length === 0 ? (
              <tr>
                <td colSpan={4} className="meta" style={{ textAlign: "center", padding: 32 }}>
                  No configurations yet. <Link to="/portal/getting-started">Get started →</Link>
                </td>
              </tr>
            ) : (
              cfgList.slice(0, 5).map((c) => (
                <tr key={c.id} className="clickable" onClick={() => {}}>
                  <td className="name">
                    <Link to={`/portal/configurations/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>
                    <span className={`tag tag-${c.status === "active" ? "ok" : "warn"}`}>
                      {c.status ?? "unknown"}
                    </span>
                  </td>
                  <td className="meta">{relTime(c.updated_at)}</td>
                  <td style={{ width: 32 }}>
                    <Link to={`/portal/configurations/${c.id}`}>→</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
