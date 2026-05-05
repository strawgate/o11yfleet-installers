import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router";
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
} from "@/api/hooks/portal";
import { usePortalGuidance } from "@/api/hooks/ai";
import { GuidancePanel, GuidanceSlot } from "@/components/ai";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { ErrorState } from "@/components/common/ErrorState";
import {
  EnrollmentDialogBody,
  enrollmentTokenFailureMessage,
} from "@/pages/portal/EnrollmentDialogBody";
import { hashLabel } from "@/utils/agents";
import {
  buildInsightRequest,
  insightSurfaces,
  insightTarget,
  tabInsightTarget,
} from "@/ai/insight-registry";
import { useRegisterBrowserContext } from "@/ai/browser-context-react";
import { includedFetch, pageYaml, unavailableFetch } from "@/ai/page-context";
import { MetricCard, PageHeader, PageShell, StatusBadge } from "@/components/app";
import { Box, Button, Code, Group, Modal, Stack, Tabs, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  buildConfigurationDetailModel,
  type ConfigurationDetailTab,
} from "@/pages/portal/configuration-detail-model";
import type { AiGuidanceRequest, AiLightFetch } from "@o11yfleet/core/ai";
import { confirmAction } from "@/utils/confirm-action";
import { getErrorMessage } from "@/utils/errors";
import type { ConfigurationDetailOutletContext, RunCopilot } from "./configuration-detail-context";

const EMPTY_AGENTS: Agent[] = [];
const EMPTY_VERSIONS: ConfigVersion[] = [];
const EMPTY_TOKENS: EnrollmentToken[] = [];
const EMPTY_GUIDANCE_CONTEXT: Record<string, unknown> = {};

const TAB_VALUES = [
  "agents",
  "versions",
  "rollout",
  "yaml",
  "settings",
] as const satisfies readonly ConfigurationDetailTab[];
type Tab = (typeof TAB_VALUES)[number];

function deriveActiveTab(pathname: string): Tab {
  const last = pathname.split("/").filter(Boolean).pop();
  return (TAB_VALUES as readonly string[]).includes(last ?? "") ? (last as Tab) : "agents";
}

export default function ConfigurationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeTab = deriveActiveTab(pathname);

  const config = useConfiguration(id);
  const hasConfigContent = Boolean(config.data?.current_config_hash);
  // YAML is fetched only while the YAML or Rollout tab is active — both
  // consume it. Other tabs don't need it on screen, but rollout's confirm
  // dialog needs to assert the YAML is loaded before submitting.
  const yamlNeeded = (activeTab === "yaml" || activeTab === "rollout") && hasConfigContent;
  const yaml = useConfigurationYaml(id, yamlNeeded);
  const [agentCursor, setAgentCursor] = useState<string | undefined>(undefined);
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
  const versionsQuery = useConfigurationVersions(id);
  const tokens = useConfigurationTokens(id);
  const stats = useConfigurationStats(id);
  const deleteConfig = useDeleteConfiguration();
  const createEnrollmentToken = useCreateEnrollmentToken(id ?? "");
  const rollout = useRolloutConfig(id ?? "");
  const restartFleet = useRestartConfiguration(id ?? "");
  const disconnectFleet = useDisconnectConfiguration(id ?? "");

  const c = config.data;
  const agentList = useMemo(() => agents.data?.agents ?? EMPTY_AGENTS, [agents.data?.agents]);
  const versionList = useMemo(() => versionsQuery.data ?? EMPTY_VERSIONS, [versionsQuery.data]);
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

  const guidanceReady =
    Boolean(c) &&
    (activeTab !== "agents" || agents.isFetched) &&
    versionsQuery.isFetched &&
    tokens.isFetched &&
    stats.isFetched &&
    !stats.error &&
    Boolean(stats.data) &&
    (!yamlNeeded || yaml.isFetched);
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

  // Reset copilot when tabs change so the previous tab's copilot panel
  // doesn't linger on the next tab.
  useEffect(() => {
    latestCopilotRunRef.current += 1;
    setCopilotRequest(null);
    setCopilotTitle("Configuration copilot");
  }, [activeTab]);

  // The orchestrator stays mounted while react-router swaps :id (same route
  // pattern), so configuration-scoped state would otherwise carry over to
  // the next configuration: stale agent cursor, leftover modals, copilot
  // text from the previous group. Wipe everything that isn't derived from
  // queries when :id changes.
  useEffect(() => {
    setAgentCursor(undefined);
    setDeleteOpen(false);
    setEnrollOpen(false);
    setEnrollmentToken(null);
    setEnrollmentTokenError(null);
    setConfirmName("");
    latestCopilotRunRef.current += 1;
    setCopilotRequest(null);
    setCopilotTitle("Configuration copilot");
  }, [id]);

  const openEnrollDialog = useCallback(() => {
    setEnrollmentToken(null);
    setEnrollmentTokenError(null);
    setEnrollOpen(true);
  }, []);

  const closeEnrollDialog = useCallback(() => {
    setEnrollOpen(false);
    setEnrollmentToken(null);
    setEnrollmentTokenError(null);
  }, []);

  const openDeleteDialog = useCallback(() => setDeleteOpen(true), []);

  const handleCreateEnrollmentToken = useCallback(async () => {
    if (!c) return;
    setEnrollmentTokenError(null);
    try {
      const result = await createEnrollmentToken.mutateAsync({ label: "configuration-enrollment" });
      if (!result.token) {
        const message = "The server did not return an enrollment token.";
        setEnrollmentToken(null);
        setEnrollmentTokenError(message);
        notifications.show({ title: "Failed to create token", message, color: "red" });
        return;
      }
      setEnrollmentToken(result.token);
      notifications.show({ title: "Enrollment token created", message: c.name, color: "brand" });
    } catch (err) {
      const message = enrollmentTokenFailureMessage(err);
      setEnrollmentToken(null);
      setEnrollmentTokenError(message);
      notifications.show({ title: "Failed to create token", message, color: "red" });
    }
  }, [c, createEnrollmentToken]);

  const handleDelete = useCallback(async () => {
    if (!id || !c) return;
    try {
      await deleteConfig.mutateAsync(id);
      notifications.show({ title: "Configuration deleted", message: c.name, color: "brand" });
      void navigate("/portal/configurations");
    } catch (err) {
      notifications.show({
        title: "Delete failed",
        message: getErrorMessage(err),
        color: "red",
      });
    }
  }, [c, deleteConfig, id, navigate]);

  const openRestartFleetConfirm = useCallback(() => {
    if (!c) return;
    confirmAction({
      title: "Restart all collectors",
      body: (
        <Stack gap="xs">
          <Text size="sm">
            Send a Restart command to all{" "}
            {typeof activeWebSockets === "number" ? activeWebSockets : ""} connected collector(s)
            for <strong>{c.name}</strong>?
          </Text>
          <Text size="xs" c="dimmed">
            Collectors that don't advertise <Code>AcceptsRestartCommand</Code> will be skipped.
          </Text>
        </Stack>
      ),
      confirmLabel: "Restart",
      destructive: true,
      loading: {
        title: "Restarting collectors…",
        message: "Sending Restart command to connected agents",
      },
      // Wording note: "command sent" not "restarted" — Restart is a
      // best-effort signal, the agent re-establishes its WebSocket on its
      // own backoff after receiving it.
      success: {
        title: "Restart sent",
        // The success message is finalized inside `action` because it
        // depends on the mutation's return value (count + skipped).
        message: "",
      },
      errorTitle: "Restart failed",
      action: async () => {
        const result = await restartFleet.mutateAsync();
        const skipped =
          result.skipped_no_cap > 0 ? ` (${result.skipped_no_cap} skipped — no capability)` : "";
        notifications.show({
          color: "brand",
          title: "Restart sent",
          message: `Restart command sent to ${result.restarted} collector(s)${skipped}`,
          autoClose: 4000,
        });
      },
    });
  }, [activeWebSockets, c, restartFleet]);

  const openDisconnectFleetConfirm = useCallback(() => {
    if (!c) return;
    confirmAction({
      title: "Disconnect all collectors",
      body: (
        <Stack gap="xs">
          <Text size="sm">
            Close the OpAMP WebSocket for all{" "}
            {typeof activeWebSockets === "number" ? activeWebSockets : ""} connected collector(s)
            for <strong>{c.name}</strong>?
          </Text>
          <Text size="xs" c="dimmed">
            Collectors will reconnect automatically per their backoff policy.
          </Text>
        </Stack>
      ),
      confirmLabel: "Disconnect",
      destructive: true,
      loading: {
        title: "Disconnecting collectors…",
        message: "Closing OpAMP WebSockets",
      },
      success: { title: "Disconnect sent", message: "" },
      errorTitle: "Disconnect failed",
      action: async () => {
        const result = await disconnectFleet.mutateAsync();
        notifications.show({
          color: "brand",
          title: "Disconnect sent",
          // Phrase as "closed" not "disconnected" — agents reconnect on
          // their own backoff (typically within seconds).
          message: `Closed ${result.disconnect_requested} collector connection(s); agents will reconnect automatically`,
          autoClose: 4000,
        });
      },
    });
  }, [activeWebSockets, c, disconnectFleet]);

  const openRolloutConfirm = useCallback(() => {
    if (!c) return;
    if (!yaml.data || yaml.isLoading || yaml.error) {
      notifications.show({
        title: "Rollout failed",
        message: "YAML is loading or unavailable",
        color: "red",
      });
      return;
    }
    confirmAction({
      title: "Confirm rollout",
      body: (
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
      confirmLabel: "Roll out now",
      loading: {
        title: "Rolling out…",
        message: "Setting desired config and pushing to connected collectors",
      },
      success: { title: "Rollout initiated", message: c.name },
      errorTitle: "Rollout failed",
      action: () => rollout.mutateAsync(yaml.data!),
    });
  }, [c, connectedAgents, rollout, yaml.data, yaml.error, yaml.isLoading]);

  const loadCopilotLightFetches = useCallback(
    async (mode?: "version-diff" | "rollout-summary"): Promise<AiLightFetch[]> => {
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
            getErrorMessage(err, "Light fetch failed"),
          ),
        ];
      }
    },
    [id],
  );

  const runCopilot = useCallback<RunCopilot>(
    async (title, intent, userPrompt, lightFetchMode) => {
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
    },
    [
      activeTab,
      agentList,
      buildConfigurationTargets,
      c,
      desiredHash,
      guidanceReady,
      insightSurface,
      loadCopilotLightFetches,
      stats.data,
      tokenList,
      versionList,
      yaml.data,
    ],
  );

  if (config.isLoading) return <LoadingSpinner />;
  if (config.error) return <ErrorState error={config.error} retry={() => void config.refetch()} />;
  if (!c) return <ErrorState error={new Error("Configuration not found")} />;
  if (!id) return <ErrorState error={new Error("Missing configuration id in URL")} />;

  const outletContext: ConfigurationDetailOutletContext = {
    configuration: c,
    configId: id,
    agentsQuery: agents,
    versionsQuery,
    yamlQuery: yaml,
    agentList,
    versionList,
    tokenList,
    agentCursor,
    setAgentCursor,
    desiredHash,
    connectedAgents,
    totalAgents,
    activeWebSockets,
    hasConfigContent,
    rollout,
    restartFleet,
    disconnectFleet,
    openEnrollDialog,
    openDeleteDialog,
    openRolloutConfirm,
    openRestartFleetConfirm,
    openDisconnectFleetConfirm,
    runCopilot,
    copilotIsLoading: copilot.isLoading,
    guidance,
  };

  return (
    <PageShell width="wide">
      <PageHeader
        title={c.name}
        description={
          <>
            {c.description ? <span className="block">{c.description}</span> : null}
            <span>
              Configuration group: desired config for collectors enrolled into this assignment
              boundary.
            </span>
          </>
        }
        actions={
          <>
            <Button onClick={openEnrollDialog}>Enroll agent</Button>
            <StatusBadge tone={c.status === "active" ? "ok" : "warn"}>
              {c.status ?? "unknown"}
            </StatusBadge>
          </>
        }
      />

      <Box
        style={{
          display: "grid",
          gap: "var(--mantine-spacing-sm)",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        <MetricCard label="Total collectors" value={formatMetricValue(totalAgents)}>
          <GuidanceSlot item={agentInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard
          label="Connected"
          value={
            totalAgents !== null && connectedAgents !== null
              ? `${connectedAgents.toLocaleString()} / ${totalAgents.toLocaleString()}`
              : "—"
          }
          tone={
            connectedAgents !== null &&
            totalAgents !== null &&
            connectedAgents === totalAgents &&
            totalAgents > 0
              ? "ok"
              : "neutral"
          }
        />
        <MetricCard
          label="Healthy"
          value={
            totalAgents !== null && healthyAgents !== null
              ? `${healthyAgents.toLocaleString()} / ${totalAgents.toLocaleString()}`
              : "—"
          }
          tone={
            healthyAgents !== null &&
            totalAgents !== null &&
            healthyAgents === totalAgents &&
            totalAgents > 0
              ? "ok"
              : "neutral"
          }
        />
        <MetricCard
          label="Drifted"
          value={formatMetricValue(driftedAgents)}
          tone={driftedAgents !== null && driftedAgents > 0 ? "warn" : "neutral"}
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
      </Box>

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
        mt="md"
        // Click navigation is handled by NavLink (renderRoot below) — this
        // onChange exists for keyboard nav (arrow keys, Home/End), where
        // Mantine fires onChange but the underlying anchor isn't activated.
        // Guard against the click path's duplicate fire by skipping when
        // the URL already matches the requested tab.
        onChange={(value) => {
          if (!value) return;
          const target = `/portal/configurations/${id}/${value}`;
          if (pathname !== target) void navigate(target);
        }}
      >
        <Tabs.List aria-label="Configuration sections">
          {/*
            Pin explicit ids on each Tabs.Tab so the matching panels (rendered
            via <Outlet /> outside Mantine's Tabs.Panel context) can reference
            them with aria-labelledby. Without this, screen readers can't tell
            which tab labels which panel.
          */}
          <Tabs.Tab
            id="configuration-tab-agents-trigger"
            value="agents"
            renderRoot={(props) => <NavLink {...props} to="agents" />}
          >
            Agents
          </Tabs.Tab>
          <Tabs.Tab
            id="configuration-tab-versions-trigger"
            value="versions"
            renderRoot={(props) => <NavLink {...props} to="versions" />}
          >
            Versions
          </Tabs.Tab>
          <Tabs.Tab
            id="configuration-tab-rollout-trigger"
            value="rollout"
            renderRoot={(props) => <NavLink {...props} to="rollout" />}
          >
            Rollout
          </Tabs.Tab>
          <Tabs.Tab
            id="configuration-tab-yaml-trigger"
            value="yaml"
            renderRoot={(props) => <NavLink {...props} to="yaml" />}
          >
            YAML
          </Tabs.Tab>
          <Tabs.Tab
            id="configuration-tab-settings-trigger"
            value="settings"
            renderRoot={(props) => <NavLink {...props} to="settings" />}
          >
            Settings
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>

      <Outlet context={outletContext} />

      <Modal opened={enrollOpen} onClose={closeEnrollDialog} title="Enroll agent">
        <Stack gap="md">
          <EnrollmentDialogBody
            enrollmentToken={enrollmentToken}
            enrollmentTokenError={enrollmentTokenError}
          />
          <Group gap="xs" justify="flex-end">
            <Button variant="default" onClick={closeEnrollDialog}>
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
            aria-label={`Type the configuration name "${c.name}" to confirm deletion`}
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
