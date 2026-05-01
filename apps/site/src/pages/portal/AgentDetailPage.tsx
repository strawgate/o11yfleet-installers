import { Link, useParams } from "react-router-dom";
import { useConfiguration, useConfigurationAgent } from "../../api/hooks/portal";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";
import {
  agentCurrentHash,
  agentConnectedAt,
  agentHasDrift,
  agentHost,
  agentIsHealthy,
  agentLastSeen,
  hashLabel,
} from "../../utils/agents";

export default function AgentDetailPage() {
  const { configId, agentUid: routeAgentUid } = useParams<{
    configId: string;
    agentUid: string;
  }>();
  const config = useConfiguration(configId);
  const agentQuery = useConfigurationAgent(configId, routeAgentUid);

  if (config.isLoading || agentQuery.isLoading) return <LoadingSpinner />;
  if (config.error) return <ErrorState error={config.error} retry={() => void config.refetch()} />;
  if (agentQuery.error)
    return <ErrorState error={agentQuery.error} retry={() => void agentQuery.refetch()} />;

  const agent = agentQuery.data;
  const desiredHash = agent?.desired_config_hash ?? undefined;
  const currentHash = agent ? agentCurrentHash(agent) : undefined;
  const healthy = agent ? agentIsHealthy(agent) : null;
  const drift = agent ? agentHasDrift(agent, desiredHash) : false;

  return (
    <div className="main-wide">
      <PrototypeBanner message="Agent detail is wired to reported collector state. Pipeline/effective-config diagnostics are still planned." />

      <div className="page-head mt-6">
        <div>
          <h1>{agent ? agentHost(agent) : routeAgentUid}</h1>
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
              <td className="mono-cell">{routeAgentUid}</td>
            </tr>
            <tr>
              <td className="meta">Hostname</td>
              <td>{agent ? agentHost(agent) : "—"}</td>
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
              <td className="meta">Health</td>
              <td>
                {agent ? (
                  <span
                    className={`tag ${healthy === false ? "tag-err" : healthy === true ? "tag-ok" : ""}`}
                  >
                    {healthy === false ? "unhealthy" : healthy === true ? "healthy" : "unknown"}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
            <tr>
              <td className="meta">Config sync</td>
              <td>
                {agent ? (
                  <span className={`tag ${drift ? "tag-warn" : ""}`}>
                    {drift ? "drift" : currentHash ? "in sync" : "not reported"}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
            <tr>
              <td className="meta">Desired config hash</td>
              <td className="mono-cell">{hashLabel(desiredHash)}</td>
            </tr>
            <tr>
              <td className="meta">Current config hash</td>
              <td className="mono-cell">{hashLabel(currentHash)}</td>
            </tr>
            <tr>
              <td className="meta">Last seen</td>
              <td>{relTime(agent ? agentLastSeen(agent) : undefined)}</td>
            </tr>
            <tr>
              <td className="meta">Connected at</td>
              <td>{agent ? relTime(agentConnectedAt(agent)) : "—"}</td>
            </tr>
            <tr>
              <td className="meta">Last error</td>
              <td>{agent?.last_error ?? "—"}</td>
            </tr>
            <tr>
              <td className="meta">Capabilities</td>
              <td className="mono-cell">{agent?.capabilities ?? "—"}</td>
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
