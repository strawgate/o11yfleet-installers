import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, AgentDetail, Overview } from "../src/api/hooks/portal";
import { buildBillingView } from "../src/pages/portal/billing-model";
import {
  agentConnectionTone,
  agentHealthView,
  agentStatusView,
  agentSyncView,
} from "../src/pages/portal/agent-view-model";
import { buildAgentSectionModel } from "../src/pages/portal/agents-page-model";
import {
  agentConnection,
  buildAgentDetailGuidanceTargets,
  buildAgentDetailModel,
  componentSummary,
} from "../src/pages/portal/agent-detail-model";
import {
  buildConfigurationDetailModel,
  latestConfigVersion,
} from "../src/pages/portal/configuration-detail-model";
import type { AgentIdentity, PipelineTopology } from "../src/utils/pipeline";
import { initials, memberDisplayName, roleTone } from "../src/pages/portal/team-model";

function overviewFixture(overrides: Partial<Overview> = {}): Overview {
  return {
    tenant: { id: "tenant_1", name: "Acme", plan: "starter" },
    configs_count: 0,
    total_agents: 0,
    connected_agents: 0,
    healthy_agents: 0,
    configurations: [],
    ...overrides,
  };
}

test("buildBillingView prefers server counts and clamps quota percentage", () => {
  const view = buildBillingView(
    { id: "tenant_1", name: "Acme", plan: "starter", max_configs: 2 },
    overviewFixture({ configs_count: 5, total_agents: 42 }),
  );

  assert.equal(view.plan, "starter");
  assert.equal(view.maxConfigs, 2);
  assert.equal(view.usedConfigs, 5);
  assert.equal(view.configPct, 100);
  assert.equal(view.totalAgents, 42);
});

test("buildBillingView falls back to overview rows and legacy agent count", () => {
  const view = buildBillingView({ id: "tenant_1", name: "Acme", plan: "enterprise" }, {
    configurations: [{ id: "cfg_1", tenant_id: "tenant_1", name: "prod" }],
    agents: 7,
  } as unknown as Overview);

  assert.equal(view.maxConfigsLabel, "Custom");
  assert.equal(view.usedConfigs, 1);
  assert.equal(view.totalAgents, 7);
  assert.equal(view.stateful, true);
});

test("team view helpers normalize display names, initials, and role tones", () => {
  assert.equal(memberDisplayName({ id: "u_1", email: "ops@example.com" }), "ops@example.com");
  assert.equal(
    memberDisplayName({ id: "u_2", email: "owner@example.com", display_name: " Avery Owner " }),
    "Avery Owner",
  );
  assert.equal(
    memberDisplayName({ id: "u_3", email: "fallback@example.com", display_name: " " }),
    "fallback@example.com",
  );
  assert.equal(initials("Avery Fleet Owner"), "AF");
  assert.equal(initials(" "), "?");
  assert.equal(initials(undefined), "?");
  assert.equal(roleTone("owner"), "warn");
  assert.equal(roleTone("operator"), "ok");
  assert.equal(roleTone("viewer"), "neutral");
});

test("agent view helpers normalize status, health, and config sync labels", () => {
  const baseAgent = {
    instance_uid: "agent_1",
    status: "connected",
    healthy: true,
    capabilities: 0x02,
    current_config_hash: "abcdef1234567890",
  } as Agent;

  assert.equal(agentConnectionTone("connected"), "ok");
  assert.equal(agentConnectionTone("degraded"), "warn");
  assert.equal(agentConnectionTone("disconnected"), "error");
  assert.equal(agentConnectionTone("paused"), "neutral");
  assert.deepEqual(agentStatusView(undefined), { label: "unknown", tone: "neutral" });
  assert.deepEqual(agentStatusView("paused"), { label: "paused", tone: "neutral" });

  assert.deepEqual(agentHealthView(baseAgent), { label: "healthy", tone: "ok" });
  assert.deepEqual(agentHealthView({ ...baseAgent, healthy: false }), {
    label: "unhealthy",
    tone: "error",
  });
  assert.deepEqual(agentHealthView({ ...baseAgent, healthy: undefined }), {
    label: "unknown",
    tone: "neutral",
  });

  assert.deepEqual(agentSyncView(baseAgent, "abcdef1234567890"), {
    label: "in sync",
    tone: "ok",
    hashLabel: "abcdef123456…",
  });
  assert.deepEqual(agentSyncView(baseAgent, "different"), {
    label: "drift",
    tone: "warn",
    hashLabel: "abcdef123456…",
  });
  assert.deepEqual(agentSyncView({ ...baseAgent, capabilities: 0 }, "different"), {
    label: "not reported",
    tone: "neutral",
    hashLabel: "abcdef123456…",
  });
});

test("agent section model prefers metric snapshots and gates noisy guidance", () => {
  const agents = [
    {
      instance_uid: "agent_1",
      hostname: "collector-1",
      status: "connected",
      healthy: true,
      capabilities: 0x02,
      current_config_hash: "desired",
    },
    {
      instance_uid: "agent_2",
      hostname: "collector-2",
      status: "degraded",
      healthy: false,
      capabilities: 0x02,
      current_config_hash: "stale",
    },
  ] as Agent[];
  const model = buildAgentSectionModel({
    config: {
      id: "config_1",
      tenant_id: "tenant_1",
      name: "prod",
      current_config_hash: "desired",
    },
    agents,
    stats: {
      total_agents: 20,
      connected_agents: 8,
      healthy_agents: 7,
      drifted_agents: 6,
      desired_config_hash: "desired",
      status_counts: { degraded: 5 },
    },
    filter: "collector",
    expanded: true,
    isLoading: false,
    hasError: false,
    aggregateStatsReady: true,
  });

  assert.equal(model.totalAgents, 20);
  assert.equal(model.connectedAgents, 8);
  assert.equal(model.visibleAgents, 2);
  assert.equal(model.shouldRequestGuidance, true);
  assert.equal(model.guidanceContext["total_agents"], 20);
  assert.equal(model.guidanceContext["visible_agents_scope"], "current paginated result page");
  assert.equal(model.pageContext?.filters?.["search"], "collector");
  assert.equal(model.pageContext?.tables[0]?.total_rows, 2);
  assert.deepEqual(model.pageContext?.tables[0]?.rows[1], {
    id: "agent_2",
    hostname: "collector-2",
    status: "degraded",
    health: "unhealthy",
    config_sync: "drift",
    current_hash: "stale",
    last_seen: null,
  });
});

test("agent section model does not request guidance without aggregate metrics", () => {
  const model = buildAgentSectionModel({
    config: { id: "config_1", tenant_id: "tenant_1", name: "prod" },
    agents: [{ instance_uid: "agent_1", status: "disconnected" } as Agent],
    stats: undefined,
    filter: "",
    expanded: true,
    isLoading: false,
    hasError: false,
    aggregateStatsReady: true,
  });

  assert.equal(model.totalAgents, null);
  assert.equal(model.visibleAgents, 1);
  assert.equal(model.shouldRequestGuidance, false);
  assert.equal(model.hasSnapshotStats, false);
  assert.equal(
    model.pageContext?.metrics.find((metric) => metric.key === "total_agents")?.value,
    null,
  );
  assert.equal(
    model.pageContext?.metrics.find((metric) => metric.key === "visible_agents")?.value,
    1,
  );
});

test("agent detail guidance targets only include active tab sections", () => {
  const base = {
    agent: { effective_config_body: "receivers:\n  otlp: {}\n" } as AgentDetail,
    healthy: true,
    isConnected: true,
    componentCounts: { total: 2, healthy: 2, degraded: 0 },
    configSync: { label: "in sync", tone: "ok" as const },
    acceptsRemoteConfig: true,
    topology: {
      receivers: [{ name: "otlp", type: "otlp", healthy: true, status: "ok" }],
      processors: [],
      exporters: [{ name: "debug", type: "debug", healthy: true, status: "ok" }],
      extensions: [],
      pipelines: [{ name: "logs", receivers: ["otlp"], processors: [], exporters: ["debug"] }],
    } satisfies PipelineTopology,
  };

  assert.deepEqual(
    buildAgentDetailGuidanceTargets({ ...base, tab: "overview" }).map((target) => target.key),
    ["agent.page", "agent.health", "agent.configuration"],
  );
  assert.deepEqual(
    buildAgentDetailGuidanceTargets({ ...base, tab: "pipeline" }).map((target) => target.key),
    ["agent.page", "agent.health", "agent.configuration", "agent.pipeline"],
  );
  assert.deepEqual(
    buildAgentDetailGuidanceTargets({ ...base, tab: "config" }).map((target) => target.key),
    ["agent.page", "agent.health", "agent.configuration", "agent.effective-config"],
  );
});

test("agent detail model builds conservative browser context from the visible tab", () => {
  const identity: AgentIdentity = {
    serviceName: "otelcol",
    serviceVersion: "0.124.0",
    hostname: null,
    osType: null,
    osDescription: null,
    hostArch: null,
  };
  const agent = {
    instance_uid: "agent_1",
    hostname: "collector-1",
    status: "degraded",
    healthy: 0,
    is_connected: true,
    is_drifted: true,
    capabilities: 0x1002,
    current_config_hash: "current",
    desired_config_hash: "desired",
    effective_config_hash: "effective",
    effective_config_body:
      "receivers:\n  otlp: {}\nexporters:\n  debug: {}\nservice:\n  pipelines:\n    logs:\n      receivers: [otlp]\n      exporters: [debug]\n",
    component_health_map: {
      "pipeline:logs": {
        component_health_map: {
          "receiver:otlp": { healthy: true },
          "exporter:debug": { healthy: false, last_error: "exporter failed" },
        },
      },
    },
    uptime_ms: null,
    available_components: {},
  } as AgentDetail;
  const topology: PipelineTopology = {
    receivers: [{ name: "otlp", type: "otlp", healthy: true, status: "ok" }],
    processors: [],
    exporters: [{ name: "debug", type: "debug", healthy: false, lastError: "exporter failed" }],
    extensions: [],
    pipelines: [{ name: "logs", receivers: ["otlp"], processors: [], exporters: ["debug"] }],
  };

  const overview = buildAgentDetailModel({
    agent,
    agentUid: "agent_1",
    configId: "config_1",
    configurationName: "prod",
    configCurrentHash: "desired",
    statsDesiredHash: undefined,
    identity,
    topology,
    tab: "overview",
  });

  assert.equal(overview.hostname, "collector-1");
  assert.equal(overview.healthy, false);
  assert.equal(overview.isConnected, true);
  assert.equal(overview.configSync.label, "config drift");
  assert.deepEqual(overview.componentCounts, { total: 2, healthy: 1, degraded: 1 });
  assert.equal(overview.guidanceContext["active_tab"], "overview");
  assert.equal(overview.guidanceContext["degraded_agents"], 1);
  assert.equal(overview.guidanceContext["pipeline_components"], 2);
  assert.equal(overview.pageContext.yaml, undefined);
  assert.deepEqual(overview.pageContext.tables, []);

  const pipeline = buildAgentDetailModel({
    agent,
    agentUid: "agent_1",
    configId: "config_1",
    configurationName: "prod",
    configCurrentHash: "desired",
    statsDesiredHash: undefined,
    identity,
    topology,
    tab: "pipeline",
  });
  assert.equal(pipeline.pageContext.tables[0]?.key, "pipeline_components");
  assert.deepEqual(
    pipeline.pageContext.tables[0]?.rows.find((row) => row["name"] === "debug"),
    { category: "exporter", name: "debug", healthy: false, status: "exporter failed" },
  );
  assert.equal(pipeline.pageContext.yaml, undefined);

  const config = buildAgentDetailModel({
    agent,
    agentUid: "agent_1",
    configId: "config_1",
    configurationName: "prod",
    configCurrentHash: "desired",
    statsDesiredHash: undefined,
    identity,
    topology,
    tab: "config",
  });
  assert.equal(config.pageContext.tables.length, 0);
  assert.match(config.pageContext.yaml?.content ?? "", /receivers:/);
});

test("agent detail model does not infer sync without desired hash or drift evidence", () => {
  const model = buildAgentDetailModel({
    agent: {
      instance_uid: "agent_1",
      status: "connected",
      healthy: true,
      is_connected: true,
      capabilities: 0x02,
      current_config_hash: "current-only",
      uptime_ms: null,
      available_components: {},
    } as AgentDetail,
    agentUid: "agent_1",
    configId: "config_1",
    configurationName: "prod",
    configCurrentHash: undefined,
    statsDesiredHash: undefined,
    identity: {
      serviceName: null,
      serviceVersion: null,
      hostname: "collector-1",
      osType: null,
      osDescription: null,
      hostArch: null,
    },
    topology: null,
    tab: "overview",
  });

  assert.equal(model.drift, false);
  assert.equal(model.configSync.label, "not reported");
  assert.equal(model.configSync.tone, "neutral");
  assert.equal(model.guidanceContext["drifted_agents"], null);
  assert.equal(
    model.pageContext.metrics.find((metric) => metric.key === "drifted_agents")?.value,
    null,
  );
  assert.equal(
    model.pageContext.details.find((detail) => detail.key === "config_sync")?.value,
    "not reported",
  );
});

test("agent detail model falls back to health-map leaves without topology", () => {
  const agent = {
    instance_uid: "agent_1",
    healthy: undefined,
    is_connected: false,
    is_drifted: false,
    capabilities: 0,
    component_health_map: {
      "pipeline:logs": {
        component_health_map: {
          "receiver:otlp": { healthy: true },
          "processor:batch": { healthy: true },
          "exporter:debug": { healthy: false },
        },
      },
    },
    uptime_ms: null,
    available_components: {},
  } as AgentDetail;

  const model = buildAgentDetailModel({
    agent,
    agentUid: "agent_1",
    configId: "config_1",
    configurationName: undefined,
    configCurrentHash: undefined,
    statsDesiredHash: undefined,
    identity: {
      serviceName: null,
      serviceVersion: null,
      hostname: null,
      osType: null,
      osDescription: null,
      hostArch: null,
    },
    topology: null,
    tab: "overview",
  });

  assert.equal(model.hostname, "agent_1");
  assert.equal(model.configSync.label, "n/a");
  assert.deepEqual(componentSummary(agent, null), { total: 3, healthy: 2, degraded: 1 });
  assert.deepEqual(model.componentCounts, { total: 3, healthy: 2, degraded: 1 });
});

test("agent detail connection helper preserves unknown agent state", () => {
  assert.equal(agentConnection(null), null);
  assert.equal(agentConnection({ is_connected: undefined } as unknown as AgentDetail), null);
  assert.equal(agentConnection({ is_connected: false } as unknown as AgentDetail), false);
});

test("configuration detail model scopes page context to active tabs", () => {
  const configuration = {
    id: "config_1",
    tenant_id: "tenant_1",
    name: "prod",
    status: "active",
    current_config_hash: "desired",
  };
  const agents = [
    {
      instance_uid: "agent_1",
      hostname: "collector-1",
      status: "connected",
      healthy: true,
      capabilities: 0x02,
      current_config_hash: "desired",
    },
  ] as Agent[];
  const versions = [
    {
      id: "version_2",
      version: 2,
      config_hash: "desired",
      size_bytes: 120,
      created_at: "2026-04-28T20:00:00.000Z",
    },
  ];
  const tokens = [{ id: "token_1" }];

  const agentsModel = buildConfigurationDetailModel({
    configuration,
    activeTab: "agents",
    agents,
    versions,
    tokens,
    stats: {
      total_agents: 10,
      connected_agents: 8,
      healthy_agents: 7,
      drifted_agents: 2,
      desired_config_hash: "desired",
      active_websockets: 8,
    },
    yaml: "receivers: {}\n",
  });

  assert.equal(agentsModel.totalAgents, 10);
  assert.equal(agentsModel.guidanceContext["active_tab"], "agents");
  assert.equal(agentsModel.guidanceContext["active_websockets"], 8);
  assert.equal(agentsModel.pageContext.tables[0]?.key, "agents");
  assert.equal(agentsModel.pageContext.yaml, undefined);

  const versionsModel = buildConfigurationDetailModel({
    configuration,
    activeTab: "versions",
    agents,
    versions,
    tokens,
    stats: undefined,
    yaml: "receivers: {}\n",
  });
  assert.equal(versionsModel.totalAgents, null);
  assert.equal(
    versionsModel.pageContext.metrics.find((metric) => metric.key === "total_agents")?.value,
    null,
  );
  assert.equal(versionsModel.pageContext.tables[0]?.key, "versions");
  assert.deepEqual(versionsModel.pageContext.tables[0]?.rows[0], {
    id: "version_2",
    version: 2,
    hash: "desired",
    created_at: "2026-04-28T20:00:00.000Z",
    size_bytes: 120,
  });

  const yamlModel = buildConfigurationDetailModel({
    configuration,
    activeTab: "yaml",
    agents,
    versions,
    tokens,
    stats: undefined,
    yaml: "receivers: {}\n",
    includeYaml: true,
  });
  assert.match(yamlModel.pageContext.yaml?.content ?? "", /receivers/);
});

test("configuration detail model chooses latest version by timestamp", () => {
  const versions = [
    { id: "version_1", version: 1, created_at: "2026-04-28T20:00:00.000Z" },
    { id: "version_3", version: 3, created_at: "2026-04-28T22:00:00.000Z" },
    { id: "version_2", version: 2, created_at: "2026-04-28T21:00:00.000Z" },
  ];

  assert.equal(latestConfigVersion(versions)?.id, "version_3");

  const model = buildConfigurationDetailModel({
    configuration: {
      id: "config_1",
      tenant_id: "tenant_1",
      name: "prod",
      status: "active",
      current_config_hash: "desired",
    },
    activeTab: "versions",
    agents: [],
    versions,
    tokens: [],
    stats: undefined,
    yaml: undefined,
  });

  assert.equal(model.guidanceContext["latest_version_created_at"], "2026-04-28T22:00:00.000Z");
  assert.equal(
    model.pageContext.details.find((detail) => detail.key === "latest_version_created_at")?.value,
    "2026-04-28T22:00:00.000Z",
  );
});
