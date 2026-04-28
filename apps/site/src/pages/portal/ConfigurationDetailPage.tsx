import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  useConfiguration,
  useConfigurationYaml,
  useConfigurationAgents,
  useConfigurationVersions,
  useConfigurationStats,
  useDeleteConfiguration,
  useRolloutConfig,
} from "../../api/hooks/portal";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { CopyButton } from "../../components/common/CopyButton";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime, trunc } from "../../utils/format";
import {
  agentCurrentHash,
  agentHasDrift,
  agentIsHealthy,
  agentLastSeen,
  agentUid,
  hashLabel,
} from "../../utils/agents";

type Tab = "agents" | "versions" | "rollout" | "yaml" | "settings";

export default function ConfigurationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const config = useConfiguration(id);
  const yaml = useConfigurationYaml(id);
  const agents = useConfigurationAgents(id);
  const versions = useConfigurationVersions(id);
  const stats = useConfigurationStats(id);
  const deleteConfig = useDeleteConfiguration();
  const rollout = useRolloutConfig(id ?? "");

  const [activeTab, setActiveTab] = useState<Tab>("agents");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [rolloutOpen, setRolloutOpen] = useState(false);

  if (config.isLoading) return <LoadingSpinner />;
  if (config.error) return <ErrorState error={config.error} retry={() => void config.refetch()} />;

  const c = config.data;
  if (!c) return <ErrorState error={new Error("Configuration not found")} />;

  const agentList = agents.data ?? [];
  const versionList = versions.data ?? [];
  const connectedAgents = stats.data?.connected_agents ?? stats.data?.agents_connected ?? 0;
  const totalAgents = stats.data?.total_agents ?? agentList.length;
  const healthyAgents = stats.data?.healthy_agents ?? 0;
  const activeWebSockets = stats.data?.active_websockets;
  const desiredHash =
    stats.data?.desired_config_hash ?? (c["current_config_hash"] as string | undefined) ?? null;
  const driftedAgents = agentList.filter((a) => agentHasDrift(a, desiredHash)).length;

  async function handleDelete() {
    try {
      await deleteConfig.mutateAsync(id!);
      toast("Configuration deleted", c!.name);
      navigate("/portal/configurations");
    } catch (err) {
      toast("Delete failed", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  async function handleRollout() {
    try {
      await rollout.mutateAsync(yaml.data ?? "");
      toast("Rollout initiated", c!.name);
      setRolloutOpen(false);
    } catch (err) {
      toast("Rollout failed", err instanceof Error ? err.message : "Unknown error", "err");
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "agents", label: "Agents" },
    { key: "versions", label: "Versions" },
    { key: "rollout", label: "Rollout" },
    { key: "yaml", label: "YAML" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="main-wide">
      <div className="page-head">
        <div>
          <h1>{c.name}</h1>
          {(c["description"] as string | undefined) && (
            <p className="meta">{c["description"] as string}</p>
          )}
          <p className="meta">
            Configuration group: desired config for collectors enrolled into this assignment
            boundary.
          </p>
        </div>
        <div className="actions">
          <span className={`tag tag-${c.status === "active" ? "ok" : "warn"}`}>
            {c.status ?? "unknown"}
          </span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stat-grid">
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
          <div className="val">{driftedAgents}</div>
          <div className="label">Drifted</div>
        </div>
        <div className="stat">
          <div className="val">{activeWebSockets ?? "—"}</div>
          <div className="label">Active WebSockets</div>
        </div>
        <div className="stat">
          <div className="val mono-cell">{hashLabel(desiredHash)}</div>
          <div className="label">Desired config</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs mt-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab${activeTab === t.key ? " active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === "agents" && (
        <div className="dt-card">
          {agents.isLoading ? (
            <LoadingSpinner />
          ) : (
            <table className="dt">
              <thead>
                <tr>
                  <th>Instance UID</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>Config sync</th>
                  <th>Current hash</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {agentList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="meta" style={{ textAlign: "center", padding: 32 }}>
                      No collectors have enrolled into this configuration group yet.
                    </td>
                  </tr>
                ) : (
                  agentList.slice(0, 100).map((a) => {
                    const uid = agentUid(a);
                    const healthy = agentIsHealthy(a);
                    const drift = agentHasDrift(a, desiredHash);
                    return (
                      <tr key={uid} className="clickable">
                        <td className="mono-cell">
                          <Link to={`/portal/agents/${id}/${uid}`}>{uid}</Link>
                        </td>
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
                        </td>
                        <td className="mono-cell">{hashLabel(agentCurrentHash(a))}</td>
                        <td className="meta">{relTime(agentLastSeen(a))}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
          {agentList.length > 100 ? (
            <div className="meta" style={{ padding: "12px 16px" }}>
              Showing first 100 collectors. Add server-side pagination before rendering the full
              fleet.
            </div>
          ) : null}
        </div>
      )}

      {activeTab === "versions" && (
        <div className="dt-card">
          {versions.isLoading ? (
            <LoadingSpinner />
          ) : (
            <table className="dt">
              <thead>
                <tr>
                  <th>Config hash</th>
                  <th>Version</th>
                  <th>Created</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {versionList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="meta" style={{ textAlign: "center", padding: 32 }}>
                      No versions yet.
                    </td>
                  </tr>
                ) : (
                  versionList.map((v, i) => (
                    <tr key={v.id}>
                      <td className="mono-cell">{trunc(v.id, 12)}</td>
                      <td>{v.version}</td>
                      <td className="meta">{relTime(v.created_at)}</td>
                      <td>
                        {i === 0 ? (
                          <span className="tag tag-ok">current</span>
                        ) : (
                          <span className="tag">previous</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "rollout" && (
        <div className="card card-pad">
          <h3>Rollout configuration</h3>
          <p className="meta mt-2">
            Rollout promotes the current version to desired config for this configuration group.
            Collectors are in sync once their reported current hash matches desired.
          </p>
          <div className="banner info mt-6">
            <div>
              <div className="b-title">Rollout guardrails to wire next</div>
              <div className="b-body">
                Track actor, reason, selected version, connected target count, drift, failed apply,
                and rollback candidate before making this a full rollout history view.
              </div>
            </div>
          </div>
          <button
            className="btn btn-primary mt-6"
            onClick={() => setRolloutOpen(true)}
            disabled={rollout.isPending}
          >
            {rollout.isPending ? "Rolling out…" : "Start rollout"}
          </button>

          <Modal
            open={rolloutOpen}
            onClose={() => setRolloutOpen(false)}
            title="Confirm rollout"
            footer={
              <>
                <button className="btn btn-secondary" onClick={() => setRolloutOpen(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void handleRollout()}
                  disabled={rollout.isPending}
                >
                  {rollout.isPending ? "Rolling out…" : "Roll out now"}
                </button>
              </>
            }
          >
            <p>
              This will set the current YAML as desired config for{" "}
              <strong>{connectedAgents}</strong> connected collector
              {connectedAgents !== 1 ? "s" : ""}.
            </p>
          </Modal>
        </div>
      )}

      {activeTab === "yaml" && (
        <div className="card card-pad">
          <div className="flex-row justify-between mb-6">
            <div>
              <h3>Desired YAML</h3>
              <p className="meta mt-2">
                Effective config is what a collector actually runs after local bootstrap and remote
                config behavior; this page currently shows desired YAML from the control plane.
              </p>
            </div>
            <CopyButton value={yaml.data ?? ""} label="Copy YAML" />
          </div>
          {yaml.isLoading ? (
            <LoadingSpinner />
          ) : (
            <pre className="code-block">{yaml.data ?? "# No YAML available"}</pre>
          )}
        </div>
      )}

      {activeTab === "settings" && (
        <div>
          <div className="card card-pad">
            <h3>Details</h3>
            <table className="dt mt-2">
              <tbody>
                <tr>
                  <td className="meta">ID</td>
                  <td className="mono-cell">{c.id}</td>
                </tr>
                <tr>
                  <td className="meta">Name</td>
                  <td>{c.name}</td>
                </tr>
                <tr>
                  <td className="meta">Created</td>
                  <td>{relTime(c.created_at)}</td>
                </tr>
                <tr>
                  <td className="meta">Updated</td>
                  <td>{relTime(c.updated_at)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="danger-zone mt-6">
            <div className="dz-head">Danger zone</div>
            <div className="row">
              <div className="desc">
                <strong>Delete this configuration</strong>
                <p className="meta">
                  This will permanently delete the configuration and disconnect all collectors.
                </p>
              </div>
              <button className="btn btn-danger" onClick={() => setDeleteOpen(true)}>
                Delete configuration
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      <Modal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setConfirmName("");
        }}
        title="Delete configuration"
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setDeleteOpen(false);
                setConfirmName("");
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => void handleDelete()}
              disabled={confirmName !== c.name || deleteConfig.isPending}
            >
              {deleteConfig.isPending ? "Deleting…" : "Delete"}
            </button>
          </>
        }
      >
        <p>
          Type <strong>{c.name}</strong> to confirm deletion.
        </p>
        <input
          className="input mt-2"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={c.name}
          autoFocus
        />
      </Modal>
    </div>
  );
}
