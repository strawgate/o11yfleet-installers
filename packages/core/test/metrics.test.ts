import { describe, it, expect } from "vitest";
import {
  computeConfigMetrics,
  configMetricsToDoubles,
  configHistory,
  configSummary,
  configsWithMostDisconnections,
  FLEET_CONFIG_SNAPSHOT_INTERVAL,
  latestSnapshotForTenant,
  latestSnapshotForConfig,
  tenantAggregatedHistory,
  type AgentMetricsInput,
} from "../src/metrics/index.js";

function makeAgent(overrides: Partial<AgentMetricsInput> = {}): AgentMetricsInput {
  return {
    status: "connected",
    healthy: 1,
    capabilities: 0,
    current_config_hash: null,
    last_error: "",
    last_seen_at: Date.now(),
    ...overrides,
  };
}

function makeAgents(...overrides: Partial<AgentMetricsInput>[]): Map<string, AgentMetricsInput> {
  const map = new Map<string, AgentMetricsInput>();
  overrides.forEach((o, i) => {
    map.set(`agent-${i}`, makeAgent(o));
  });
  return map;
}

describe("computeConfigMetrics", () => {
  it("returns zeros for empty agent map", () => {
    const result = computeConfigMetrics(new Map(), null);
    expect(result.agent_count).toBe(0);
    expect(result.connected_count).toBe(0);
    expect(result.disconnected_count).toBe(0);
    expect(result.healthy_count).toBe(0);
    expect(result.unhealthy_count).toBe(0);
    expect(result.config_up_to_date).toBe(0);
    expect(result.config_pending).toBe(0);
    expect(result.agents_with_errors).toBe(0);
    expect(result.agents_stale).toBe(0);
    expect(result.websocket_count).toBe(0);
  });

  it("counts connected and disconnected agents", () => {
    const agents = makeAgents(
      { status: "connected" },
      { status: "connected" },
      { status: "disconnected" },
      { status: "unknown" },
    );
    const result = computeConfigMetrics(agents, null);
    expect(result.agent_count).toBe(4);
    expect(result.connected_count).toBe(2);
    expect(result.disconnected_count).toBe(1);
  });

  it("counts healthy and unhealthy agents", () => {
    const agents = makeAgents({ healthy: 1 }, { healthy: 1 }, { healthy: 0 });
    const result = computeConfigMetrics(agents, null);
    expect(result.healthy_count).toBe(2);
    expect(result.unhealthy_count).toBe(1);
  });

  it("counts connected_healthy correctly", () => {
    const agents = makeAgents(
      { status: "connected", healthy: 1 },
      { status: "connected", healthy: 0 },
      { status: "disconnected", healthy: 1 },
    );
    const result = computeConfigMetrics(agents, null);
    expect(result.connected_healthy_count).toBe(1);
  });

  it("marks config_up_to_date when hash matches desired", () => {
    const agents = makeAgents(
      { current_config_hash: "abc123" },
      { current_config_hash: "abc123" },
      { current_config_hash: "xyz" },
      { current_config_hash: null },
    );
    const result = computeConfigMetrics(agents, "abc123");
    expect(result.config_up_to_date).toBe(2);
    expect(result.config_pending).toBe(2);
  });

  it("marks all as up_to_date when no desired config", () => {
    const agents = makeAgents({ current_config_hash: "abc123" }, { current_config_hash: null });
    const result = computeConfigMetrics(agents, null);
    expect(result.config_up_to_date).toBe(2);
    expect(result.config_pending).toBe(0);
  });

  it("counts agents with non-empty last_error", () => {
    const agents = makeAgents(
      { last_error: "" },
      { last_error: "connection refused" },
      { last_error: "timeout" },
      { last_error: "" },
    );
    const result = computeConfigMetrics(agents, null);
    expect(result.agents_with_errors).toBe(2);
  });

  it("marks agents_stale when last_seen > 90s ago", () => {
    const now = Date.now();
    const agents = makeAgents(
      { status: "connected", last_seen_at: now - 60_000 }, // 60s ago — not stale
      { status: "connected", last_seen_at: now - 120_000 }, // 120s ago — stale
      { status: "disconnected", last_seen_at: now - 200_000 }, // disconnected — excluded
    );
    const result = computeConfigMetrics(agents, null);
    expect(result.agents_stale).toBe(1);
  });

  it("websocket_count is always 0 from computeConfigMetrics", () => {
    const agents = makeAgents({ status: "connected" });
    const result = computeConfigMetrics(agents, null);
    expect(result.websocket_count).toBe(0); // caller sets this
  });
});

describe("configMetricsToDoubles", () => {
  it("returns doubles in correct order", () => {
    const metrics = {
      agent_count: 10,
      connected_count: 7,
      disconnected_count: 2,
      healthy_count: 6,
      unhealthy_count: 1,
      connected_healthy_count: 5,
      config_up_to_date: 7,
      config_pending: 0,
      agents_with_errors: 1,
      agents_stale: 0,
      websocket_count: 3,
    };
    const doubles = configMetricsToDoubles(metrics);
    expect(doubles).toEqual([
      10, // agent_count
      7, // connected_count
      2, // disconnected_count
      6, // healthy_count
      1, // unhealthy_count
      5, // connected_healthy_count
      7, // config_up_to_date
      0, // config_pending
      1, // agents_with_errors
      0, // agents_stale
      3, // websocket_count
    ]);
  });

  it("has exactly 11 doubles matching ConfigMetrics fields", () => {
    const metrics = {
      agent_count: 0,
      connected_count: 0,
      disconnected_count: 0,
      healthy_count: 0,
      unhealthy_count: 0,
      connected_healthy_count: 0,
      config_up_to_date: 0,
      config_pending: 0,
      agents_with_errors: 0,
      agents_stale: 0,
      websocket_count: 0,
    };
    const doubles = configMetricsToDoubles(metrics);
    expect(doubles).toHaveLength(11);
  });
});

describe("fleet metric query helpers", () => {
  it("escapes tenant and config identifiers in string literals", () => {
    const sql = latestSnapshotForConfig("tenant-' OR 1=1 --", "config-'x");

    expect(sql).toContain("blob1 = 'tenant-'' OR 1=1 --'");
    expect(sql).toContain("blob2 = 'config-''x'");
  });

  it("returns only the newest tenant snapshot set", () => {
    const sql = latestSnapshotForTenant("tenant-1");

    expect(sql).toContain("SELECT max(timestamp)");
    expect(sql).toContain("ORDER BY blob2 ASC");
    expect(sql).toContain(`blob3 = '${FLEET_CONFIG_SNAPSHOT_INTERVAL}'`);
    expect(sql).not.toContain("'5m'");
  });

  it("aggregates tenant history at tenant-wide timestamp grain without time-weighted averages", () => {
    const sql = tenantAggregatedHistory("tenant-1", 7);

    expect(sql).toContain("WITH tenant_snapshots AS");
    expect(sql).toContain("GROUP BY timestamp");
    expect(sql).toContain("FROM tenant_snapshots");
    expect(sql).toContain("argMax(connected, timestamp)");
    expect(sql).toContain("snapshot_count");
    expect(sql).not.toContain("avg(");
  });

  it("uses deterministic latest values for config summaries", () => {
    const sql = configSummary("tenant-1", "config-1", 7);

    expect(sql).toContain("argMax(double1, timestamp)");
    expect(sql).not.toContain("any(");
    expect(sql).not.toContain("avg(");
  });

  it("rejects invalid history windows and limits", () => {
    expect(() => configHistory("tenant", "config", 0)).toThrow(
      "days must be an integer between 1 and 90",
    );
    expect(() => configHistory("tenant", "config", 90.5)).toThrow(
      "days must be an integer between 1 and 90",
    );
    expect(() => configsWithMostDisconnections("tenant", 30, 101)).toThrow(
      "limit must be an integer between 1 and 100",
    );
  });
});
