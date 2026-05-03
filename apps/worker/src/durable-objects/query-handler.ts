import {
  configStatsSchema,
  agentPageSchema,
  agentDetailSchema,
  type Agent,
} from "@o11yfleet/core/api";
import { typedJsonResponse } from "../shared/responses.js";
import type { AgentStateRepository, DesiredConfig } from "./agent-state-repo-interface.js";

export function handleGetStats(
  repo: AgentStateRepository,
  getDesiredConfig: () => DesiredConfig,
  wsCount: number,
): Response {
  const stats = repo.getStats();
  const config = getDesiredConfig();
  const sweepStats = repo.getSweepStats();
  const cohort = repo.getCohortBreakdown(config.hash);
  return typedJsonResponse(configStatsSchema, {
    total_agents: stats.total,
    connected_agents: wsCount, // authoritative: live WebSocket count, not SQL
    healthy_agents: stats.healthy,
    drifted_agents: cohort.drifted,
    status_counts: cohort.status_counts,
    current_hash_counts: cohort.current_hash_counts,
    desired_config_hash: config.hash,
    active_websockets: wsCount,
    stale_sweep: sweepStats,
  });
}

export function handleGetAgents(repo: AgentStateRepository, request: Request): Response {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
  const sortParam = url.searchParams.get("sort") ?? "last_seen_desc";
  const allowedSort = new Set(["last_seen_desc", "last_seen_asc", "instance_uid_asc"]);
  const sort = allowedSort.has(sortParam)
    ? (sortParam as "last_seen_desc" | "last_seen_asc" | "instance_uid_asc")
    : "last_seen_desc";
  const status = url.searchParams.get("status") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const healthParam = url.searchParams.get("health") ?? undefined;
  const health =
    healthParam === "healthy" || healthParam === "unhealthy" || healthParam === "unknown"
      ? healthParam
      : undefined;
  let cursor: { last_seen_at: number; instance_uid: string } | null = null;
  const cursorRaw = url.searchParams.get("cursor");
  if (cursorRaw) {
    try {
      const parsed = JSON.parse(atob(cursorRaw)) as {
        last_seen_at?: unknown;
        instance_uid?: unknown;
      };
      if (typeof parsed.last_seen_at !== "number" || typeof parsed.instance_uid !== "string") {
        return Response.json({ error: "Invalid cursor" }, { status: 400 });
      }
      cursor = { last_seen_at: parsed.last_seen_at, instance_uid: parsed.instance_uid };
    } catch {
      return Response.json({ error: "Invalid cursor" }, { status: 400 });
    }
  }

  const page = repo.listAgentsPage({ limit, cursor, q, status, health, sort });
  const nextCursor = page.nextCursor ? btoa(JSON.stringify(page.nextCursor)) : null;
  return typedJsonResponse(agentPageSchema, {
    agents: page.agents as Agent[],
    pagination: { limit, next_cursor: nextCursor, has_more: page.hasMore, sort },
    filters: { q, status, health },
  });
}

export function handleGetAgent(
  repo: AgentStateRepository,
  uid: string,
  isConnected: (uid: string) => boolean,
  getDesiredConfig: () => DesiredConfig,
): Response {
  const agent = repo.getAgent(uid);
  if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });

  // Enrich with live connection status — O(1) tag lookup
  const connected = isConnected(uid);

  // Desired config for drift detection
  const desired = getDesiredConfig();
  const effectiveHash = agent["effective_config_hash"] as string | null;
  const isDrifted = desired.hash !== null && effectiveHash !== desired.hash;

  // Uptime: time since connected_at (if currently connected)
  const connectedAt = agent["connected_at"] as number | null;
  const uptimeMs = connected && connectedAt ? Date.now() - connectedAt : null;

  return typedJsonResponse(agentDetailSchema, {
    ...(agent as Agent),
    is_connected: connected,
    desired_config_hash: desired.hash,
    is_drifted: isDrifted,
    uptime_ms: uptimeMs,
    component_health_map: (agent as Agent).component_health_map ?? null,
    available_components: (agent as Agent).available_components ?? null,
  });
}
