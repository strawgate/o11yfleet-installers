import { useState, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useConfiguration,
  useAgentDetail,
  useConfigurationStats,
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
import { Title } from "@mantine/core";
import { Button } from "@/components/ui/button";
import type { AiGuidanceRequest } from "@o11yfleet/core/ai";

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

      {/* Tabs */}
      <div
        className="mt-6 flex flex-wrap gap-2 border-b border-border"
        role="tablist"
        aria-label="Agent detail sections"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "overview"}
          aria-controls="agent-tab-overview"
          className={tabClassName(tab === "overview")}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "pipeline"}
          aria-controls="agent-tab-pipeline"
          className={tabClassName(tab === "pipeline")}
          onClick={() => setTab("pipeline")}
        >
          Pipeline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "config"}
          aria-controls="agent-tab-config"
          className={tabClassName(tab === "config")}
          onClick={() => setTab("config")}
        >
          Configuration
        </button>
      </div>

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
      <div className="card card-pad">
        <h3 className="card-title">Identity</h3>
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
      </div>

      {/* Health card */}
      <div className="card card-pad">
        <h3 className="card-title">Health</h3>
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
      </div>

      {/* Configuration card */}
      <div className="card card-pad">
        <h3 className="card-title">Configuration</h3>
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
      </div>

      {/* Capabilities card */}
      <div className="card card-pad">
        <h3 className="card-title">Capabilities</h3>
        {capabilities.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {capabilities.map((cap) => (
              <span key={cap} className="tag">
                {cap}
              </span>
            ))}
          </div>
        ) : (
          <p className="meta mt-2">No capabilities reported</p>
        )}
      </div>
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
      <div className="card card-pad">
        <h3 className="card-title mb-3">Pipeline Flow</h3>
        {topology.pipelines.length === 0 ? (
          <p className="meta">No pipelines defined in service configuration.</p>
        ) : (
          <div className="space-y-4">
            {topology.pipelines.map((pipeline) => (
              <div key={pipeline.name} className="pipeline-row">
                <div className="pipeline-label">{pipeline.name}</div>
                <div className="pipeline-flow">
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Extensions */}
      {topology.extensions.length > 0 && (
        <div className="card card-pad">
          <h3 className="card-title mb-3">Extensions</h3>
          <div className="flex flex-wrap gap-2">
            {topology.extensions.map((ext) => (
              <ComponentChip key={ext.name ?? ext.type} component={ext} />
            ))}
          </div>
        </div>
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
    <div className="pipeline-group">
      <div className="pipeline-group-label">{label}</div>
      <div className="pipeline-group-items">
        {matched.map((c) => (
          <ComponentChip key={c.name ?? c.type} component={c} />
        ))}
      </div>
    </div>
  );
}

function ComponentChip({ component }: { component: PipelineComponent }) {
  return (
    <div
      className={`component-chip ${
        component.healthy === false
          ? "component-chip-err"
          : component.healthy === true
            ? "component-chip-ok"
            : ""
      }`}
      title={component.lastError ?? component.status ?? component.type}
    >
      <ComponentHealthDot healthy={component.healthy} />
      <span>{component.type}</span>
    </div>
  );
}

function ComponentHealthDot({ healthy }: { healthy: boolean | null }) {
  if (healthy === true) return <span className="health-dot health-dot-ok" />;
  if (healthy === false) return <span className="health-dot health-dot-err" />;
  return <span className="health-dot health-dot-unknown" />;
}

function PipelineArrow() {
  return <div className="pipeline-arrow">→</div>;
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
      <div className="card card-pad">
        <div className="flex items-center justify-between mb-3">
          <h3 className="card-title">Effective Configuration</h3>
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
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
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

function tabClassName(active: boolean): string {
  return `border-b-2 px-3 py-2 text-sm font-medium ${
    active
      ? "border-primary text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground"
  }`;
}

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
