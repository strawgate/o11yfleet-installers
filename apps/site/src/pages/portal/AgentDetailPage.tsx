import { useState, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useConfiguration,
  useAgentDetail,
  useConfigurationStats,
  useRestartAgent,
  useDisconnectAgent,
  type AgentDetail,
  type AgentDescription,
} from "../../api/hooks/portal";
import { usePortalGuidance } from "../../api/hooks/ai";
import { GuidancePanel, GuidanceSlot } from "../../components/ai";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";
import { hashLabel } from "../../utils/agents";
import { buildInsightRequest, insightSurfaces } from "../../ai/insight-registry";
import { useRegisterBrowserContext } from "../../ai/browser-context-react";
import {
  parsePipelineTopology,
  extractAgentIdentity,
  type PipelineTopology,
  type PipelineComponent,
  type ComponentHealthEntry,
} from "../../utils/pipeline";
import {
  buildAgentDetailGuidanceTargets,
  buildAgentDetailModel,
  pipelineRows,
  type ConfigSyncView,
  type ComponentSummary,
  type PipelineRow,
} from "./agent-detail-model";
import { agentStatusView } from "./agent-view-model";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PageShell,
  StatusBadge as AppStatusBadge,
} from "@/components/app";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { Badge, Box, Button, Card, Group, Paper, Stack, Tabs, Text, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";
import { AgentCapabilities } from "@o11yfleet/core/codec";

type Tab = "overview" | "pipeline" | "config";

export default function AgentDetailPage() {
  const { configId, agentUid } = useParams<{ configId: string; agentUid: string }>();
  // The hook is `enabled` only when both ids are present, so it's safe to
  // call unconditionally — but we still surface a clear error to the user
  // if the URL is malformed instead of leaving the page in a perpetual
  // loading state.
  const config = useConfiguration(configId);
  const agentQuery = useAgentDetail(configId, agentUid);
  const stats = useConfigurationStats(configId);
  const restartAgent = useRestartAgent(configId ?? "");
  const disconnectAgent = useDisconnectAgent(configId ?? "");
  const [tab, setTab] = useState<Tab>("overview");

  const agent = agentQuery.data ?? null;

  // Parse agent_description (the detail endpoint returns it parsed)
  const agentDesc: AgentDescription | null = useMemo(() => {
    if (!agent) return null;
    return typeof agent.agent_description === "string"
      ? safeJsonParse(agent.agent_description)
      : ((agent.agent_description as AgentDescription | null) ?? null);
  }, [agent]);

  const identity = useMemo(() => extractAgentIdentity(agentDesc), [agentDesc]);

  // Parse pipeline topology
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
        tab,
      }),
    [
      agent,
      agentUid,
      configId,
      config.data,
      stats.data?.desired_config_hash,
      identity,
      topology,
      tab,
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
        tab,
        healthy,
        isConnected,
        componentCounts,
        configSync,
        acceptsRemoteConfig,
        topology,
      }),
    [acceptsRemoteConfig, agent, componentCounts, configSync, healthy, isConnected, tab, topology],
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

  return (
    <PageShell width="wide">
      <PageHeader
        title={hostname}
        description={
          <>
            {identity.serviceName ? (
              <span className="block">
                {identity.serviceName}
                {identity.serviceVersion ? ` v${identity.serviceVersion}` : ""}
              </span>
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
                modals.openConfirmModal({
                  title: "Restart agent",
                  centered: true,
                  children: (
                    <Text size="sm">
                      Send a Restart command to <strong>{hostname}</strong>?
                    </Text>
                  ),
                  labels: { confirm: "Restart", cancel: "Cancel" },
                  confirmProps: { color: "red" },
                  // Mantine's onConfirm is typed `() => void` so an `async` body
                  // trips no-misused-promises. Wrap the awaited work in a
                  // discarded IIFE — the modal closes synchronously, the
                  // mutation runs in the background and updates the toast.
                  onConfirm: () => {
                    void (async () => {
                      const toastId = notifications.show({
                        loading: true,
                        title: "Restarting agent…",
                        message: hostname,
                        autoClose: false,
                        withCloseButton: false,
                      });
                      try {
                        await restartAgent.mutateAsync(agentUid!);
                        notifications.update({
                          id: toastId,
                          loading: false,
                          color: "brand",
                          title: "Restart sent",
                          message: `Restart command sent to ${hostname}`,
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
                modals.openConfirmModal({
                  title: "Disconnect agent",
                  centered: true,
                  children: (
                    <Text size="sm">
                      Close the OpAMP WebSocket for <strong>{hostname}</strong>? The agent will
                      reconnect automatically per its backoff policy.
                    </Text>
                  ),
                  labels: { confirm: "Disconnect", cancel: "Cancel" },
                  confirmProps: { color: "red" },
                  // See note on the Restart onConfirm above — Mantine's
                  // sync-only signature requires us to discard the promise.
                  onConfirm: () => {
                    void (async () => {
                      const toastId = notifications.show({
                        loading: true,
                        title: "Disconnecting agent…",
                        message: hostname,
                        autoClose: false,
                        withCloseButton: false,
                      });
                      try {
                        await disconnectAgent.mutateAsync(agentUid!);
                        notifications.update({
                          id: toastId,
                          loading: false,
                          color: "brand",
                          title: "Disconnect sent",
                          message: `Closed WebSocket for ${hostname}; agent will reconnect automatically`,
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

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
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
      </div>

      <GuidancePanel
        title="Agent guidance"
        guidance={guidance.data}
        isLoading={guidance.isLoading}
        error={guidance.error}
        onRefresh={() => void guidance.refetch()}
        excludeTargetKeys={["agent.health", "agent.configuration", "agent.pipeline"]}
      />

      <Tabs
        value={tab}
        onChange={(value) => {
          if (value) setTab(value as Tab);
        }}
        mt="md"
      >
        <Tabs.List aria-label="Agent detail sections">
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="pipeline">Pipeline</Tabs.Tab>
          <Tabs.Tab value="config">Configuration</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {/* Tab content */}
      {tab === "overview" && (
        <OverviewTab
          agent={agent}
          identity={identity}
          agentUid={agentUid!}
          healthy={healthy}
          isConnected={isConnected}
          configSync={configSync}
          desiredHash={desiredHash}
          currentHash={currentHash}
          capabilities={capabilities}
          componentCounts={componentCounts}
        />
      )}
      {tab === "pipeline" && <PipelineTab topology={topology} />}
      {tab === "config" && (
        <ConfigTab
          effectiveConfig={agent.effective_config_body as string | null}
          effectiveHash={agent.effective_config_hash as string | null}
          desiredHash={desiredHash}
        />
      )}
    </PageShell>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({
  agent,
  identity,
  agentUid,
  healthy,
  isConnected,
  configSync,
  desiredHash,
  currentHash,
  capabilities,
  componentCounts,
}: {
  agent: AgentDetail;
  identity: ReturnType<typeof extractAgentIdentity>;
  agentUid: string;
  healthy: boolean | null;
  isConnected: boolean | null;
  configSync: ConfigSyncView;
  desiredHash: string | undefined;
  currentHash: string | null | undefined;
  capabilities: string[];
  componentCounts: ComponentSummary;
}) {
  return (
    <div
      id="agent-tab-overview"
      role="tabpanel"
      className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2"
    >
      {/* Identity card */}
      <Card>
        <Title order={3} size="sm" mb="md">
          Identity
        </Title>
        <dl className="detail-list">
          <dt>Instance UID</dt>
          <dd className="mono-cell text-sm">{agentUid}</dd>
          <dt>Hostname</dt>
          <dd>{identity.hostname ?? "—"}</dd>
          <dt>Service</dt>
          <dd>
            {identity.serviceName ?? "—"}
            {identity.serviceVersion && (
              <span className="meta ml-1">v{identity.serviceVersion}</span>
            )}
          </dd>
          <dt>OS</dt>
          <dd>
            {identity.osType ?? "—"}
            {identity.hostArch && <span className="meta ml-1">({identity.hostArch})</span>}
            {identity.osDescription && (
              <p className="meta text-xs mt-0.5">{identity.osDescription}</p>
            )}
          </dd>
          <dt>Connection</dt>
          <dd>
            <ConnectionBadge connected={isConnected} />
            {isConnected && agent.uptime_ms !== null && agent.uptime_ms !== undefined && (
              <span className="meta ml-2">uptime {formatDuration(agent.uptime_ms)}</span>
            )}
          </dd>
          <dt>Generation</dt>
          <dd>{agent.generation ?? "—"}</dd>
          <dt>First connected</dt>
          <dd>{relTime(tsToIso(agent.connected_at))}</dd>
          <dt>Last seen</dt>
          <dd>{relTime(tsToIso(agent.last_seen_at))}</dd>
        </dl>
      </Card>

      {/* Health card */}
      <Card>
        <Title order={3} size="sm" mb="md">
          Health
        </Title>
        <dl className="detail-list">
          <dt>Status</dt>
          <dd>
            <StatusBadge status={agent.status as string} />
          </dd>
          <dt>Healthy</dt>
          <dd>
            <HealthBadge healthy={healthy} />
          </dd>
          <dt>Components</dt>
          <dd>
            {componentCounts.total > 0 ? (
              <span>
                {componentCounts.total} total
                {componentCounts.healthy > 0 && (
                  <span className="text-green-600 ml-1">({componentCounts.healthy} ok)</span>
                )}
                {componentCounts.degraded > 0 && (
                  <span className="text-amber-600 ml-1">({componentCounts.degraded} degraded)</span>
                )}
              </span>
            ) : (
              "—"
            )}
          </dd>
          <dt>Last error</dt>
          <dd className={agent.last_error ? "text-red-600" : ""}>
            {(agent.last_error as string) || "—"}
          </dd>
        </dl>
      </Card>

      {/* Configuration card */}
      <Card>
        <Title order={3} size="sm" mb="md">
          Configuration
        </Title>
        <dl className="detail-list">
          <dt>Config sync</dt>
          <dd>
            <ConfigBadge sync={configSync} />
          </dd>
          <dt>Desired hash</dt>
          <dd className="mono-cell text-sm">{hashLabel(desiredHash)}</dd>
          <dt>Current hash</dt>
          <dd className="mono-cell text-sm">{hashLabel(currentHash)}</dd>
          <dt>Effective config hash</dt>
          <dd className="mono-cell text-sm">
            {hashLabel(agent.effective_config_hash as string | undefined)}
          </dd>
        </dl>
      </Card>

      {/* Capabilities card */}
      <Card>
        <Title order={3} size="sm" mb="md">
          Capabilities
        </Title>
        {capabilities.length > 0 ? (
          <Group gap="xs" mt="xs">
            {capabilities.map((cap) => (
              <Badge key={cap} variant="default" tt="none">
                {cap}
              </Badge>
            ))}
          </Group>
        ) : (
          <Text size="sm" c="dimmed" mt="xs">
            No capabilities reported
          </Text>
        )}
      </Card>
    </div>
  );
}

// ─── Pipeline Tab ──────────────────────────────────────────────────

function PipelineTab({ topology }: { topology: PipelineTopology | null }) {
  if (!topology) {
    return (
      <div id="agent-tab-pipeline" role="tabpanel" className="mt-6">
        <EmptyState
          icon="file"
          title="No pipeline to visualize"
          description="This agent has not reported an effective configuration yet."
        />
      </div>
    );
  }

  const rows = pipelineRows(topology);
  const columns = pipelineColumns();

  return (
    <div id="agent-tab-pipeline" role="tabpanel" className="mt-6 space-y-4">
      {/* Pipeline flow */}
      <Card>
        <Title order={3} size="sm" mb="md">
          Pipeline Flow
        </Title>
        {topology.pipelines.length === 0 ? (
          <Text size="sm" c="dimmed">
            No pipelines defined in service configuration.
          </Text>
        ) : (
          <Stack gap="md">
            {topology.pipelines.map((pipeline) => (
              <Paper key={pipeline.name} withBorder p="md">
                <Text size="xs" fw={500} c="dimmed" tt="uppercase" ff="monospace" mb="xs">
                  {pipeline.name}
                </Text>
                <Group align="flex-start" gap="sm" wrap="wrap">
                  <ComponentGroup
                    label="Receivers"
                    names={pipeline.receivers}
                    components={topology.receivers}
                  />
                  <PipelineArrow />
                  <ComponentGroup
                    label="Processors"
                    names={pipeline.processors}
                    components={topology.processors}
                  />
                  <PipelineArrow />
                  <ComponentGroup
                    label="Exporters"
                    names={pipeline.exporters}
                    components={topology.exporters}
                  />
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Card>

      {/* Extensions */}
      {topology.extensions.length > 0 && (
        <Card>
          <Title order={3} size="sm" mb="md">
            Extensions
          </Title>
          <Group gap="xs">
            {topology.extensions.map((ext) => (
              <ComponentChip key={ext.name ?? ext.type} component={ext} />
            ))}
          </Group>
        </Card>
      )}

      {/* Component detail table */}
      <Title order={3} size="sm" fw={500} mb="xs">
        All components
      </Title>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => `${row.category}-${row.name}`}
        ariaLabel="All components"
      />
    </div>
  );
}

function ComponentGroup({
  label,
  names,
  components,
}: {
  label: string;
  names: string[];
  components: PipelineComponent[];
}) {
  const matched = names.map(
    (name) => components.find((c) => c.type === name) ?? { name, type: name, healthy: null },
  );

  return (
    <Stack gap={6} style={{ flex: 1, minWidth: 120 }}>
      <Text size="xs" fw={500} c="dimmed" tt="uppercase" ff="monospace">
        {label}
      </Text>
      <Stack gap={4}>
        {matched.map((c) => (
          <ComponentChip key={c.name ?? c.type} component={c} />
        ))}
      </Stack>
    </Stack>
  );
}

function ComponentChip({ component }: { component: PipelineComponent }) {
  const color = component.healthy === false ? "red" : component.healthy === true ? "green" : "gray";
  return (
    <Badge
      variant="light"
      color={color}
      size="sm"
      tt="none"
      leftSection={<ComponentHealthDot healthy={component.healthy} />}
      title={component.lastError ?? component.status ?? component.type}
    >
      {component.type}
    </Badge>
  );
}

function ComponentHealthDot({ healthy }: { healthy: boolean | null }) {
  const color =
    healthy === true
      ? "var(--mantine-color-green-6)"
      : healthy === false
        ? "var(--mantine-color-red-6)"
        : "var(--mantine-color-gray-5)";
  return (
    <Box
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        display: "inline-block",
      }}
    />
  );
}

function PipelineArrow() {
  return (
    <Text c="dimmed" pt={26} aria-hidden>
      →
    </Text>
  );
}

// ─── Config Tab ────────────────────────────────────────────────────

function ConfigTab({
  effectiveConfig,
  effectiveHash,
  desiredHash,
}: {
  effectiveConfig: string | null;
  effectiveHash: string | null;
  desiredHash: string | undefined;
}) {
  if (!effectiveConfig) {
    return (
      <div id="agent-tab-config" role="tabpanel" className="mt-6">
        <EmptyState
          icon="file"
          title="No effective configuration"
          description="This agent has not reported the configuration it is actually running."
        />
      </div>
    );
  }

  return (
    <div id="agent-tab-config" role="tabpanel" className="mt-6 space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <Title order={3} size="sm" mb="md">
            Effective Configuration
          </Title>
          <div className="flex items-center gap-3">
            <span className="meta text-xs">
              Hash: <code className="mono-cell">{hashLabel(effectiveHash, 12)}</code>
            </span>
            <CopyButton text={effectiveConfig} />
          </div>
        </div>
        {desiredHash && effectiveHash && desiredHash !== effectiveHash && (
          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3 text-sm text-amber-800">
            ⚠ Effective config hash differs from desired config hash — agent may have additional
            local configuration.
          </div>
        )}
        <pre className="config-viewer">{effectiveConfig}</pre>
      </Card>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="xs"
      variant="default"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => {
            /* clipboard not available */
          },
        );
      }}
    >
      {copied ? "✓ Copied" : "Copy"}
    </Button>
  );
}

// ─── Badge Components ──────────────────────────────────────────────

function StatusBadge({ status }: { status: string | undefined }) {
  const view = agentStatusView(status);
  return <AppStatusBadge tone={view.tone}>{view.label}</AppStatusBadge>;
}

function ConnectionBadge({ connected }: { connected: boolean | null }) {
  return (
    <AppStatusBadge tone={connected === true ? "ok" : connected === false ? "error" : "neutral"}>
      {connected === true ? "● connected" : connected === false ? "○ disconnected" : "unknown"}
    </AppStatusBadge>
  );
}

function HealthBadge({ healthy }: { healthy: boolean | null }) {
  return (
    <AppStatusBadge tone={healthy === true ? "ok" : healthy === false ? "error" : "neutral"}>
      {healthy === true ? "healthy" : healthy === false ? "unhealthy" : "unknown"}
    </AppStatusBadge>
  );
}

function ConfigBadge({ sync }: { sync: ConfigSyncView }) {
  return <AppStatusBadge tone={sync.tone}>{sync.label}</AppStatusBadge>;
}

// ─── Helpers ───────────────────────────────────────────────────────

function pipelineColumns(): ColumnDef<PipelineRow>[] {
  return [
    {
      id: "category",
      header: "Type",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.category}</span>
      ),
    },
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.name}</span>,
    },
    {
      id: "health",
      header: "Health",
      cell: ({ row }) => {
        const healthy = row.original.healthy;
        return (
          <AppStatusBadge tone={healthy === true ? "ok" : healthy === false ? "error" : "neutral"}>
            {healthy === true ? "healthy" : healthy === false ? "unhealthy" : "unknown"}
          </AppStatusBadge>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <span className="text-sm">{row.original.status ?? "—"}</span>,
    },
  ];
}

function safeJsonParse(str: string): AgentDescription | null {
  try {
    return JSON.parse(str) as AgentDescription;
  } catch {
    return null;
  }
}

function tsToIso(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value > 0 ? new Date(value).toISOString() : undefined;
  return value;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
