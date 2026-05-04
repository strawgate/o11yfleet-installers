import {
  configStatsSchema,
  agentPageSchema,
  agentDetailSchema,
  type Agent,
} from "@o11yfleet/core/api";
import { typedJsonResponse } from "../shared/responses.js";
import type { AgentStateRepository, DesiredConfig } from "./agent-state-repo-interface.js";
import type {
  AgentListParams,
  AgentListResult,
  ConfigStatsResult,
  AgentDetailResult,
} from "./rpc-types.js";
import { RpcError } from "./rpc-types.js";

// ─── Data-returning cores (called by RPC methods) ────────────────

export function getStatsData(
  repo: AgentStateRepository,
  getDesiredConfig: () => DesiredConfig,
  wsCount: number,
): ConfigStatsResult {
  const stats = repo.getStats();
  const config = getDesiredConfig();
  const sweepStats = repo.getSweepStats();
  const cohort = repo.getCohortBreakdown(config.hash);
  return {
    total_agents: stats.total,
    connected_agents: wsCount,
    healthy_agents: stats.healthy,
    drifted_agents: cohort.drifted,
    status_counts: cohort.status_counts,
    current_hash_counts: cohort.current_hash_counts,
    desired_config_hash: config.hash,
    active_websockets: wsCount,
    stale_sweep: sweepStats,
  };
}

export function listAgentsData(
  repo: AgentStateRepository,
  params: AgentListParams,
): AgentListResult {
  const limit = Math.min(Math.max(Number(params.limit ?? 50) || 50, 1), 100);
  const sortParam = params.sort ?? "last_seen_desc";
  const allowedSort = new Set(["last_seen_desc", "last_seen_asc", "instance_uid_asc"]);
  const sort = allowedSort.has(sortParam)
    ? (sortParam as "last_seen_desc" | "last_seen_asc" | "instance_uid_asc")
    : "last_seen_desc";
  const status = params.status ?? undefined;
  const q = params.q ?? undefined;
  const healthParam = params.health ?? undefined;
  const health =
    healthParam === "healthy" || healthParam === "unhealthy" || healthParam === "unknown"
      ? healthParam
      : undefined;
  let cursor: { last_seen_at: number; instance_uid: string } | null = null;
  if (params.cursor) {
    try {
      const parsed = JSON.parse(atob(params.cursor)) as {
        last_seen_at?: unknown;
        instance_uid?: unknown;
      };
      if (typeof parsed.last_seen_at !== "number" || typeof parsed.instance_uid !== "string") {
        throw new RpcError("Invalid cursor", 400);
      }
      cursor = { last_seen_at: parsed.last_seen_at, instance_uid: parsed.instance_uid };
    } catch (err) {
      if (err instanceof RpcError) throw err;
      throw new RpcError("Invalid cursor", 400);
    }
  }

  const page = repo.listAgentsPage({ limit, cursor, q, status, health, sort });
  const nextCursor = page.nextCursor ? btoa(JSON.stringify(page.nextCursor)) : null;
  return {
    agents: page.agents as Agent[],
    pagination: { limit, next_cursor: nextCursor, has_more: page.hasMore, sort },
    filters: { q, status, health },
  };
}

export function getAgentData(
  repo: AgentStateRepository,
  uid: string,
  isConnected: (uid: string) => boolean,
  getDesiredConfig: () => DesiredConfig,
): AgentDetailResult | null {
  const agent = repo.getAgent(uid);
  if (!agent) return null;

  const connected = isConnected(uid);
  const desired = getDesiredConfig();
  const effectiveHash = agent["effective_config_hash"] as string | null;
  // Drift means "agent's effective config differs from desired". If the agent
  // hasn't reported an effective config yet (effectiveHash === null), we don't
  // know — that's not the same as drift. Treat null as not-drifted so the UI
  // can render an "awaiting effective report" state instead of a false alarm.
  const isDrifted =
    desired.hash !== null && effectiveHash !== null && effectiveHash !== desired.hash;
  const connectedAt = agent["connected_at"] as number | null;
  const uptimeMs = connected && connectedAt ? Date.now() - connectedAt : null;

  return {
    ...(agent as Agent),
    is_connected: connected,
    desired_config_hash: desired.hash,
    is_drifted: isDrifted,
    uptime_ms: uptimeMs,
    component_health_map: (agent as Agent).component_health_map ?? null,
    available_components: (agent as Agent).available_components ?? null,
  };
}

// ─── Response-returning wrappers (for legacy fetch dispatch) ─────
// These wrappers will be removed once all callers migrate to typed RPC methods.

export function handleGetStats(
  repo: AgentStateRepository,
  getDesiredConfig: () => DesiredConfig,
  wsCount: number,
): Response {
  const data = getStatsData(repo, getDesiredConfig, wsCount);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy wrapper, data shape matches schema
  return typedJsonResponse(configStatsSchema, data as any);
}

export function handleGetAgents(repo: AgentStateRepository, request: Request): Response {
  const url = new URL(request.url);
  try {
    const result = listAgentsData(repo, {
      limit: Number(url.searchParams.get("limit") ?? 50) || 50,
      cursor: url.searchParams.get("cursor") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      health: url.searchParams.get("health") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy wrapper, data shape matches schema
    return typedJsonResponse(agentPageSchema, result as any);
  } catch (err) {
    if (err instanceof RpcError) {
      return Response.json({ error: err.message }, { status: err.statusCode });
    }
    throw err;
  }
}

export function handleGetAgent(
  repo: AgentStateRepository,
  uid: string,
  isConnected: (uid: string) => boolean,
  getDesiredConfig: () => DesiredConfig,
): Response {
  const result = getAgentData(repo, uid, isConnected, getDesiredConfig);
  if (!result) return Response.json({ error: "Agent not found" }, { status: 404 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy wrapper, data shape matches schema
  return typedJsonResponse(agentDetailSchema, result as any);
}
