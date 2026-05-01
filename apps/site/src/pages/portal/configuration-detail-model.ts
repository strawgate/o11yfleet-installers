import type {
  Agent,
  ConfigStats,
  Configuration,
  ConfigVersion,
  EnrollmentToken,
} from "@/api/hooks/portal";
import {
  buildBrowserPageContext,
  pageDetail,
  pageMetric,
  pageTable,
  pageYaml,
} from "@/ai/page-context";
import { agentHost, agentLastSeen, agentUid } from "@/utils/agents";
import { configurationAgentSnapshotMetrics } from "@/utils/config-stats";
import type { AiLightFetch } from "@o11yfleet/core/ai";
import { agentHealthView, agentSyncView } from "./agent-view-model";

export type ConfigurationDetailTab = "agents" | "versions" | "rollout" | "yaml" | "settings";

export type ConfigurationDetailModel = {
  hasSnapshotStats: boolean;
  connectedAgents: number | null;
  totalAgents: number | null;
  healthyAgents: number | null;
  activeWebSockets: number | null;
  desiredHash: string | null;
  driftedAgents: number | null;
  pageContext: ReturnType<typeof buildBrowserPageContext>;
  guidanceContext: Record<string, unknown>;
};

export function buildConfigurationDetailModel({
  configuration,
  activeTab,
  agents,
  versions,
  tokens,
  stats,
  yaml,
  includeYaml = false,
  lightFetches = [],
}: {
  configuration: Configuration;
  activeTab: ConfigurationDetailTab;
  agents: Agent[];
  versions: ConfigVersion[];
  tokens: EnrollmentToken[];
  stats: ConfigStats | undefined;
  yaml: string | undefined;
  includeYaml?: boolean;
  lightFetches?: AiLightFetch[];
}): ConfigurationDetailModel {
  const snapshot = configurationAgentSnapshotMetrics(stats, configuration.current_config_hash);
  const connectedAgents = snapshot.connectedAgents;
  const totalAgents = snapshot.totalAgents;
  const healthyAgents = snapshot.healthyAgents;
  const activeWebSockets = snapshot.activeWebSockets;
  const desiredHash = snapshot.desiredConfigHash;
  const driftedAgents = snapshot.driftedAgents;
  const latestVersion = latestConfigVersion(versions);

  const pageContext = buildBrowserPageContext({
    title: `Configuration: ${configuration.name}`,
    active_tab: activeTab,
    visible_text: [
      "Configuration detail shows rollout state, collector health, version history, enrollment tokens, and YAML.",
    ],
    metrics: [
      pageMetric("total_agents", "Total collectors", totalAgents),
      pageMetric("connected_agents", "Connected collectors", connectedAgents),
      pageMetric("healthy_agents", "Healthy collectors", healthyAgents),
      pageMetric("drifted_agents", "Drifted collectors", driftedAgents),
      pageMetric("versions", "Versions", versions.length),
      pageMetric("total_active_tokens", "Active enrollment tokens", tokens.length),
    ],
    details: [
      pageDetail("configuration_id", "Configuration ID", configuration.id),
      pageDetail("configuration_name", "Configuration name", configuration.name),
      pageDetail("status", "Status", configuration.status ?? null),
      pageDetail("desired_config_hash", "Desired config hash", desiredHash),
      pageDetail("latest_version_created_at", "Latest version", latestVersion?.created_at ?? null),
    ],
    tables: [
      ...(activeTab === "agents"
        ? [
            pageTable(
              "agents",
              "Collectors",
              agents.slice(0, 20).map((agent) => ({
                id: agentUid(agent),
                hostname: agentHost(agent),
                status: agent.status ?? null,
                health: agentHealthView(agent).label,
                config_sync: agentSyncView(agent, desiredHash).label,
                last_seen: agentLastSeen(agent) ?? null,
              })),
              { totalRows: agents.length },
            ),
          ]
        : []),
      ...(activeTab === "versions"
        ? [
            pageTable(
              "versions",
              "Versions",
              versions.slice(0, 10).map((version) => ({
                id: version.id,
                version: version.version,
                hash: version.config_hash ?? null,
                created_at: version.created_at,
                size_bytes: version.size_bytes ?? null,
              })),
              { totalRows: versions.length },
            ),
          ]
        : []),
    ],
    yaml: includeYaml && yaml ? pageYaml("Current configuration YAML", yaml) : undefined,
    light_fetches: lightFetches,
  });

  return {
    hasSnapshotStats: snapshot.hasSnapshotStats,
    connectedAgents,
    totalAgents,
    healthyAgents,
    activeWebSockets,
    desiredHash,
    driftedAgents,
    pageContext,
    guidanceContext: {
      configuration_id: configuration.id,
      configuration_name: configuration.name,
      status: configuration.status ?? null,
      active_tab: activeTab,
      total_agents: totalAgents,
      connected_agents: connectedAgents,
      healthy_agents: healthyAgents,
      drifted_agents: driftedAgents,
      active_websockets: activeWebSockets ?? null,
      desired_config_hash: desiredHash,
      versions: versions.length,
      total_active_tokens: tokens.length,
      latest_version_created_at: latestVersion?.created_at ?? null,
      yaml_available: Boolean(yaml),
    },
  };
}

export function latestConfigVersion(versions: ConfigVersion[]): ConfigVersion | undefined {
  return versions.reduce<ConfigVersion | undefined>((latest, version) => {
    if (!latest) return version;
    const versionTime = timestampMs(version.created_at);
    const latestTime = timestampMs(latest.created_at);
    if (versionTime !== latestTime) return versionTime > latestTime ? version : latest;
    return Number(version.version ?? 0) > Number(latest.version ?? 0) ? version : latest;
  }, undefined);
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
