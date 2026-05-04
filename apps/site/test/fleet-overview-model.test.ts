import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeFleetOverview } from "../src/api/models/fleet-overview";
import { observedAgeMs, isObservedUsable } from "../src/api/models/observed";
import type { Overview } from "../src/api/hooks/portal";

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

test("normalizes overview count fields into nested observed metrics", () => {
  const view = normalizeFleetOverview(
    overviewFixture({
      configs_count: 3,
      total_agents: 12,
      connected_agents: 8,
      healthy_agents: 7,
      active_rollouts: 1,
      configurations: [{ id: "cfg-1", tenant_id: "tenant_1", name: "default" }],
    }),
  );

  assert.equal(view.configurations.total.value, 3);
  assert.equal(view.agents.total.value, 12);
  assert.equal(view.agents.connected.value, 8);
  assert.equal(view.agents.healthy.value, 7);
  assert.equal(view.rollouts.active.value, 1);
  assert.equal(view.agents.total.observation.status, "ok");
  assert.equal(isObservedUsable(view.agents.total), true);
});

test("marks metrics-source failures as unavailable or error", () => {
  const unavailableView = normalizeFleetOverview(
    overviewFixture({ metrics_source: "unavailable" }),
  );
  assert.equal(unavailableView.agents.total.observation.status, "unavailable");
  assert.equal(unavailableView.rollouts.active.observation.status, "unavailable");

  const errorView = normalizeFleetOverview(
    overviewFixture({ metrics_error: "Analytics query failed", total_agents: 4 }),
  );
  assert.equal(errorView.agents.total.value, 4);
  assert.equal(errorView.agents.total.observation.status, "error");
  assert.deepEqual(errorView.agents.total.observation.warnings, ["Analytics query failed"]);
});

test("calculates observation age defensively", () => {
  assert.equal(
    observedAgeMs(
      { status: "ok", observed_at: "2026-05-01T00:00:00.000Z" },
      Date.parse("2026-05-01T00:00:30.000Z"),
    ),
    30_000,
  );
  assert.equal(observedAgeMs({ status: "ok", observed_at: null }), null);
  assert.equal(observedAgeMs({ status: "ok", observed_at: "not a date" }), null);
});
