import { Link, useParams } from "react-router-dom";
import { useConfiguration, useConfigurationAgents } from "../../api/hooks/portal";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";

export default function AgentDetailPage() {
  const { configId, agentUid } = useParams<{ configId: string; agentUid: string }>();
  const config = useConfiguration(configId);
  const agents = useConfigurationAgents(configId);

  if (config.isLoading || agents.isLoading) return <LoadingSpinner />;
  if (config.error) return <ErrorState error={config.error} retry={() => void config.refetch()} />;

  const agent = (agents.data ?? []).find((a) => a.id === agentUid);

  return (
    <div className="main-wide">
      <PrototypeBanner message="Agent detail page is under development. Pipeline visualization coming soon." />

      <div className="page-head mt-6">
        <div>
          <h1>{agent?.hostname ?? agentUid}</h1>
          <p className="meta">
            Configuration:{" "}
            <Link to={`/portal/configurations/${configId}`}>{config.data?.name ?? configId}</Link>
          </p>
        </div>
      </div>

      <div className="card card-pad mt-6">
        <table className="dt">
          <tbody>
            <tr>
              <td className="meta">Instance UID</td>
              <td className="mono-cell">{agentUid}</td>
            </tr>
            <tr>
              <td className="meta">Hostname</td>
              <td>{agent?.hostname ?? "—"}</td>
            </tr>
            <tr>
              <td className="meta">Status</td>
              <td>
                {agent ? (
                  <span
                    className={`tag ${
                      agent.status === "connected"
                        ? "tag-ok"
                        : agent.status === "degraded"
                          ? "tag-warn"
                          : "tag-err"
                    }`}
                  >
                    {agent.status ?? "unknown"}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
            <tr>
              <td className="meta">Last seen</td>
              <td>{relTime(agent?.last_seen)}</td>
            </tr>
            <tr>
              <td className="meta">Configuration</td>
              <td>
                <Link to={`/portal/configurations/${configId}`}>
                  {config.data?.name ?? configId}
                </Link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
