import { useEffect, useMemo, useRef, useState } from "react";
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
  fetchConfigurationVersionDiff,
  fetchRolloutCohortSummary,
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
  agentHost,
  agentIsHealthy,
  agentLastSeen,
  agentUid,
  hashLabel,
} from "../../utils/agents";
import {
  buildInsightRequest,
  insightSurfaces,
  insightTarget,
  tabInsightTarget,
} from "../../ai/insight-registry";
import { useRegisterBrowserContext } from "../../ai/browser-context-react";
import {
  buildBrowserPageContext,
  includedFetch,
  pageDetail,
  pageMetric,
  pageTable,
  pageYaml,
  unavailableFetch,
} from "../../ai/page-context";
import type { AiGuidanceIntent, AiGuidanceRequest, AiLightFetch } from "@o11yfleet/core/ai";

type Tab = "agents" | "versions" | "rollout" | "yaml" | "settings";

const INSTALL_COMMAND = (token: string) =>
  `curl --proto '=https' --tlsv1.2 -fsSL https://o11yfleet-site.pages.dev/install.sh | bash -s -- --token ${token}`;

export default function ConfigurationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const config = useConfiguration(id);
  const hasConfigContent = Boolean(config.data?.["current_config_hash"]);
  const yaml = useConfigurationYaml(id, hasConfigContent);
  const [agentCursor, setAgentCursor] = useState<string | undefined>(undefined);
  const agents = useConfigurationAgents(id, { limit: 50, cursor: agentCursor });
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
  const [copilotRequest, setCopilotRequest] = useState<AiGuidanceRequest | null>(null);
  const [copilotTitle, setCopilotTitle] = useState("Configuration copilot");
  const latestCopilotRunRef = useRef(0);

  const c = config.data;
  const agentList = agents.data?.agents ?? [];
  const versionList = versions.data ?? [];
  const tokenList = tokens.data ?? [];
  const connectedAgents = stats.data?.connected_agents ?? stats.data?.agents_connected ?? 0;
  const totalAgents = stats.data?.total_agents ?? agentList.length;
  const healthyAgents = stats.data?.healthy_agents ?? 0;
  const activeWebSockets = stats.data?.active_websockets;
  const desiredHash =
    stats.data?.desired_config_hash ?? (c?.["current_config_hash"] as string | undefined) ?? null;
  // Drift and connection counts are derived from server-side aggregates so they
  // remain accurate when the agents tab paginates beyond the first page.
  const driftedAgents = stats.data?.drifted_agents ?? 0;
  const connectedCount = connectedAgents;
  const guidanceReady =
    Boolean(c) &&
    agents.isFetched &&
    versions.isFetched &&
    tokens.isFetched &&
    stats.isFetched &&
    (!hasConfigContent || yaml.isFetched);
  const insightSurface = insightSurfaces.portalConfiguration;
  const buildConfigurationPageContext = (
    options: { includeYaml?: boolean; lightFetches?: AiLightFetch[] } = {},
  ) =>
    c
      ? buildBrowserPageContext({
          title: `Configuration: ${c.name}`,
          active_tab: activeTab,
          visible_text: [
            "Configuration detail shows rollout state, collector health, version history, enrollment tokens, and YAML.",
          ],
          metrics: [
            pageMetric("total_agents", "Total collectors", totalAgents),
            pageMetric("connected_agents", "Connected collectors", connectedCount),
            pageMetric("healthy_agents", "Healthy collectors", healthyAgents),
            pageMetric("drifted_agents", "Drifted collectors", driftedAgents),
            pageMetric("versions", "Versions", versionList.length),
            pageMetric("total_active_tokens", "Active enrollment tokens", tokenList.length),
          ],
          details: [
            pageDetail("configuration_id", "Configuration ID", c.id),
            pageDetail("configuration_name", "Configuration name", c.name),
            pageDetail("status", "Status", c.status ?? null),
            pageDetail("desired_config_hash", "Desired config hash", desiredHash),
            pageDetail(
              "latest_version_created_at",
              "Latest version",
              versionList[0]?.created_at ?? null,
            ),
          ],
          tables: [
            ...(activeTab === "agents"
              ? [
                  pageTable(
                    "agents",
                    "Collectors",
                    agentList.slice(0, 20).map((agent) => ({
                      id: agentUid(agent),
                      hostname: agentHost(agent),
                      status: agent.status ?? null,
                      health: agentIsHealthy(agent),
                      drift: agentHasDrift(agent, desiredHash),
                      last_seen: agentLastSeen(agent) ?? null,
                    })),
                    { totalRows: agentList.length },
                  ),
                ]
              : []),
            ...(activeTab === "versions"
              ? [
                  pageTable(
                    "versions",
                    "Versions",
                    versionList.slice(0, 10).map((version) => ({
                      id: version.id,
                      version: version.version,
                      hash: (version["config_hash"] as string | undefined) ?? null,
                      created_at: version.created_at,
                      size_bytes: (version["size_bytes"] as number | undefined) ?? null,
                    })),
                    { totalRows: versionList.length },
                  ),
                ]
              : []),
          ],
          yaml:
            options.includeYaml && yaml.data
              ? pageYaml("Current configuration YAML", yaml.data)
              : undefined,
          light_fetches: options.lightFetches ?? [],
        })
      : null;
  const pageContext = guidanceReady && c ? buildConfigurationPageContext() : null;
  const buildConfigurationTargets = (options: { includeCopilotTargets?: boolean } = {}) => {
    const targets = [insightTarget(insightSurface, insightSurface.targets.page)];
    const addActiveTabTarget = () => {
      if (activeTab === "agents") {
        targets.push(
          insightTarget(insightSurface, insightSurface.targets.agents, {
            total_agents: totalAgents,
            connected_agents: connectedAgents,
          }),
        );
      } else if (activeTab === "versions") {
        targets.push(
          insightTarget(insightSurface, insightSurface.targets.versions, {
            versions: versionList.length,
          }),
        );
      } else if (activeTab === "rollout") {
        targets.push(
          insightTarget(insightSurface, insightSurface.targets.rollout, {
            desired_config_hash: desiredHash,
            drifted_agents: driftedAgents,
          }),
        );
      } else if (activeTab === "yaml") {
        targets.push(
          insightTarget(insightSurface, insightSurface.targets.yaml, {
            yaml_available: Boolean(yaml.data),
            yaml_truncated: yaml.data
              ? pageYaml("Current configuration YAML", yaml.data).truncated
              : false,
          }),
        );
      } else if (activeTab === "settings") {
        targets.push(
          insightTarget(insightSurface, insightSurface.targets.tokens, {
            total_active_tokens: tokenList.length,
          }),
        );
      }
    };

    if (options.includeCopilotTargets) {
      addActiveTabTarget();
    } else {
      targets.push(
        insightTarget(insightSurface, insightSurface.targets.agents, {
          total_agents: totalAgents,
          connected_agents: connectedAgents,
        }),
        insightTarget(insightSurface, insightSurface.targets.versions, {
          versions: versionList.length,
        }),
        insightTarget(insightSurface, insightSurface.targets.tokens, {
          total_active_tokens: tokenList.length,
        }),
      );
    }

    targets.push(tabInsightTarget(insightSurface, "configuration.tab", activeTab));
    return targets;
  };
  const guidanceRequest: AiGuidanceRequest | null =
    guidanceReady && c && pageContext
      ? buildInsightRequest(
          insightSurface,
          buildConfigurationTargets(),
          {
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
          {
            intent: "triage_state",
            pageContext,
          },
        )
      : null;
  const browserContext = useMemo(
    () => ({
      id: "portal.configuration.detail",
      title: c ? `Configuration: ${c.name}` : "Configuration detail",
      surface: insightSurface.surface,
      context: guidanceRequest?.context ?? {},
      targets:
        guidanceReady && c && pageContext
          ? buildConfigurationTargets({ includeCopilotTargets: true })
          : [],
      pageContext: pageContext ?? undefined,
      lightFetches:
        guidanceReady && c
          ? [
              ...(id && activeTab === "versions" && versionList.length >= 2
                ? [
                    {
                      key: "configuration.version_diff_latest_previous",
                      label: "Latest versus previous configuration version",
                      load: () => fetchConfigurationVersionDiff(id),
                    },
                  ]
                : []),
              ...(id && activeTab === "rollout"
                ? [
                    {
                      key: "configuration.rollout_cohort_summary",
                      label: "Rollout cohort summary",
                      load: () => fetchRolloutCohortSummary(id),
                    },
                  ]
                : []),
            ]
          : [],
    }),
    [
      activeTab,
      buildConfigurationTargets,
      c,
      guidanceReady,
      guidanceRequest?.context,
      id,
      insightSurface.surface,
      pageContext,
      versionList.length,
    ],
  );
  useRegisterBrowserContext(browserContext);
  const guidance = usePortalGuidance(guidanceRequest);
  const copilot = usePortalGuidance(copilotRequest, { enabled: copilotRequest !== null });
  const agentInsight = guidance.data?.items.find(
    (item) => item.target_key === "configuration.agents",
  );
  const versionInsight = guidance.data?.items.find(
    (item) => item.target_key === "configuration.versions",
  );
  const tokenInsight = guidance.data?.items.find(
    (item) => item.target_key === "configuration.tokens",
  );

  useEffect(() => {
    latestCopilotRunRef.current += 1;
    setCopilotRequest(null);
    setCopilotTitle("Configuration copilot");
  }, [activeTab]);

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
    if (!yaml.data || yaml.isLoading || yaml.error) {
      toast("Rollout failed", "YAML is loading or unavailable", "err");
      return;
    }
    try {
      await rollout.mutateAsync(yaml.data);
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

  async function runCopilot(
    title: string,
    intent: AiGuidanceIntent,
    userPrompt: string,
    lightFetchMode?: "version-diff" | "rollout-summary",
  ) {
    const runId = latestCopilotRunRef.current + 1;
    latestCopilotRunRef.current = runId;
    setCopilotRequest(null);
    setCopilotTitle("Configuration copilot");
    if (!c || !guidanceReady) {
      toast("Copilot unavailable", "Configuration context is still loading.", "err");
      return;
    }
    const lightFetches = await loadCopilotLightFetches(lightFetchMode);
    if (latestCopilotRunRef.current !== runId) return;
    const includeYaml = intent === "explain_page" || intent === "draft_config_change";
    const copilotPageContext = buildConfigurationPageContext({
      includeYaml,
      lightFetches,
    });
    if (!copilotPageContext) {
      toast("Copilot unavailable", "Configuration context is not available.", "err");
      return;
    }
    if (latestCopilotRunRef.current !== runId) return;
    setCopilotTitle(title);
    setCopilotRequest(
      buildInsightRequest(
        insightSurface,
        buildConfigurationTargets({ includeCopilotTargets: true }),
        {
          configuration_id: c.id,
          configuration_name: c.name,
          active_tab: activeTab,
          desired_config_hash: desiredHash,
          yaml_available: Boolean(yaml.data),
        },
        {
          intent,
          pageContext: copilotPageContext,
          userPrompt,
        },
      ),
    );
  }

  async function loadCopilotLightFetches(
    mode?: "version-diff" | "rollout-summary",
  ): Promise<AiLightFetch[]> {
    if (!id || !mode) return [];
    try {
      if (mode === "version-diff") {
        return [
          includedFetch(
            "configuration.version_diff_latest_previous",
            "Latest versus previous configuration version",
            await fetchConfigurationVersionDiff(id),
          ),
        ];
      }
      return [
        includedFetch(
          "configuration.rollout_cohort_summary",
          "Rollout cohort summary",
          await fetchRolloutCohortSummary(id),
        ),
      ];
    } catch (err) {
      return [
        unavailableFetch(
          mode === "version-diff"
            ? "configuration.version_diff_latest_previous"
            : "configuration.rollout_cohort_summary",
          mode === "version-diff"
            ? "Latest versus previous configuration version"
            : "Rollout cohort summary",
          err instanceof Error ? err.message : "Light fetch failed",
        ),
      ];
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
        excludeTargetKeys={[
          "configuration.agents",
          "configuration.versions",
          "configuration.tokens",
        ]}
      />
      {copilotRequest ? (
        <GuidancePanel
          title={copilotTitle}
          guidance={copilot.data}
          isLoading={copilot.isLoading}
          error={copilot.error}
          onRefresh={() => void copilot.refetch()}
        />
      ) : null}

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
                  agentList.map((a) => {
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
          <div className="meta" style={{ padding: "12px 16px", display: "flex", gap: 12 }}>
            <button
              className="btn btn-ghost btn-sm"
              disabled={!agentCursor}
              onClick={() => setAgentCursor(undefined)}
            >
              First page
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={!agents.data?.pagination?.has_more}
              onClick={() => setAgentCursor(agents.data?.pagination?.next_cursor ?? undefined)}
            >
              Next page
            </button>
          </div>
        </div>
      )}

      {activeTab === "versions" && (
        <>
          <div className="flex-row justify-between mb-4">
            <div>
              <h3>Versions</h3>
              <p className="meta mt-2">
                Compare the latest uploaded YAML against the previous immutable version.
              </p>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() =>
                void runCopilot(
                  "Version diff copilot",
                  "summarize_table",
                  "Summarize the latest configuration version diff. Use only the provided light fetch and visible version table.",
                  "version-diff",
                )
              }
              disabled={versions.isLoading || versionList.length < 2 || copilot.isLoading}
            >
              Summarize latest diff
            </button>
          </div>
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
                        <td className="mono-cell">{trunc(v.config_hash ?? v.id, 12)}</td>
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
        </>
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
            className="btn btn-secondary mt-6"
            onClick={() =>
              void runCopilot(
                "Rollout risk copilot",
                "triage_state",
                "Check rollout risk using the visible rollout state and explicit rollout cohort summary. Do not claim historical regression.",
                "rollout-summary",
              )
            }
            disabled={stats.isLoading || agents.isLoading || copilot.isLoading}
          >
            Check rollout risk
          </button>
          <button
            className="btn btn-primary mt-6"
            onClick={() => setRolloutOpen(true)}
            disabled={
              !hasConfigContent ||
              !yaml.data ||
              yaml.isLoading ||
              Boolean(yaml.error) ||
              rollout.isPending
            }
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
                  disabled={
                    !hasConfigContent ||
                    !yaml.data ||
                    yaml.isLoading ||
                    Boolean(yaml.error) ||
                    rollout.isPending
                  }
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
            <div className="actions">
              <button
                className="btn btn-secondary"
                onClick={() =>
                  void runCopilot(
                    "YAML explanation copilot",
                    "explain_page",
                    "Explain the current Collector YAML from parser-backed context. Do not suggest edits unless the safety gate allows it.",
                  )
                }
                disabled={!yaml.data || yaml.isLoading || Boolean(yaml.error) || copilot.isLoading}
              >
                Explain YAML
              </button>
              <button
                className="btn btn-secondary"
                onClick={() =>
                  void runCopilot(
                    "Draft safety copilot",
                    "draft_config_change",
                    "Check whether this YAML is safe for draft config changes. If blocked, explain the deterministic safety gate reason.",
                  )
                }
                disabled={!yaml.data || yaml.isLoading || Boolean(yaml.error) || copilot.isLoading}
              >
                Check draft safety
              </button>
              <CopyButton value={yaml.data ?? ""} label="Copy YAML" />
            </div>
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
