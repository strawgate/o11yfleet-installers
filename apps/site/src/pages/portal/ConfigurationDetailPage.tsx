import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  useConfiguration,
  useConfigurationYaml,
  useConfigurationAgents,
  useConfigurationVersions,
  useConfigurationTokens,
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

type Tab = "agents" | "versions" | "rollout" | "yaml" | "settings";

export default function ConfigurationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const config = useConfiguration(id);
  const yaml = useConfigurationYaml(id);
  const agents = useConfigurationAgents(id);
  const versions = useConfigurationVersions(id);
  const tokens = useConfigurationTokens(id);
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
  const tokenList = tokens.data ?? [];
  const agentCount = stats.data?.agents_connected ?? agentList.length;

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
          <div className="val">{agentCount}</div>
          <div className="label">Agents</div>
        </div>
        <div className="stat">
          <div className="val">{versionList.length}</div>
          <div className="label">Versions</div>
        </div>
        <div className="stat">
          <div className="val">{tokenList.length}</div>
          <div className="label">Tokens</div>
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
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {agentList.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="meta" style={{ textAlign: "center", padding: 32 }}>
                      No agents connected yet.
                    </td>
                  </tr>
                ) : (
                  agentList.map((a) => (
                    <tr key={a.id} className="clickable">
                      <td className="mono-cell">
                        <Link to={`/portal/agents/${id}/${a.id}`}>{a.id}</Link>
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
                      <td className="meta">{relTime(a.last_seen)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
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
          <p className="meta mt-2">Push the current YAML configuration to all connected agents.</p>
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
              This will push the current configuration to <strong>{agentCount}</strong> connected
              agent{agentCount !== 1 ? "s" : ""}.
            </p>
          </Modal>
        </div>
      )}

      {activeTab === "yaml" && (
        <div className="card card-pad">
          <div className="flex-row justify-between mb-6">
            <h3>Effective YAML</h3>
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
                  This will permanently delete the configuration and disconnect all agents.
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
