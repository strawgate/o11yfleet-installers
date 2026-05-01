import assert from "node:assert/strict";
import { test } from "node:test";
import { configurationAgentMetrics } from "../src/utils/config-stats";
import type { Agent, ConfigStats } from "../src/api/hooks/portal";

test("prefers server configuration stats over the visible agents page", () => {
  const visibleAgents: Agent[] = [
    { instance_uid: "agent-1", status: "connected", healthy: true },
    { instance_uid: "agent-2", status: "degraded", healthy: false },
  ];
  const stats: ConfigStats = {
    total_agents: 200,
    connected_agents: 175,
    healthy_agents: 160,
    drifted_agents: 12,
    status_counts: { degraded: 8 },
    active_websockets: 170,
    desired_config_hash: "abc123",
  };

  assert.deepEqual(configurationAgentMetrics(stats, visibleAgents, "fallback"), {
    totalAgents: 200,
    visibleAgents: 2,
    connectedAgents: 175,
    healthyAgents: 160,
    degradedAgents: 8,
    driftedAgents: 12,
    activeWebSockets: 170,
    desiredConfigHash: "abc123",
  });
});

test("falls back to visible agents when server stats are unavailable", () => {
  const visibleAgents: Agent[] = [
    {
      instance_uid: "agent-1",
      status: "connected",
      healthy: true,
      current_config_hash: "desired",
    },
    {
      instance_uid: "agent-2",
      status: "degraded",
      healthy: false,
      current_config_hash: "old",
    },
    { instance_uid: "agent-3", status: "disconnected", healthy: 0 },
  ];

  assert.deepEqual(configurationAgentMetrics(undefined, visibleAgents, "desired"), {
    totalAgents: 3,
    visibleAgents: 3,
    connectedAgents: 1,
    healthyAgents: 1,
    degradedAgents: 1,
    driftedAgents: 1,
    activeWebSockets: undefined,
    desiredConfigHash: "desired",
  });
});

test("does not synthesize missing snapshot drift fields from visible rows", () => {
  const visibleAgents: Agent[] = [
    {
      instance_uid: "agent-1",
      status: "degraded",
      healthy: false,
      current_config_hash: "old",
    },
  ];

  const metrics = configurationAgentMetrics(
    { total_agents: 100, connected_agents: 90, healthy_agents: 80 },
    visibleAgents,
    "desired",
  );

  assert.equal(metrics.degradedAgents, 0);
  assert.equal(metrics.driftedAgents, 0);
});

test("uses canonical connected_agents field", () => {
  assert.equal(
    configurationAgentMetrics({ total_agents: 5, connected_agents: 4, healthy_agents: 3 }, [], null)
      .connectedAgents,
    4,
  );
});

test("uses canonical total/connected/healthy fields from stats", () => {
  assert.deepEqual(
    configurationAgentMetrics(
      { total_agents: 12, connected_agents: 10, healthy_agents: 9 },
      [],
      null,
    ),
    {
      totalAgents: 12,
      visibleAgents: 0,
      connectedAgents: 10,
      healthyAgents: 9,
      degradedAgents: 0,
      driftedAgents: 0,
      activeWebSockets: undefined,
      desiredConfigHash: null,
    },
  );
});
