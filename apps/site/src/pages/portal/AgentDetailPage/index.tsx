import { useMemo } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router";
import {
  useConfiguration,
  useAgentDetail,
  useConfigurationStats,
  useRestartAgent,
  useDisconnectAgent,
  type AgentDescription,
} from "@/api/hooks/portal";
import { usePortalGuidance } from "@/api/hooks/ai";
import { GuidancePanel, GuidanceSlot } from "@/components/ai";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { ErrorState } from "@/components/common/ErrorState";
import { hashLabel } from "@/utils/agents";
import { buildInsightRequest, insightSurfaces } from "@/ai/insight-registry";
import { useRegisterBrowserContext } from "@/ai/browser-context-react";
import {
  parsePipelineTopology,
  extractAgentIdentity,
  type ComponentHealthEntry,
} from "@/utils/pipeline";
import {
  buildAgentDetailGuidanceTargets,
  buildAgentDetailModel,
} from "@/pages/portal/agent-detail-model";
import { MetricCard, PageHeader, PageShell } from "@/components/app";
import { Box, Button, Tabs, Text } from "@mantine/core";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";
import { AgentCapabilities } from "@o11yfleet/core/codec";
import { confirmAction } from "@/utils/confirm-action";
import {
  ConfigBadge,
  ConnectionBadge,
  HealthBadge,
  StatusBadge,
} from "@/components/common/AgentBadges";
import type { AgentDetailOutletContext } from "./agent-detail-context";
import { safeJsonParse } from "./utils";

const TAB_VALUES = ["overview", "pipeline", "config"] as const;
type Tab = (typeof TAB_VALUES)[number];

function deriveActiveTab(pathname: string): Tab {
  const last = pathname.split("/").filter(Boolean).pop();
  return (TAB_VALUES as readonly string[]).includes(last ?? "") ? (last as Tab) : "overview";
}

export default function AgentDetailPage() {
  const { configId, agentUid } = useParams<{ configId: string; agentUid: string }>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeTab = deriveActiveTab(pathname);

  const config = useConfiguration(configId);
  const agentQuery = useAgentDetail(configId, agentUid);
  const stats = useConfigurationStats(configId);
  const restartAgent = useRestartAgent(configId ?? "");
  const disconnectAgent = useDisconnectAgent(configId ?? "");

  const agent = agentQuery.data ?? null;

  const agentDesc: AgentDescription | null = useMemo(() => {
    if (!agent) return null;
    return typeof agent.agent_description === "string"
      ? safeJsonParse(agent.agent_description)
      : ((agent.agent_description as AgentDescription | null) ?? null);
  }, [agent]);

  const identity = useMemo(() => extractAgentIdentity(agentDesc), [agentDesc]);

  const topology = useMemo(
    () =>
      parsePipelineTopology(
        (agent?.effective_config_body as string | null) ?? null,
        (agent?.component_health_map as Record<string, ComponentHealthEntry> | null) ?? null,
      ),
    [agent?.effective_config_body, agent?.component_health_map],
  );

  const model = useMemo(
    () =>
      buildAgentDetailModel({
        agent,
        agentUid,
        configId,
        configurationName: config.data?.name,
        configCurrentHash:
          (config.data?.["current_config_hash"] as string | null | undefined) ?? undefined,
        statsDesiredHash: stats.data?.desired_config_hash ?? undefined,
        identity,
        topology,
        tab: activeTab,
      }),
    [
      agent,
      agentUid,
      configId,
      config.data,
      stats.data?.desired_config_hash,
      identity,
      topology,
      activeTab,
    ],
  );
  const {
    desiredHash,
    currentHash,
    healthy,
    acceptsRemoteConfig,
    drift,
    isConnected,
    hostname,
    capabilities,
    capabilitiesBits,
    componentCounts,
    configSync,
    guidanceContext,
    pageContext,
  } = model;
  const insightSurface = insightSurfaces.portalAgent;
  const guidanceTargets = useMemo(
    () =>
      buildAgentDetailGuidanceTargets({
        agent,
        tab: activeTab,
        healthy,
        isConnected,
        componentCounts,
        configSync,
        acceptsRemoteConfig,
        topology,
      }),
    [
      acceptsRemoteConfig,
      agent,
      componentCounts,
      configSync,
      healthy,
      isConnected,
      activeTab,
      topology,
    ],
  );
  const guidanceRequest: AiGuidanceRequest | null = useMemo(
    () =>
      agent && configId && agentUid && !config.isLoading && !agentQuery.isLoading
        ? buildInsightRequest(insightSurface, guidanceTargets, guidanceContext, {
            intent: "triage_state",
            pageContext,
          })
        : null,
    [
      agent,
      agentQuery.isLoading,
      config.isLoading,
      configId,
      agentUid,
      guidanceContext,
      guidanceTargets,
      insightSurface,
      pageContext,
    ],
  );
  const browserContext = useMemo(
    () => ({
      id: `portal.agent.${configId}.${agentUid}`,
      title: `${hostname} collector`,
      surface: insightSurface.surface,
      context: guidanceContext,
      targets: guidanceTargets,
      pageContext,
    }),
    [
      agentUid,
      configId,
      guidanceContext,
      guidanceTargets,
      hostname,
      insightSurface.surface,
      pageContext,
    ],
  );
  useRegisterBrowserContext(guidanceRequest ? browserContext : null);
  const guidance = usePortalGuidance(guidanceRequest);
  const healthInsight = guidance.data?.items.find((item) => item.target_key === "agent.health");
  const configInsight = guidance.data?.items.find(
    (item) => item.target_key === "agent.configuration",
  );
  const pipelineInsight = guidance.data?.items.find((item) => item.target_key === "agent.pipeline");

  if (!configId || !agentUid) {
    return <ErrorState error={new Error("Missing configuration or agent id in URL")} />;
  }
  if (config.isLoading || agentQuery.isLoading) return <LoadingSpinner />;
  if (config.error) return <ErrorState error={config.error} retry={() => void config.refetch()} />;
  if (agentQuery.error)
    return <ErrorState error={agentQuery.error} retry={() => void agentQuery.refetch()} />;
  if (!agent) return <ErrorState error={new Error("Agent not found")} />;

  const outletContext: AgentDetailOutletContext = {
    agent,
    agentDesc,
    agentUid,
    identity,
    topology,
    healthy,
    isConnected,
    configSync,
    desiredHash,
    currentHash,
    capabilities,
    componentCounts,
    componentInventory: model.componentInventory,
  };

  return (
    <PageShell width="wide">
      <PageHeader
        title={hostname}
        description={
          <>
            {identity.serviceName ? (
              <Text component="span" display="block">
                {identity.serviceName}
                {identity.serviceVersion ? ` v${identity.serviceVersion}` : ""}
              </Text>
            ) : null}
            <span>
              Configuration:{" "}
              <Link to={`/portal/configurations/${configId}`}>{config.data?.name ?? configId}</Link>
            </span>
          </>
        }
        actions={
          <>
            <ConnectionBadge connected={isConnected} />
            <StatusBadge status={agent.status as string} />
            <HealthBadge healthy={healthy} />
            <ConfigBadge sync={configSync} />
            <Button
              variant="default"
              size="xs"
              onClick={() =>
                confirmAction({
                  title: "Restart agent",
                  body: (
                    <Text size="sm">
                      Send a Restart command to <strong>{hostname}</strong>?
                    </Text>
                  ),
                  confirmLabel: "Restart",
                  destructive: true,
                  loading: { title: "Restarting agent…", message: hostname },
                  success: {
                    title: "Restart sent",
                    message: `Restart command sent to ${hostname}`,
                  },
                  errorTitle: "Restart failed",
                  action: () => restartAgent.mutateAsync(agentUid),
                })
              }
              // Gate on the raw capability bit, not the display-name string.
              // The names array is built from a lookup table that could rename
              // entries; the bit is the wire-level contract from OpAMP §4.4.1.
              disabled={
                !isConnected || (capabilitiesBits & AgentCapabilities.AcceptsRestartCommand) === 0
              }
              title={
                !isConnected
                  ? "Agent is not connected"
                  : (capabilitiesBits & AgentCapabilities.AcceptsRestartCommand) === 0
                    ? "Agent does not advertise AcceptsRestartCommand"
                    : "Send Restart command to this agent"
              }
            >
              Restart
            </Button>
            <Button
              variant="default"
              size="xs"
              onClick={() =>
                confirmAction({
                  title: "Disconnect agent",
                  body: (
                    <Text size="sm">
                      Close the OpAMP WebSocket for <strong>{hostname}</strong>? The agent will
                      reconnect automatically per its backoff policy.
                    </Text>
                  ),
                  confirmLabel: "Disconnect",
                  destructive: true,
                  loading: { title: "Disconnecting agent…", message: hostname },
                  success: {
                    title: "Disconnect sent",
                    message: `Closed WebSocket for ${hostname}; agent will reconnect automatically`,
                  },
                  errorTitle: "Disconnect failed",
                  action: () => disconnectAgent.mutateAsync(agentUid),
                })
              }
              disabled={!isConnected}
              title={
                isConnected ? "Close the OpAMP WebSocket for this agent" : "Agent is not connected"
              }
            >
              Disconnect
            </Button>
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
        <MetricCard
          label="Connection"
          value={isConnected === true ? "online" : isConnected === false ? "offline" : "unknown"}
          tone={isConnected === true ? "ok" : isConnected === false ? "error" : "neutral"}
        />
        <MetricCard
          label="Health"
          value={healthy === true ? "healthy" : healthy === false ? "unhealthy" : "unknown"}
          tone={healthy === true ? "ok" : healthy === false ? "error" : "neutral"}
        >
          <GuidanceSlot item={healthInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard label="Config sync" value={configSync.label} tone={configSync.tone}>
          <GuidanceSlot item={configInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard
          label="Components"
          value={componentCounts.total.toLocaleString()}
          detail={
            componentCounts.total > 0
              ? `${componentCounts.healthy} healthy / ${componentCounts.degraded} degraded`
              : "No component health reported"
          }
          tone={componentCounts.degraded > 0 ? "warn" : "neutral"}
        >
          <GuidanceSlot item={pipelineInsight} loading={guidance.isLoading} />
        </MetricCard>
        <MetricCard label="Desired config" value={hashLabel(desiredHash)} />
        <MetricCard
          label="Current config"
          value={hashLabel(currentHash)}
          tone={drift ? "warn" : "neutral"}
        />
      </Box>

      <GuidancePanel
        title="Agent guidance"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
        excludeTargetKeys={["agent.health", "agent.configuration", "agent.pipeline"]}
      />

      <Tabs
        value={activeTab}
        mt="md"
        // Mantine fires onChange when keyboard nav (arrow keys, Home/End)
        // activates a tab. Without this handler, those activations would not
        // update the URL and keyboard users would be stranded on the same
        // route. NavLink clicks navigate independently — onChange handles
        // the keyboard path only.
        onChange={(value) => {
          if (value && configId && agentUid) {
            void navigate(`/portal/agents/${configId}/${agentUid}/${value}`);
          }
        }}
      >
        <Tabs.List aria-label="Agent detail sections">
          <Tabs.Tab value="overview" renderRoot={(props) => <NavLink {...props} to="overview" />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="pipeline" renderRoot={(props) => <NavLink {...props} to="pipeline" />}>
            Pipeline
          </Tabs.Tab>
          <Tabs.Tab value="config" renderRoot={(props) => <NavLink {...props} to="config" />}>
            Configuration
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>

      <Outlet context={outletContext} />
    </PageShell>
  );
}
