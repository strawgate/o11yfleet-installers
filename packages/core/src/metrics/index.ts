export interface ConfigMetrics {
  agent_count: number;
  connected_count: number;
  disconnected_count: number;
  healthy_count: number;
  unhealthy_count: number;
  connected_healthy_count: number;
  config_up_to_date: number;
  config_pending: number;
  agents_with_errors: number;
  agents_stale: number;
  websocket_count: number;
}

export interface AgentMetricsInput {
  status: string;
  healthy: number; // 0 or 1
  capabilities: number;
  current_config_hash: string | null; // hex string or null
  last_error: string;
  last_seen_at: number;
}

export function computeConfigMetrics(
  agents: Map<string, AgentMetricsInput>,
  desiredConfigHash: string | null,
): ConfigMetrics {
  let connected = 0,
    disconnected = 0;
  let healthy = 0,
    unhealthy = 0;
  let connected_healthy = 0;
  let config_up_to_date = 0,
    config_pending = 0;
  let agents_with_errors = 0,
    agents_stale = 0;

  const now = Date.now();
  const STALE_THRESHOLD_MS = 90_000;

  for (const agent of agents.values()) {
    switch (agent.status) {
      case "connected":
        connected++;
        break;
      case "disconnected":
        disconnected++;
        break;
      default:
        break;
    }

    if (agent.healthy) {
      healthy++;
      if (agent.status === "connected") connected_healthy++;
    } else {
      unhealthy++;
    }

    if (desiredConfigHash) {
      if (agent.current_config_hash === desiredConfigHash) {
        config_up_to_date++;
      } else {
        config_pending++;
      }
    } else if (!desiredConfigHash) {
      config_up_to_date++;
    }

    if (agent.last_error && agent.last_error !== "") {
      agents_with_errors++;
    }

    if (agent.status !== "disconnected" && agent.status !== "unknown") {
      const lastSeenAge = now - agent.last_seen_at;
      if (lastSeenAge > STALE_THRESHOLD_MS) {
        agents_stale++;
      }
    }
  }

  return {
    agent_count: agents.size,
    connected_count: connected,
    disconnected_count: disconnected,
    healthy_count: healthy,
    unhealthy_count: unhealthy,
    connected_healthy_count: connected_healthy,
    config_up_to_date,
    config_pending,
    agents_with_errors,
    agents_stale,
    websocket_count: 0, // set by caller
  };
}

export function configMetricsToDoubles(m: ConfigMetrics): number[] {
  return [
    m.agent_count,
    m.connected_count,
    m.disconnected_count,
    m.healthy_count,
    m.unhealthy_count,
    m.connected_healthy_count,
    m.config_up_to_date,
    m.config_pending,
    m.agents_with_errors,
    m.agents_stale,
    m.websocket_count,
  ];
}

export * from "./queries.js";
