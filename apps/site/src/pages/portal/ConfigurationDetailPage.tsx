import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  useConfiguration,
  useConfigurationYaml,
  useConfigurationAgents,
  useConfigurationVersions,
  useConfigurationTokens,
  useConfigurationStats,
  useCreateEnrollmentToken,
  useDeleteConfiguration,
  useRolloutConfig,
} from "../../api/hooks/portal";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel, GuidanceSlot } from "../../components/ai";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { CopyButton } from "../../components/common/CopyButton";
import { EmptyState } from "../../components/common/EmptyState";
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
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

type Tab = "agents" | "versions" | "rollout" | "yaml" | "settings";

const INSTALL_COMMAND = (token: string) =>
  `curl --proto '=https' --tlsv1.2 -fsSL https://o11yfleet-site.pages.dev/install.sh | bash -s -- --token ${token}`;

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
  const createEnrollmentToken = useCreateEnrollmentToken(id ?? "");
  const rollout = useRolloutConfig(id ?? "");

  const [activeTab, setActiveTab] = useState<Tab>("agents");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [rolloutOpen, setRolloutOpen] = useState(false);

  const c = config.data;
  const agentList = agents.data ?? [];
  const versionList = versions.data ?? [];
  const tokenList = tokens.data ?? [];
  const connectedAgents = stats.data?.connected_agents ?? stats.data?.agents_connected ?? 0;
  const totalAgents = stats.data?.total_agents ?? agentList.length;
  const healthyAgents = stats.data?.healthy_agents ?? 0;
  const activeWebSockets = stats.data?.active_websockets;
  const desiredHash =
    stats.data?.desired_config_hash ?? (c?.["current_config_hash"] as string | undefined) ?? null;
  const driftedAgents = agentList.filter((a) => agentHasDrift(a, desiredHash)).length;
  const connectedCount = agentList.filter((agent) => agent.status === "connected").length;
  const guidanceReady =
    Boolean(c) &&
    agents.isFetched &&
    versions.isFetched &&
    tokens.isFetched &&
    stats.isFetched &&
    yaml.isFetched;
  const guidanceRequest: AiGuidanceRequest | null =
    guidanceReady && c
      ? {
          surface: "portal.configuration",
          targets: [
            {
              key: "configuration.page",
              label: "Configuration detail",
              surface: "portal.configuration",
              kind: "page",
            },
            {
              key: "configuration.agents",
              label: "Agents metric",
              surface: "portal.configuration",
              kind: "metric",
              context: { total_agents: totalAgents, connected_agents: connectedAgents },
            },
            {
              key: "configuration.versions",
              label: "Versions metric",
              surface: "portal.configuration",
              kind: "metric",
              context: { versions: versionList.length },
            },
            {
              key: "configuration.tokens",
              label: "Enrollment tokens metric",
              surface: "portal.configuration",
              kind: "metric",
              context: { total_active_tokens: tokenList.length },
            },
            {
              key: `configuration.tab.${activeTab}`,
              label: `${activeTab} tab`,
              surface: "portal.configuration",
              kind: "section",
            },
          ],
          context: {
            configuration_id: c.id,
            configuration_name: c.name,
            status: c.status ?? null,
            active_tab: activeTab,
            total_agents: totalAgents,
            connected_agents: connectedCount,
            agents_connected: connectedAgents,
            healthy_agents: healthyAgents,
            drifted_agents: driftedAgents,
            active_websockets: activeWebSockets ?? null,
            desired_config_hash: desiredHash,
            versions: versionList.length,
            total_active_tokens: tokenList.length,
            latest_version_created_at: versionList[0]?.created_at ?? null,
            yaml_available: Boolean(yaml.data),
          },
        }
      : null;
  const guidance = usePortalGuidance(guidanceRequest);
  const agentInsight = guidance.data?.items.find(
    (item) => item.target_key === "configuration.agents",
  );
  const versionInsight = guidance.data?.items.find(
    (item) => item.target_key === "configuration.versions",
  );
  const tokenInsight = guidance.data?.items.find(
    (item) => item.target_key === "configuration.tokens",
  );

  if (config.isLoading) return <LoadingSpinner />;
  if (config.error) return <ErrorState error={config.error} retry={() => void config.refetch()} />;

  if (!c) return <ErrorState error={new Error("Configuration not found")} />;

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

  async function handleCreateEnrollmentToken() {
    try {
      const result = await createEnrollmentToken.mutateAsync({ name: "configuration-enrollment" });
      setEnrollmentToken(result.token ?? null);
      if (result.token) {
        toast("Enrollment token created", c!.name);
      }
    } catch (err) {
      toast("Failed to create token", err instanceof Error ? err.message : "Unknown error", "err");
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
          <button className="btn btn-primary" onClick={() => setEnrollOpen(true)}>
            Enroll agent
          </button>
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
          <GuidanceSlot item={agentInsight} loading={guidance.isLoading} />
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
        <div className="stat">
          <div className="val">{versionList.length}</div>
          <div className="label">Versions</div>
          <GuidanceSlot item={versionInsight} loading={guidance.isLoading} />
        </div>
        <div className="stat">
          <div className="val">{tokenList.length}</div>
          <div className="label">Tokens</div>
          <GuidanceSlot item={tokenInsight} loading={guidance.isLoading} />
        </div>
      </div>

      <GuidancePanel
        title="Configuration guidance"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
      />

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
                    <td colSpan={6}>
                      <EmptyState
                        icon="plug"
                        title="No agents connected"
                        description="Create an enrollment token and run the installer on a host to attach a collector to this configuration."
                      >
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setEnrollOpen(true)}
                        >
                          Enroll agent
                        </button>
                      </EmptyState>
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
                    <td colSpan={4}>
                      <EmptyState
                        icon="file"
                        title="No versions yet"
                        description="Upload or roll out a configuration to create the first version."
                      />
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
        open={enrollOpen}
        onClose={() => {
          setEnrollOpen(false);
          setEnrollmentToken(null);
        }}
        title="Enroll agent"
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setEnrollOpen(false);
                setEnrollmentToken(null);
              }}
            >
              Close
            </button>
            {!enrollmentToken ? (
              <button
                className="btn btn-primary"
                onClick={() => void handleCreateEnrollmentToken()}
                disabled={createEnrollmentToken.isPending}
              >
                {createEnrollmentToken.isPending ? "Creating…" : "Create enrollment token"}
              </button>
            ) : null}
          </>
        }
      >
        {enrollmentToken ? (
          <div className="command-panel">
            <div className="banner info">
              <div>
                <div className="b-title">Enrollment token created</div>
                <div className="b-body">
                  This token will not be shown again. Copy it now or use the install command below.
                  <div className="flex-row gap-sm mt-2">
                    <code className="mono-cell token-value">{enrollmentToken}</code>
                    <CopyButton value={enrollmentToken} />
                  </div>
                </div>
              </div>
            </div>
            <pre className="code-block code-block-wrap">{INSTALL_COMMAND(enrollmentToken)}</pre>
            <CopyButton value={INSTALL_COMMAND(enrollmentToken)} label="Copy command" />
            <Link to="/portal/getting-started" className="btn btn-ghost btn-sm">
              Open guided setup
            </Link>
          </div>
        ) : (
          <EmptyState
            icon="plug"
            title="Connect a collector"
            description="Create a one-time enrollment token for this configuration, then run the installer on the host you want to manage."
          />
        )}
      </Modal>

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
