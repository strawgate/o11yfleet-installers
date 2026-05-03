import type { AgentDetail } from "@/api/hooks/portal";
import { agentAcceptsRemoteConfig } from "@/utils/agents";
import type { AiGuidanceTarget } from "@o11yfleet/core/ai";
import { insightSurfaces, insightTarget } from "@/ai/insight-registry";
import {
  buildBrowserPageContext,
  pageDetail,
  pageMetric,
  pageTable,
  pageYaml,
} from "@/ai/page-context";
import type {
  AgentIdentity,
  ComponentHealthEntry,
  PipelineComponent,
  PipelineTopology,
} from "@/utils/pipeline";

export type AgentDetailTab = "overview" | "pipeline" | "config";

export type ConfigSyncView = {
  label: string;
  tone: "neutral" | "ok" | "warn" | "error";
};

export type ComponentSummary = {
  total: number;
  healthy: number;
  degraded: number;
};

export type PipelineRow = {
  category: "receiver" | "processor" | "exporter" | "extension";
  name: string;
  healthy: boolean | null;
  status: string | null;
};

export type AgentDetailModel = {
  desiredHash: string | undefined;
  currentHash: string | null | undefined;
  healthy: boolean | null;
  acceptsRemoteConfig: boolean;
  drift: boolean;
  isConnected: boolean | null;
  hostname: string;
  /** Human-readable capability names for display. */
  capabilities: string[];
  /** Raw capability bitmask. Use this for gating actions (e.g.
   *  `(capabilitiesBits & AgentCapabilities.AcceptsRestartCommand) !== 0`)
   *  instead of `.includes("AcceptsRestartCommand")` so a future rename
   *  in the display-name table doesn't silently disable the action. */
  capabilitiesBits: number;
  componentCounts: ComponentSummary;
  configSync: ConfigSyncView;
  guidanceContext: Record<string, unknown>;
  pageContext: ReturnType<typeof buildBrowserPageContext>;
};

export function buildAgentDetailGuidanceTargets({
  agent,
  tab,
  healthy,
  isConnected,
  componentCounts,
  configSync,
  acceptsRemoteConfig,
  topology,
}: {
  agent: AgentDetail | null;
  tab: AgentDetailTab;
  healthy: boolean | null;
  isConnected: boolean | null;
  componentCounts: ComponentSummary;
  configSync: ConfigSyncView;
  acceptsRemoteConfig: boolean;
  topology: PipelineTopology | null;
}): AiGuidanceTarget[] {
  const surface = insightSurfaces.portalAgent;
  const targets = [
    insightTarget(surface, surface.targets.page),
    insightTarget(surface, surface.targets.health, {
      healthy,
      connected: isConnected,
      component_count: componentCounts.total,
      degraded_components: componentCounts.degraded,
    }),
    insightTarget(surface, surface.targets.configuration, {
      config_sync: configSync.label,
      accepts_remote_config: acceptsRemoteConfig,
    }),
  ];

  if (tab === "pipeline") {
    targets.push(
      insightTarget(surface, surface.targets.pipeline, {
        pipelines: topology?.pipelines.length ?? 0,
        components: componentCounts.total,
      }),
    );
  }

  if (tab === "config") {
    targets.push(
      insightTarget(surface, surface.targets.effectiveConfig, {
        effective_config_available: Boolean(agent?.effective_config_body),
      }),
    );
  }

  return targets;
}

export function buildAgentDetailModel({
  agent,
  agentUid,
  configId,
  configurationName,
  configCurrentHash,
  statsDesiredHash,
  identity,
  topology,
  tab,
}: {
  agent: AgentDetail | null;
  agentUid: string | undefined;
  configId: string | undefined;
  configurationName: string | undefined;
  configCurrentHash: string | undefined;
  statsDesiredHash: string | undefined;
  identity: AgentIdentity;
  topology: PipelineTopology | null;
  tab: AgentDetailTab;
}): AgentDetailModel {
  const desiredHash = agent?.desired_config_hash ?? statsDesiredHash ?? configCurrentHash;
  const currentHash = agent?.current_config_hash;
  const healthy = agentHealthy(agent);
  const acceptsRemoteConfig = agentAcceptsRemoteConfig(agent);
  const hasReportedDriftState = agent?.is_drifted !== null && agent?.is_drifted !== undefined;
  const hasComparableConfigHashes =
    currentHash !== null &&
    currentHash !== undefined &&
    desiredHash !== null &&
    desiredHash !== undefined;
  const hasConfigSyncSignal =
    Boolean(agent) && acceptsRemoteConfig && (hasReportedDriftState || hasComparableConfigHashes);
  const drift =
    agent && acceptsRemoteConfig && hasConfigSyncSignal
      ? Boolean(agent.is_drifted ?? currentHash !== desiredHash)
      : false;
  const isConnected = agentConnection(agent);
  const hostname = identity.hostname ?? agent?.hostname ?? agentUid ?? "Agent";
  const capabilitiesBits = (agent?.capabilities as number | null) ?? 0;
  const capabilities = parseCapabilities(capabilitiesBits);
  const componentCounts = componentSummary(agent, topology);
  const configSync = configSyncView({
    drift,
    currentHash,
    acceptsRemoteConfig,
    hasSyncSignal: hasConfigSyncSignal,
  });
  const degradedAgents = healthy === false || agent?.status === "degraded" ? 1 : 0;
  const connectedAgents = isConnected === true ? 1 : isConnected === false ? 0 : null;
  const healthyAgents = healthy === true ? 1 : healthy === false ? 0 : null;

  const pageContext = buildBrowserPageContext({
    title: `${hostname} collector`,
    active_tab: tab,
    visible_text: [
      "Agent detail separates connectivity, runtime health, config sync, effective configuration, and pipeline component health.",
    ],
    metrics: [
      pageMetric("total_agents", "Total collectors", 1),
      pageMetric("connected_agents", "Connected collectors", connectedAgents),
      pageMetric("healthy_agents", "Healthy collectors", healthyAgents),
      pageMetric("degraded_agents", "Degraded collectors", degradedAgents),
      pageMetric(
        "drifted_agents",
        "Drifted collectors",
        hasConfigSyncSignal ? (drift ? 1 : 0) : null,
      ),
      pageMetric("pipeline_components", "Pipeline components", componentCounts.total),
      pageMetric("degraded_components", "Degraded components", componentCounts.degraded),
    ],
    details: [
      pageDetail("configuration_id", "Configuration ID", configId ?? null),
      pageDetail("configuration_name", "Configuration name", configurationName ?? configId ?? null),
      pageDetail("agent_uid", "Agent UID", agentUid ?? null),
      pageDetail("hostname", "Hostname", hostname),
      pageDetail("service_name", "Service name", identity.serviceName ?? null),
      pageDetail("status", "Status", (agent?.status as string | undefined) ?? null),
      pageDetail("healthy", "Healthy", healthy),
      pageDetail("connected", "Connected", isConnected),
      pageDetail("config_sync", "Config sync", configSync.label),
      pageDetail("desired_config_hash", "Desired config hash", desiredHash ?? null),
      pageDetail("current_config_hash", "Current config hash", currentHash ?? null),
      ...(tab !== "pipeline"
        ? [
            pageDetail(
              "effective_config_hash",
              "Effective config hash",
              (agent?.effective_config_hash as string | undefined) ?? null,
            ),
          ]
        : []),
      ...(tab === "overview"
        ? [
            pageDetail(
              "last_error",
              "Last error",
              (agent?.last_error as string | undefined) || null,
            ),
          ]
        : []),
    ],
    tables:
      tab === "pipeline" && topology
        ? [
            pageTable("pipeline_components", "Pipeline components", pipelineRows(topology), {
              totalRows: componentCounts.total,
              maxRows: 50,
            }),
          ]
        : [],
    yaml:
      tab === "config" && typeof agent?.effective_config_body === "string"
        ? pageYaml("Effective collector configuration", agent.effective_config_body)
        : undefined,
  });

  return {
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
    guidanceContext: {
      configuration_id: configId ?? null,
      configuration_name: configurationName ?? configId ?? null,
      agent_uid: agentUid ?? null,
      hostname,
      status: agent?.status ?? null,
      healthy,
      connected: isConnected,
      config_sync: configSync.label,
      accepts_remote_config: acceptsRemoteConfig,
      desired_config_hash: desiredHash ?? null,
      current_config_hash: currentHash ?? null,
      effective_config_hash: (agent?.effective_config_hash as string | undefined) ?? null,
      total_agents: 1,
      connected_agents: connectedAgents,
      healthy_agents: healthyAgents,
      degraded_agents: degradedAgents,
      drifted_agents: hasConfigSyncSignal ? (drift ? 1 : 0) : null,
      pipeline_components: componentCounts.total,
      degraded_components: componentCounts.degraded,
      active_tab: tab,
    },
    pageContext,
  };
}

export function agentHealthy(agent: AgentDetail | null): boolean | null {
  if (agent?.healthy === true || agent?.healthy === 1) return true;
  if (agent?.healthy === false || agent?.healthy === 0) return false;
  return null;
}

export function agentConnection(agent: AgentDetail | null): boolean | null {
  if (!agent) return null;
  if (agent.is_connected === true) return true;
  if (agent.is_connected === false) return false;
  return null;
}

export function configSyncView({
  drift,
  currentHash,
  acceptsRemoteConfig,
  hasSyncSignal,
}: {
  drift: boolean;
  currentHash: string | null | undefined;
  acceptsRemoteConfig: boolean;
  hasSyncSignal: boolean;
}): ConfigSyncView {
  if (!acceptsRemoteConfig) return { label: "n/a", tone: "neutral" };
  if (!hasSyncSignal) return { label: "not reported", tone: "neutral" };
  if (drift) return { label: "config drift", tone: "warn" };
  if (currentHash) return { label: "in sync", tone: "ok" };
  return { label: "not reported", tone: "neutral" };
}

export function componentSummary(
  agent: AgentDetail | null,
  topology: PipelineTopology | null,
): ComponentSummary {
  const healthMap = agent?.component_health_map as Record<string, ComponentHealthEntry> | null;
  if (topology) {
    const all = pipelineComponents(topology);
    return {
      total: all.length,
      healthy: all.filter((component) => component.healthy === true).length,
      degraded: all.filter((component) => component.healthy === false).length,
    };
  }
  if (healthMap) return countLeaves(healthMap);
  return { total: 0, healthy: 0, degraded: 0 };
}

export function countLeaves(map: Record<string, ComponentHealthEntry>): ComponentSummary {
  let total = 0;
  let healthy = 0;
  let degraded = 0;
  for (const entry of Object.values(map)) {
    if (entry.component_health_map && Object.keys(entry.component_health_map).length > 0) {
      const sub = countLeaves(entry.component_health_map);
      total += sub.total;
      healthy += sub.healthy;
      degraded += sub.degraded;
    } else {
      total++;
      if (entry.healthy === true) healthy++;
      else if (entry.healthy === false) degraded++;
    }
  }
  return { total, healthy, degraded };
}

export function pipelineComponents(
  topology: PipelineTopology,
): Array<PipelineComponent & { category: PipelineRow["category"] }> {
  return [
    ...topology.receivers.map((component) => ({ ...component, category: "receiver" as const })),
    ...topology.processors.map((component) => ({ ...component, category: "processor" as const })),
    ...topology.exporters.map((component) => ({ ...component, category: "exporter" as const })),
    ...topology.extensions.map((component) => ({ ...component, category: "extension" as const })),
  ];
}

export function pipelineRows(topology: PipelineTopology): PipelineRow[] {
  return pipelineComponents(topology).map((component) => ({
    category: component.category,
    name: component.name,
    healthy: component.healthy,
    status: component.status ?? component.lastError ?? null,
  }));
}

export const CAPABILITY_NAMES: Record<number, string> = {
  0x01: "ReportsStatus",
  0x02: "AcceptsRemoteConfig",
  0x04: "ReportsEffectiveConfig",
  0x08: "AcceptsPackages",
  0x10: "ReportsPackageStatuses",
  0x20: "ReportsOwnTraces",
  0x40: "ReportsOwnMetrics",
  0x80: "ReportsOwnLogs",
  0x100: "AcceptsOpAMPConnectionSettings",
  0x200: "AcceptsOtherConnectionSettings",
  0x400: "AcceptsRestartCommand",
  0x800: "ReportsHealth",
  0x1000: "ReportsRemoteConfig",
  0x2000: "ReportsHeartbeat",
  0x4000: "ReportsAvailableComponents",
};

export function parseCapabilities(caps: number | null): string[] {
  if (caps === null || caps === 0) return [];
  const result: string[] = [];
  for (const [bit, name] of Object.entries(CAPABILITY_NAMES)) {
    if (caps & Number(bit)) result.push(name);
  }
  return result;
}
