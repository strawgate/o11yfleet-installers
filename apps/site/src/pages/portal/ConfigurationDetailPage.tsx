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
  useRestartConfiguration,
  useDisconnectConfiguration,
  fetchConfigurationVersionDiff,
  fetchRolloutCohortSummary,
  type Agent,
  type ConfigVersion,
  type EnrollmentToken,
} from "../../api/hooks/portal";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel, GuidanceSlot } from "../../components/ai";
import { CopyButton } from "../../components/common/CopyButton";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { EnrollmentDialogBody, enrollmentTokenFailureMessage } from "./EnrollmentDialogBody";
import { relTime, trunc } from "../../utils/format";
import { agentLastSeen, agentUid, hashLabel } from "../../utils/agents";
import {
  buildInsightRequest,
  insightSurfaces,
  insightTarget,
  tabInsightTarget,
} from "../../ai/insight-registry";
import { useRegisterBrowserContext } from "../../ai/browser-context-react";
import { includedFetch, pageYaml, unavailableFetch } from "../../ai/page-context";
import { EmptyState, MetricCard, PageHeader, PageShell, StatusBadge } from "@/components/app";
import { DataTable, type ColumnDef } from "@/components/data-table";
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { agentHealthView, agentStatusView, agentSyncView } from "./agent-view-model";
import {
  buildConfigurationDetailModel,
  type ConfigurationDetailTab,
} from "./configuration-detail-model";
import type { AiGuidanceIntent, AiGuidanceRequest, AiLightFetch } from "@o11yfleet/core/ai";

type Tab = ConfigurationDetailTab;

const EMPTY_AGENTS: Agent[] = [];
const EMPTY_VERSIONS: ConfigVersion[] = [];
const EMPTY_TOKENS: EnrollmentToken[] = [];
const EMPTY_GUIDANCE_CONTEXT: Record<string, unknown> = {};

export default function ConfigurationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
  const restartFleet = useRestartConfiguration(id ?? "");
  const disconnectFleet = useDisconnectConfiguration(id ?? "");

  const c = config.data;
  const agentList = useMemo(() => agents.data?.agents ?? EMPTY_AGENTS, [agents.data?.agents]);
  const versionList = useMemo(() => versions.data ?? EMPTY_VERSIONS, [versions.data]);
  const tokenList = useMemo(() => tokens.data ?? EMPTY_TOKENS, [tokens.data]);
  const model = useMemo(
    () =>
      c
        ? buildConfigurationDetailModel({
            configuration: c,
            activeTab,
            agents: agentList,
            versions: versionList,
            tokens: tokenList,
            stats: stats.data,
            yaml: yaml.data,
          })
        : null,
    [activeTab, agentList, c, stats.data, tokenList, versionList, yaml.data],
  );
  const connectedAgents = model?.connectedAgents ?? null;
  const totalAgents = model?.totalAgents ?? null;
  const healthyAgents = model?.healthyAgents ?? null;
  const activeWebSockets = model?.activeWebSockets ?? null;
  const desiredHash = model?.desiredHash ?? null;
  const driftedAgents = model?.driftedAgents ?? null;
  const agentColumns = useMemo(() => configurationAgentColumns(id, desiredHash), [desiredHash, id]);
  const guidanceReady =
    Boolean(c) &&
    (activeTab !== "agents" || agents.isFetched) &&
    versions.isFetched &&
    tokens.isFetched &&
    stats.isFetched &&
    !stats.error &&
    Boolean(stats.data) &&
    (!hasConfigContent || yaml.isFetched);
  const insightSurface = insightSurfaces.portalConfiguration;
  const pageContext = useMemo(
    () => (guidanceReady && model ? model.pageContext : null),
    [guidanceReady, model],
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
  const guidanceContext = model?.guidanceContext ?? EMPTY_GUIDANCE_CONTEXT;
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
      notifications.show({ title: "Configuration deleted", message: c!.name, color: "brand" });
      void navigate("/portal/configurations");
    } catch (err) {
      notifications.show({
        title: "Delete failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    }
  }

  function openRestartFleetConfirm() {
    modals.openConfirmModal({
      title: "Restart all collectors",
      centered: true,
      children: (
        <Stack gap="xs">
          <Text size="sm">
            Send a Restart command to all{" "}
            {typeof activeWebSockets === "number" ? activeWebSockets : ""} connected collector(s)
            for <strong>{c!.name}</strong>?
          </Text>
          <Text size="xs" c="dimmed">
            Collectors that don't advertise <Code>AcceptsRestartCommand</Code> will be skipped.
          </Text>
        </Stack>
      ),
      labels: { confirm: "Restart", cancel: "Cancel" },
      confirmProps: { color: "red" },
      // Mantine onConfirm types as `() => void`; void IIFE discards the
      // promise so no-misused-promises stops flagging the async body.
      onConfirm: () => {
        void (async () => {
          const toastId = notifications.show({
            loading: true,
            title: "Restarting collectors…",
            message: "Sending Restart command to connected agents",
            autoClose: false,
            withCloseButton: false,
          });
          try {
            const result = await restartFleet.mutateAsync();
            const skippedSuffix =
              result.skipped_no_cap > 0
                ? ` (${result.skipped_no_cap} skipped — no capability)`
                : "";
            // Wording note: "command sent" not "restarted" — Restart is a
            // best-effort signal, the agent re-establishes its WebSocket on its
            // own backoff after receiving it. Asserting "restarted" would
            // overstate certainty; the user only knows the command left here.
            notifications.update({
              id: toastId,
              loading: false,
              color: "brand",
              title: "Restart sent",
              message: `Restart command sent to ${result.restarted} collector(s)${skippedSuffix}`,
              autoClose: 4000,
              withCloseButton: true,
            });
          } catch (err) {
            notifications.update({
              id: toastId,
              loading: false,
              color: "red",
              title: "Restart failed",
              message: err instanceof Error ? err.message : "Unknown error",
              autoClose: 6000,
              withCloseButton: true,
            });
          }
        })();
      },
    });
  }

  function openDisconnectFleetConfirm() {
    modals.openConfirmModal({
      title: "Disconnect all collectors",
      centered: true,
      children: (
        <Stack gap="xs">
          <Text size="sm">
            Close the OpAMP WebSocket for all{" "}
            {typeof activeWebSockets === "number" ? activeWebSockets : ""} connected collector(s)
            for <strong>{c!.name}</strong>?
          </Text>
          <Text size="xs" c="dimmed">
            Collectors will reconnect automatically per their backoff policy.
          </Text>
        </Stack>
      ),
      labels: { confirm: "Disconnect", cancel: "Cancel" },
      confirmProps: { color: "red" },
      // See note on the Restart onConfirm above.
      onConfirm: () => {
        void (async () => {
          const toastId = notifications.show({
            loading: true,
            title: "Disconnecting collectors…",
            message: "Closing OpAMP WebSockets",
            autoClose: false,
            withCloseButton: false,
          });
          try {
            const result = await disconnectFleet.mutateAsync();
            notifications.update({
              id: toastId,
              loading: false,
              color: "brand",
              title: "Disconnect sent",
              // The server closes the WebSocket here; the agent will
              // reconnect on its own backoff. Phrase as "closed" not
              // "disconnected" since the agent typically reconnects
              // within seconds.
              message: `Closed ${result.disconnected} collector connection(s); agents will reconnect automatically`,
              autoClose: 4000,
              withCloseButton: true,
            });
          } catch (err) {
            notifications.update({
              id: toastId,
              loading: false,
              color: "red",
              title: "Disconnect failed",
              message: err instanceof Error ? err.message : "Unknown error",
              autoClose: 6000,
              withCloseButton: true,
            });
          }
        })();
      },
    });
  }

  function openRolloutConfirm() {
    if (!yaml.data || yaml.isLoading || yaml.error) {
      notifications.show({
        title: "Rollout failed",
        message: "YAML is loading or unavailable",
        color: "red",
      });
      return;
    }
    modals.openConfirmModal({
      title: "Confirm rollout",
      centered: true,
      children: (
        <Text size="sm">
          {connectedAgents !== null ? (
            <>
              This will set the current YAML as desired config for{" "}
              <strong>{connectedAgents}</strong> connected collector
              {connectedAgents !== 1 ? "s" : ""}.
            </>
          ) : (
            "This will set the current YAML as desired config for connected collectors in this configuration."
          )}
        </Text>
      ),
      labels: { confirm: "Roll out now", cancel: "Cancel" },
      // See note on the Restart onConfirm above.
      onConfirm: () => {
        void (async () => {
          const toastId = notifications.show({
            loading: true,
            title: "Rolling out…",
            message: "Setting desired config and pushing to connected collectors",
            autoClose: false,
            withCloseButton: false,
          });
          try {
            await rollout.mutateAsync(yaml.data!);
            notifications.update({
              id: toastId,
              loading: false,
              color: "brand",
              title: "Rollout initiated",
              message: c!.name,
              autoClose: 4000,
              withCloseButton: true,
            });
          } catch (err) {
            notifications.update({
              id: toastId,
              loading: false,
              color: "red",
              title: "Rollout failed",
              message: err instanceof Error ? err.message : "Unknown error",
              autoClose: 6000,
              withCloseButton: true,
            });
          }
        })();
      },
    });
  }

  async function handleCreateEnrollmentToken() {
    setEnrollmentTokenError(null);
    try {
      const result = await createEnrollmentToken.mutateAsync({ name: "configuration-enrollment" });
      if (!result.token) {
        const message = "The server did not return an enrollment token.";
        setEnrollmentToken(null);
        setEnrollmentTokenError(message);
        notifications.show({ title: "Failed to create token", message, color: "red" });
        return;
      }
      setEnrollmentToken(result.token);
      notifications.show({ title: "Enrollment token created", message: c!.name, color: "brand" });
    } catch (err) {
      const message = enrollmentTokenFailureMessage(err);
      setEnrollmentToken(null);
      setEnrollmentTokenError(message);
      notifications.show({ title: "Failed to create token", message, color: "red" });
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
      notifications.show({
        title: "Copilot unavailable",
        message: "Configuration context is still loading.",
        color: "red",
      });
      return;
    }
    const lightFetches = await loadCopilotLightFetches(lightFetchMode);
    if (latestCopilotRunRef.current !== runId) return;
    const includeYaml = intent === "explain_page" || intent === "draft_config_change";
    const copilotPageContext = buildConfigurationDetailModel({
      configuration: c,
      activeTab,
      agents: agentList,
      versions: versionList,
      tokens: tokenList,
      stats: stats.data,
      yaml: yaml.data,
      includeYaml,
      lightFetches,
    }).pageContext;
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
  const totalAgentsValue = formatMetricValue(totalAgents);
  const connectedAgentsValue =
    totalAgents !== null && connectedAgents !== null
      ? `${connectedAgents.toLocaleString()} / ${totalAgents.toLocaleString()}`
      : "—";
  const healthyAgentsValue =
    totalAgents !== null && healthyAgents !== null
      ? `${healthyAgents.toLocaleString()} / ${totalAgents.toLocaleString()}`
      : "—";
  const connectedTone =
    connectedAgents !== null &&
    totalAgents !== null &&
    connectedAgents === totalAgents &&
    totalAgents > 0
      ? "ok"
      : "neutral";
  const healthyTone =
    healthyAgents !== null &&
    totalAgents !== null &&
    healthyAgents === totalAgents &&
    totalAgents > 0
      ? "ok"
      : "neutral";
  const driftTone = driftedAgents !== null && driftedAgents > 0 ? "warn" : "neutral";

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
        <MetricCard label="Total collectors" value={totalAgentsValue}>
          <GuidanceSlot item={agentInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard label="Connected" value={connectedAgentsValue} tone={connectedTone} />
        <MetricCard label="Healthy" value={healthyAgentsValue} tone={healthyTone} />
        <MetricCard label="Drifted" value={formatMetricValue(driftedAgents)} tone={driftTone} />
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

      <Tabs
        value={activeTab}
        onChange={(value) => {
          if (value) setActiveTab(value as Tab);
        }}
        mt="md"
      >
        <Tabs.List aria-label="Configuration sections">
          {tabs.map((t) => (
            <Tabs.Tab key={t.key} value={t.key}>
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      {/* Tab panels */}
      {activeTab === "agents" && (
        <div id="configuration-tab-agents" role="tabpanel" className="mt-6">
          {agents.isLoading ? (
            <LoadingSpinner />
          ) : (
            <>
              <Title order={3} size="sm" fw={500} mb="xs">
                Collectors
              </Title>
              <DataTable
                columns={agentColumns}
                data={agentList}
                getRowId={(agent) => agentUid(agent)}
                ariaLabel="Collectors for this configuration"
                empty={
                  <EmptyState
                    icon="plug"
                    title="No agents connected"
                    description="Create an enrollment token and run the installer on a host to attach a collector to this configuration."
                  >
                    <Button
                      size="xs"
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
            </>
          )}
          <Group gap="xs" mt="xs">
            <Button
              variant="subtle"
              size="xs"
              disabled={!agentCursor}
              onClick={() => setAgentCursor(undefined)}
            >
              First page
            </Button>
            <Button
              variant="default"
              size="xs"
              disabled={!agents.data?.pagination?.has_more}
              onClick={() => setAgentCursor(agents.data?.pagination?.next_cursor ?? undefined)}
            >
              Next page
            </Button>
          </Group>
        </div>
      )}

      {activeTab === "versions" && (
        <Stack id="configuration-tab-versions" role="tabpanel" mt="md" gap="md">
          <Group justify="space-between" wrap="wrap" align="flex-start">
            <Stack gap={4}>
              <Title order={3}>Versions</Title>
              <Text size="sm" c="dimmed">
                Compare the latest uploaded YAML against the previous immutable version.
              </Text>
            </Stack>
            <Button
              variant="default"
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
            </Button>
          </Group>
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
                            <Badge color="brand" variant="light">
                              current
                            </Badge>
                          ) : (
                            <Badge color="gray" variant="light">
                              previous
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </Stack>
      )}

      {activeTab === "rollout" && (
        <Card withBorder mt="md" id="configuration-tab-rollout" role="tabpanel">
          <Stack gap="sm">
            <Title order={3}>Rollout configuration</Title>
            <Text size="sm" c="dimmed">
              Rollout promotes the current version to desired config for this configuration group.
              Collectors are in sync once their reported current hash matches desired.
            </Text>
            <Alert color="info" variant="light" title="Rollout guardrails to wire next">
              Track actor, reason, selected version, connected target count, drift, failed apply,
              and rollback candidate before making this a full rollout history view.
            </Alert>
            <Group gap="xs">
              <Button
                variant="default"
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
              </Button>
              <Button
                onClick={openRolloutConfirm}
                loading={rollout.isPending}
                disabled={
                  !hasConfigContent ||
                  !yaml.data ||
                  yaml.isLoading ||
                  Boolean(yaml.error) ||
                  rollout.isPending
                }
              >
                Start rollout
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      {activeTab === "yaml" && (
        <Card withBorder mt="md" id="configuration-tab-yaml" role="tabpanel">
          <Group justify="space-between" mb="md" wrap="wrap" align="flex-start">
            <Stack gap={4}>
              <Title order={3}>Desired YAML</Title>
              <Text size="sm" c="dimmed">
                Effective config is what a collector actually runs after local bootstrap and remote
                config behavior; this page currently shows desired YAML from the control plane.
              </Text>
            </Stack>
            <Group gap="xs">
              <Button
                variant="default"
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
              </Button>
              <Button
                variant="default"
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
              </Button>
              <CopyButton value={yaml.data ?? ""} label="Copy YAML" />
            </Group>
          </Group>
          {yaml.isLoading ? (
            <LoadingSpinner />
          ) : (
            <pre className="code-block">{yaml.data ?? "# No YAML available"}</pre>
          )}
        </Card>
      )}

      {activeTab === "settings" && (
        <Stack id="configuration-tab-settings" role="tabpanel" mt="md" gap="md">
          <Card withBorder>
            <Title order={3}>Details</Title>
            <Stack gap={6} mt="sm">
              <Group gap="md">
                <Text size="sm" c="dimmed" w={88}>
                  ID
                </Text>
                <Text ff="monospace" size="sm">
                  {c.id}
                </Text>
              </Group>
              <Group gap="md">
                <Text size="sm" c="dimmed" w={88}>
                  Name
                </Text>
                <Text size="sm">{c.name}</Text>
              </Group>
              <Group gap="md">
                <Text size="sm" c="dimmed" w={88}>
                  Created
                </Text>
                <Text size="sm">{relTime(c.created_at)}</Text>
              </Group>
              <Group gap="md">
                <Text size="sm" c="dimmed" w={88}>
                  Updated
                </Text>
                <Text size="sm">{relTime(c.updated_at)}</Text>
              </Group>
            </Stack>
          </Card>

          <Card withBorder>
            <Title order={3}>Fleet actions</Title>
            <Stack gap="md" mt="sm">
              <Group justify="space-between" wrap="wrap" align="flex-start" gap="md">
                <Stack gap={4} flex="1 1 24rem">
                  <Text fw={500}>Restart all collectors</Text>
                  <Text size="xs" c="dimmed">
                    Sends an OpAMP Restart command to every connected collector that advertises the{" "}
                    <Code>AcceptsRestartCommand</Code> capability. Collectors without the capability
                    are skipped.
                  </Text>
                </Stack>
                <Button
                  variant="default"
                  onClick={openRestartFleetConfirm}
                  disabled={!activeWebSockets || activeWebSockets === 0}
                >
                  Restart collectors
                </Button>
              </Group>
              <Group justify="space-between" wrap="wrap" align="flex-start" gap="md">
                <Stack gap={4} flex="1 1 24rem">
                  <Text fw={500}>Disconnect all collectors</Text>
                  <Text size="xs" c="dimmed">
                    Closes the OpAMP WebSocket on every connected collector for this configuration.
                    Collectors will reconnect automatically per their backoff policy.
                  </Text>
                </Stack>
                <Button
                  variant="default"
                  onClick={openDisconnectFleetConfirm}
                  disabled={!activeWebSockets || activeWebSockets === 0}
                >
                  Disconnect collectors
                </Button>
              </Group>
            </Stack>
          </Card>

          <Card withBorder style={{ borderColor: "var(--mantine-color-err-6)" }}>
            <Title order={3} c="red">
              Danger zone
            </Title>
            <Group justify="space-between" mt="sm" wrap="wrap" align="flex-start" gap="md">
              <Stack gap={4} flex="1 1 24rem">
                <Text fw={500}>Delete this configuration</Text>
                <Text size="xs" c="dimmed">
                  This will permanently delete the configuration and disconnect all collectors.
                </Text>
              </Stack>
              <Button color="red" onClick={() => setDeleteOpen(true)}>
                Delete configuration
              </Button>
            </Group>
          </Card>
        </Stack>
      )}

      {/* Enrollment modal */}
      <Modal
        opened={enrollOpen}
        onClose={() => {
          setEnrollOpen(false);
          setEnrollmentToken(null);
          setEnrollmentTokenError(null);
        }}
        title="Enroll agent"
      >
        <Stack gap="md">
          <EnrollmentDialogBody
            enrollmentToken={enrollmentToken}
            enrollmentTokenError={enrollmentTokenError}
          />
          <Group gap="xs" justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setEnrollOpen(false);
                setEnrollmentToken(null);
                setEnrollmentTokenError(null);
              }}
            >
              Close
            </Button>
            {!enrollmentToken ? (
              <Button
                onClick={() => void handleCreateEnrollmentToken()}
                loading={createEnrollmentToken.isPending}
              >
                Create enrollment token
              </Button>
            ) : null}
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setConfirmName("");
        }}
        title="Delete configuration"
      >
        <Stack gap="md">
          <Text size="sm">
            Type <strong>{c.name}</strong> to confirm deletion.
          </Text>
          <TextInput
            value={confirmName}
            onChange={(e) => setConfirmName(e.currentTarget.value)}
            placeholder={c.name}
            data-autofocus
          />
          <Group gap="xs" justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setDeleteOpen(false);
                setConfirmName("");
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => void handleDelete()}
              disabled={confirmName !== c.name}
              loading={deleteConfig.isPending}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageShell>
  );
}

function formatMetricValue(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
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
      cell: ({ row }) => {
        const status = agentStatusView(row.original.status);
        return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
      },
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
