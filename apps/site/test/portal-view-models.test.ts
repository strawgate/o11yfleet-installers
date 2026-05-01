import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, Overview } from "../src/api/hooks/portal";
import { buildBillingView } from "../src/pages/portal/billing-model";
import {
  agentConnectionTone,
  agentHealthView,
  agentSyncView,
} from "../src/pages/portal/agent-view-model";
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
