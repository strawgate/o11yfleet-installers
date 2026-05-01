import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type Agent,
  type ConfigVersion,
  type EnrollmentToken,
} from "../../api/hooks/portal";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel, GuidanceSlot } from "../../components/ai";
import { useToast } from "../../components/common/Toast";
import { Modal } from "../../components/common/Modal";
import { CopyButton } from "../../components/common/CopyButton";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { EnrollmentDialogBody, enrollmentTokenFailureMessage } from "./EnrollmentDialogBody";
import { relTime, trunc } from "../../utils/format";
import { agentHost, agentLastSeen, agentUid, hashLabel } from "../../utils/agents";
import { configurationAgentMetrics } from "../../utils/config-stats";
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
import {
  DataTable,
  EmptyState,
  MetricCard,
  PageHeader,
  PageShell,
  StatusBadge,
  type ColumnDef,
} from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agentConnectionTone, agentHealthView, agentSyncView } from "./agent-view-model";
import type { AiGuidanceIntent, AiGuidanceRequest, AiLightFetch } from "@o11yfleet/core/ai";

type Tab = "agents" | "versions" | "rollout" | "yaml" | "settings";

const EMPTY_AGENTS: Agent[] = [];
const EMPTY_VERSIONS: ConfigVersion[] = [];
const EMPTY_TOKENS: EnrollmentToken[] = [];

export default function ConfigurationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const config = useConfiguration(id);
  const hasConfigContent = Boolean(config.data?.current_config_hash);
  const yaml = useConfigurationYaml(id, hasConfigContent);
  const [agentCursor, setAgentCursor] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<Tab>("agents");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);
  const [enrollmentTokenError, setEnrollmentTokenError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [rolloutOpen, setRolloutOpen] = useState(false);
  const [copilotRequest, setCopilotRequest] = useState<AiGuidanceRequest | null>(null);
  const [copilotTitle, setCopilotTitle] = useState("Configuration copilot");
  const latestCopilotRunRef = useRef(0);
  const agents = useConfigurationAgents(id, {
    limit: 50,
    cursor: agentCursor,
    enabled: activeTab === "agents",
  });
  const versions = useConfigurationVersions(id);
  const tokens = useConfigurationTokens(id);
  const stats = useConfigurationStats(id);
  const deleteConfig = useDeleteConfiguration();
  const createEnrollmentToken = useCreateEnrollmentToken(id ?? "");
  const rollout = useRolloutConfig(id ?? "");

  const c = config.data;
  const agentList = agents.data?.agents ?? EMPTY_AGENTS;
  const versionList = versions.data ?? EMPTY_VERSIONS;
  const tokenList = tokens.data ?? EMPTY_TOKENS;
  const agentMetrics = useMemo(
    () => configurationAgentMetrics(stats.data, agentList, c?.current_config_hash ?? undefined),
    [agentList, c?.current_config_hash, stats.data],
  );
  const connectedAgents = agentMetrics.connectedAgents;
  const totalAgents = agentMetrics.totalAgents;
  const healthyAgents = agentMetrics.healthyAgents;
  const activeWebSockets = agentMetrics.activeWebSockets;
  const desiredHash = agentMetrics.desiredConfigHash;
  // Drift and connection counts are derived from server-side aggregates when
  // available so they remain accurate beyond the first paginated agents page.
  const driftedAgents = agentMetrics.driftedAgents;
  const agentColumns = useMemo(() => configurationAgentColumns(id, desiredHash), [desiredHash, id]);
  const guidanceReady =
    Boolean(c) &&
    (activeTab !== "agents" || agents.isFetched) &&
    versions.isFetched &&
    tokens.isFetched &&
    stats.isFetched &&
    (!hasConfigContent || yaml.isFetched);
  const insightSurface = insightSurfaces.portalConfiguration;
  const buildConfigurationPageContext = useCallback(
    (options: { includeYaml?: boolean; lightFetches?: AiLightFetch[] } = {}) =>
      c
        ? buildBrowserPageContext({
            title: `Configuration: ${c.name}`,
            active_tab: activeTab,
            visible_text: [
              "Configuration detail shows rollout state, collector health, version history, enrollment tokens, and YAML.",
            ],
            metrics: [
              pageMetric("total_agents", "Total collectors", totalAgents),
              pageMetric("connected_agents", "Connected collectors", connectedAgents),
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
                        health: agentHealthView(agent).label,
                        config_sync: agentSyncView(agent, desiredHash).label,
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
        : null,
    [
      activeTab,
      agentList,
      c,
      connectedAgents,
      desiredHash,
      driftedAgents,
      healthyAgents,
      tokenList.length,
      totalAgents,
      versionList,
      yaml.data,
    ],
  );
  const pageContext = useMemo(
    () => (guidanceReady && c ? buildConfigurationPageContext() : null),
    [buildConfigurationPageContext, c, guidanceReady],
  );
  const buildConfigurationTargets = useCallback(
    (options: { includeCopilotTargets?: boolean } = {}) => {
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
    },
    [
      activeTab,
      connectedAgents,
      desiredHash,
      driftedAgents,
      insightSurface,
      tokenList.length,
      totalAgents,
      versionList.length,
      yaml.data,
    ],
  );
  const guidanceContext = useMemo(
    () => ({
      configuration_id: c?.id ?? null,
      configuration_name: c?.name ?? null,
      status: c?.status ?? null,
      active_tab: activeTab,
      total_agents: totalAgents,
      connected_agents: connectedAgents,
      healthy_agents: healthyAgents,
      drifted_agents: driftedAgents,
      active_websockets: activeWebSockets ?? null,
      desired_config_hash: desiredHash,
      versions: versionList.length,
      total_active_tokens: tokenList.length,
      latest_version_created_at: versionList[0]?.created_at ?? null,
      yaml_available: Boolean(yaml.data),
    }),
    [
      activeTab,
      activeWebSockets,
      c?.id,
      c?.name,
      c?.status,
      connectedAgents,
      desiredHash,
      driftedAgents,
      healthyAgents,
      tokenList.length,
      totalAgents,
      versionList,
      yaml.data,
    ],
  );
  const guidanceTargets = useMemo(() => buildConfigurationTargets(), [buildConfigurationTargets]);
  const browserTargets = useMemo(
    () =>
      guidanceReady && c && pageContext
        ? buildConfigurationTargets({ includeCopilotTargets: true })
        : [],
    [buildConfigurationTargets, c, guidanceReady, pageContext],
  );
  const guidanceRequest: AiGuidanceRequest | null = useMemo(
    () =>
      guidanceReady && c && pageContext
        ? buildInsightRequest(insightSurface, guidanceTargets, guidanceContext, {
            intent: "triage_state",
            pageContext,
          })
        : null,
    [c, guidanceContext, guidanceReady, guidanceTargets, insightSurface, pageContext],
  );
  const browserLightFetches = useMemo(
    () =>
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
    [activeTab, c, guidanceReady, id, versionList.length],
  );
  const browserContext = useMemo(
    () => ({
      id: "portal.configuration.detail",
      title: c ? `Configuration: ${c.name}` : "Configuration detail",
      surface: insightSurface.surface,
      context: guidanceRequest?.context ?? guidanceContext,
      targets: browserTargets,
      pageContext: pageContext ?? undefined,
      lightFetches: browserLightFetches,
    }),
    [
      browserLightFetches,
      browserTargets,
      c,
      guidanceContext,
      guidanceRequest?.context,
      insightSurface.surface,
      pageContext,
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
      void navigate("/portal/configurations");
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
    setEnrollmentTokenError(null);
    try {
      const result = await createEnrollmentToken.mutateAsync({ name: "configuration-enrollment" });
      if (!result.token) {
        const message = "The server did not return an enrollment token.";
        setEnrollmentToken(null);
        setEnrollmentTokenError(message);
        toast("Failed to create token", message, "err");
        return;
      }
      setEnrollmentToken(result.token);
      toast("Enrollment token created", c!.name);
    } catch (err) {
      const message = enrollmentTokenFailureMessage(err);
      setEnrollmentToken(null);
      setEnrollmentTokenError(message);
      toast("Failed to create token", message, "err");
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
    <PageShell width="wide">
      <PageHeader
        title={c.name}
        description={
          <>
            {(c["description"] as string | undefined) ? (
              <span className="block">{c["description"] as string}</span>
            ) : null}
            <span>
              Configuration group: desired config for collectors enrolled into this assignment
              boundary.
            </span>
          </>
        }
        actions={
          <>
            <Button
              onClick={() => {
                setEnrollmentToken(null);
                setEnrollmentTokenError(null);
                setEnrollOpen(true);
              }}
            >
              Enroll agent
            </Button>
            <StatusBadge tone={c.status === "active" ? "ok" : "warn"}>
              {c.status ?? "unknown"}
            </StatusBadge>
          </>
        }
      />

      {/* Stat cards */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <MetricCard label="Total collectors" value={totalAgents.toLocaleString()}>
          <GuidanceSlot item={agentInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard
          label="Connected"
          value={`${connectedAgents.toLocaleString()} / ${totalAgents.toLocaleString()}`}
          tone={connectedAgents === totalAgents && totalAgents > 0 ? "ok" : "neutral"}
        />
        <MetricCard
          label="Healthy"
          value={`${healthyAgents.toLocaleString()} / ${totalAgents.toLocaleString()}`}
          tone={healthyAgents === totalAgents && totalAgents > 0 ? "ok" : "neutral"}
        />
        <MetricCard
          label="Drifted"
          value={driftedAgents.toLocaleString()}
          tone={driftedAgents > 0 ? "warn" : "neutral"}
        />
        <MetricCard
          label="Active WebSockets"
          value={activeWebSockets ?? "—"}
          tone={typeof activeWebSockets === "number" && activeWebSockets > 0 ? "ok" : "neutral"}
        />
        <MetricCard label="Desired config" value={hashLabel(desiredHash)} />
        <MetricCard label="Versions" value={versionList.length.toLocaleString()}>
          <GuidanceSlot item={versionInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard label="Tokens" value={tokenList.length.toLocaleString()}>
          <GuidanceSlot item={tokenInsight} loading={guidance.isLoading} />
        </MetricCard>
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
      <div
        className="mt-6 flex flex-wrap gap-2 border-b border-border"
        role="tablist"
        aria-label="Configuration sections"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            aria-controls={`configuration-tab-${t.key}`}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === "agents" && (
        <div id="configuration-tab-agents" role="tabpanel" className="mt-6">
          {agents.isLoading ? (
            <LoadingSpinner />
          ) : (
            <DataTable
              title="Collectors"
              columns={agentColumns}
              data={agentList}
              getRowId={(agent) => agentUid(agent)}
              emptyState={
                <EmptyState
                  icon="plug"
                  title="No agents connected"
                  description="Create an enrollment token and run the installer on a host to attach a collector to this configuration."
                >
                  <Button
                    size="sm"
                    onClick={() => {
                      setEnrollmentToken(null);
                      setEnrollmentTokenError(null);
                      setEnrollOpen(true);
                    }}
                  >
                    Enroll agent
                  </Button>
                </EmptyState>
              }
            />
          )}
          <div className="flex flex-wrap items-center gap-2 border-x border-b border-border px-4 py-3 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="sm"
              disabled={!agentCursor}
              onClick={() => setAgentCursor(undefined)}
            >
              First page
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!agents.data?.pagination?.has_more}
              onClick={() => setAgentCursor(agents.data?.pagination?.next_cursor ?? undefined)}
            >
              Next page
            </Button>
          </div>
        </div>
      )}

      {activeTab === "versions" && (
        <div id="configuration-tab-versions" role="tabpanel" className="mt-6">
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
        </div>
      )}

      {activeTab === "rollout" && (
        <div id="configuration-tab-rollout" role="tabpanel" className="card card-pad mt-6">
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
        <div id="configuration-tab-yaml" role="tabpanel" className="card card-pad mt-6">
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
        <div id="configuration-tab-settings" role="tabpanel" className="mt-6">
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

      {/* Enrollment modal */}
      <Modal
        open={enrollOpen}
        onClose={() => {
          setEnrollOpen(false);
          setEnrollmentToken(null);
          setEnrollmentTokenError(null);
        }}
        title="Enroll agent"
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setEnrollOpen(false);
                setEnrollmentToken(null);
                setEnrollmentTokenError(null);
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
        <EnrollmentDialogBody
          enrollmentToken={enrollmentToken}
          enrollmentTokenError={enrollmentTokenError}
        />
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
        <Input
          className="mt-2"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={c.name}
          autoFocus
        />
      </Modal>
    </PageShell>
  );
}

function configurationAgentColumns(
  configurationId: string | undefined,
  desiredHash: string | null,
): ColumnDef<Agent>[] {
  return [
    {
      id: "instance_uid",
      header: "Instance UID",
      cell: ({ row }) => {
        const uid = agentUid(row.original);
        return (
          <Link
            className="font-mono text-xs text-foreground hover:text-primary"
            to={`/portal/agents/${configurationId ?? ""}/${uid}`}
          >
            {uid}
          </Link>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge tone={agentConnectionTone(row.original.status)}>
          {row.original.status ?? "unknown"}
        </StatusBadge>
      ),
    },
    {
      id: "health",
      header: "Health",
      cell: ({ row }) => {
        const health = agentHealthView(row.original);
        return <StatusBadge tone={health.tone}>{health.label}</StatusBadge>;
      },
    },
    {
      id: "config_sync",
      header: "Config sync",
      cell: ({ row }) => {
        const sync = agentSyncView(row.original, desiredHash);
        return <StatusBadge tone={sync.tone}>{sync.label}</StatusBadge>;
      },
    },
    {
      id: "current_hash",
      header: "Current hash",
      cell: ({ row }) => {
        const sync = agentSyncView(row.original, desiredHash);
        return <span className="font-mono text-xs text-muted-foreground">{sync.hashLabel}</span>;
      },
    },
    {
      id: "last_seen",
      header: "Last seen",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {relTime(agentLastSeen(row.original))}
        </span>
      ),
    },
  ];
}
