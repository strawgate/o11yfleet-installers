import type { Agent, ConfigStats, Configuration } from "@/api/hooks/portal";
import { buildBrowserPageContext, pageDetail, pageMetric, pageTable } from "@/ai/page-context";
import { agentHost, agentLastSeen, agentUid } from "@/utils/agents";
import { configurationAgentSnapshotMetrics } from "@/utils/config-stats";
import { agentHealthView, agentSyncView } from "./agent-view-model";

export type AgentSectionModel = {
  agents: Agent[];
  desiredHash: string | null;
  totalAgents: number | null;
  connectedAgents: number | null;
  healthyAgents: number | null;
  degradedAgents: number | null;
  driftedAgents: number | null;
  visibleAgents: number;
  hasSnapshotStats: boolean;
  hasDegradedStats: boolean;
  hasDriftStats: boolean;
  shouldRequestGuidance: boolean;
  guidanceContext: Record<string, unknown>;
  pageContext: ReturnType<typeof buildBrowserPageContext> | null;
};

export function buildAgentSectionModel({
  config,
  agents,
  stats,
  filter,
  expanded,
  isLoading,
  hasError,
  aggregateStatsReady,
}: {
  config: Configuration;
  agents: Agent[];
  stats: ConfigStats | undefined;
  filter: string;
  expanded: boolean;
  isLoading: boolean;
  hasError: boolean;
  aggregateStatsReady: boolean;
}): AgentSectionModel {
  const fallbackHash = config.current_config_hash ?? undefined;
  const snapshot = configurationAgentSnapshotMetrics(stats, fallbackHash);
  const desiredHash = snapshot.desiredConfigHash;
  const totalAgents = snapshot.totalAgents;
  const connectedAgents = snapshot.connectedAgents;
  const healthyAgents = snapshot.healthyAgents;
  const degradedAgents = snapshot.degradedAgents;
  const driftedAgents = snapshot.driftedAgents;
  const visibleAgents = agents.length;
  const hasSnapshotStats = snapshot.hasSnapshotStats;
  const hasDegradedStats = snapshot.hasDegradedStats;
  const hasDriftStats = snapshot.hasDriftStats;
  const shouldRequestGuidance = hasMaterialAgentGuidanceSignal({
    totalAgents,
    connectedAgents,
    degradedAgents,
    driftedAgents,
  });

  const guidanceContext = {
    configuration_id: config.id,
    configuration_name: config.name,
    total_agents: totalAgents,
    visible_agents: visibleAgents,
    visible_agents_scope: "current paginated result page",
    connected_agents: connectedAgents,
    healthy_agents: healthyAgents,
    degraded_agents: degradedAgents,
    drifted_agents: driftedAgents,
    agents: agents.slice(0, 12).map((agent) => ({
      id: agentUid(agent),
      hostname: agentHost(agent),
      status: agent.status ?? null,
      last_seen: agentLastSeen(agent) ?? null,
    })),
  };

  const pageContext =
    expanded && !hasError && !isLoading && aggregateStatsReady
      ? buildBrowserPageContext({
          title: `${config.name} collectors`,
          filters: filter ? { search: filter } : undefined,
          visible_text: [
            "Status is connectivity; health is collector runtime state; drift is config hash mismatch.",
          ],
          metrics: [
            pageMetric("total_agents", "Total collectors", totalAgents),
            pageMetric("visible_agents", "Visible collectors", agents.length),
            pageMetric("connected_agents", "Connected collectors", connectedAgents),
            pageMetric("healthy_agents", "Healthy collectors", healthyAgents),
            pageMetric("degraded_agents", "Degraded collectors", degradedAgents),
            pageMetric("drifted_agents", "Drifted collectors", driftedAgents),
          ],
          details: [
            pageDetail("configuration_id", "Configuration ID", config.id),
            pageDetail("configuration_name", "Configuration name", config.name),
            pageDetail("desired_config_hash", "Desired config hash", desiredHash ?? null),
            pageDetail(
              "visible_agents_scope",
              "Visible collectors scope",
              "Current paginated result page",
            ),
          ],
          tables: [
            pageTable(
              "agents",
              "Visible collectors",
              agents.map((agent) => {
                const health = agentHealthView(agent);
                const sync = agentSyncView(agent, desiredHash);
                return {
                  id: agentUid(agent),
                  hostname: agentHost(agent),
                  status: agent.status ?? null,
                  health: health.label,
                  config_sync: sync.label,
                  current_hash: sync.hashLabel,
                  last_seen: agentLastSeen(agent) ?? null,
                };
              }),
              { totalRows: agents.length, maxRows: 20 },
            ),
          ],
        })
      : null;

  return {
    agents,
    desiredHash,
    totalAgents,
    connectedAgents,
    healthyAgents,
    degradedAgents,
    driftedAgents,
    visibleAgents,
    hasSnapshotStats,
    hasDegradedStats,
    hasDriftStats,
    shouldRequestGuidance,
    guidanceContext,
    pageContext,
  };
}

export function hasMaterialAgentGuidanceSignal(input: {
  totalAgents: number | null;
  connectedAgents: number | null;
  degradedAgents: number | null;
  driftedAgents: number | null;
}): boolean {
  if (input.totalAgents === null || input.connectedAgents === null) return false;
  if (input.totalAgents < 5) return false;
  const disconnectedAgents = Math.max(input.totalAgents - input.connectedAgents, 0);
  return (
    hasMaterialShare(disconnectedAgents, input.totalAgents, 0.5) ||
    hasMaterialShare(input.degradedAgents ?? 0, input.totalAgents, 0.25) ||
    hasMaterialShare(input.driftedAgents ?? 0, input.totalAgents, 0.25)
  );
}

function hasMaterialShare(affected: number, total: number, ratio: number): boolean {
  return affected >= 3 && affected / Math.max(total, 1) >= ratio;
}
