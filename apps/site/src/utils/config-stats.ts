import type { Agent, ConfigStats } from "../api/hooks/portal";
import { agentHasDrift, agentIsHealthy } from "./agents";

export interface ConfigurationAgentMetrics {
  totalAgents: number;
  visibleAgents: number;
  connectedAgents: number;
  healthyAgents: number;
  degradedAgents: number;
  driftedAgents: number;
  activeWebSockets?: number;
  desiredConfigHash: string | null;
}

export interface ConfigurationAgentSnapshotMetrics {
  hasSnapshotStats: boolean;
  totalAgents: number | null;
  connectedAgents: number | null;
  healthyAgents: number | null;
  degradedAgents: number | null;
  driftedAgents: number | null;
  activeWebSockets: number | null;
  desiredConfigHash: string | null;
  hasDegradedStats: boolean;
  hasDriftStats: boolean;
}

export function configurationAgentMetrics(
  stats: ConfigStats | undefined,
  visibleAgents: Agent[],
  fallbackDesiredConfigHash?: string | null,
): ConfigurationAgentMetrics {
  const desiredConfigHash = stats?.desired_config_hash ?? fallbackDesiredConfigHash ?? null;
  const visible = visibleAgentMetrics(visibleAgents, desiredConfigHash);
  const hasSnapshot = stats !== undefined;

  return {
    totalAgents: numberOr(stats?.total_agents, visible.totalAgents),
    visibleAgents: visible.visibleAgents,
    connectedAgents: numberOr(stats?.connected_agents, visible.connectedAgents),
    healthyAgents: numberOr(stats?.healthy_agents, visible.healthyAgents),
    degradedAgents: hasSnapshot
      ? numberOr(stats?.status_counts?.["degraded"], 0)
      : visible.degradedAgents,
    driftedAgents: hasSnapshot ? numberOr(stats?.drifted_agents, 0) : visible.driftedAgents,
    activeWebSockets: stats?.active_websockets,
    desiredConfigHash,
  };
}

export function configurationAgentSnapshotMetrics(
  stats: ConfigStats | undefined,
  fallbackDesiredConfigHash?: string | null,
): ConfigurationAgentSnapshotMetrics {
  const hasSnapshotStats = Boolean(stats);
  const desiredConfigHash = stats?.desired_config_hash ?? fallbackDesiredConfigHash ?? null;
  const degradedAgents = numberOrNull(stats?.status_counts?.["degraded"]);
  const driftedAgents = numberOrNull(stats?.drifted_agents);

  return {
    hasSnapshotStats,
    totalAgents: numberOrNull(stats?.total_agents),
    connectedAgents: numberOrNull(stats?.connected_agents),
    healthyAgents: numberOrNull(stats?.healthy_agents),
    degradedAgents,
    driftedAgents,
    activeWebSockets: numberOrNull(stats?.active_websockets),
    desiredConfigHash,
    hasDegradedStats: degradedAgents !== null,
    hasDriftStats: driftedAgents !== null,
  };
}

function visibleAgentMetrics(
  agents: Agent[],
  desiredConfigHash: string | null,
): Omit<ConfigurationAgentMetrics, "activeWebSockets" | "desiredConfigHash"> {
  let connectedAgents = 0;
  let healthyAgents = 0;
  let degradedAgents = 0;
  let driftedAgents = 0;

  for (const agent of agents) {
    if (agent.status === "connected") connectedAgents += 1;
    if (agent.status === "degraded") degradedAgents += 1;
    if (agentIsHealthy(agent) === true) healthyAgents += 1;
    if (agentHasDrift(agent, desiredConfigHash)) driftedAgents += 1;
  }

  return {
    totalAgents: agents.length,
    visibleAgents: agents.length,
    connectedAgents,
    healthyAgents,
    degradedAgents,
    driftedAgents,
  };
}

function numberOr(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
