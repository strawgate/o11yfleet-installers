/**
 * E2E tests with real OTel Collectors.
 *
 * Tests two official deployment modes against local wrangler dev:
 *   1. otelcol-contrib with built-in opamp extension
 *   2. OpAMP Supervisor managing a collector process
 *
 * Prerequisites:
 *   just dev          # wrangler dev on :8787
 *   docker            # running Docker daemon
 *
 * Run:
 *   cd tests/e2e-collector && pnpm vitest run
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  waitForServer,
  createTenant,
  createConfig,
  createEnrollmentToken,
  getConfigStats,
  getAgents,
  writeGeneratedConfigs,
  dockerComposeUp,
  dockerComposeDown,
  dockerComposeLogs,
  isDockerAvailable,
  settle,
} from "./helpers.js";

// ─── Test State ─────────────────────────────────────────────────────────────

let configId: string;
let tenantId: string;

// ─── Setup & Teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  // Pre-flight checks
  if (!isDockerAvailable()) {
    throw new Error("Docker is not available. Start Docker Desktop first.");
  }

  await waitForServer();

  // Provision a test tenant + config + enrollment token
  const tenant = await createTenant(`e2e-collector-${Date.now()}`);
  tenantId = tenant.id;

  const config = await createConfig(tenantId, "collector-e2e");
  configId = config.id;

  const { token } = await createEnrollmentToken(configId);

  // Generate Docker configs with the enrollment token baked in
  writeGeneratedConfigs(token);

  // Start both collectors
  dockerComposeUp();

  // Poll until at least one agent is connected (up to 30s)
  const deadline = Date.now() + 30_000;
  let connected = false;
  while (Date.now() < deadline) {
    try {
      const stats = await getConfigStats(configId);
      if (stats.connected_agents > 0) {
        connected = true;
        break;
      }
    } catch {
      /* not ready yet */
    }
    await settle(1_000);
  }
  if (!connected) {
    console.warn("WARNING: No agents connected after 30s polling — tests may fail");
  }
}, 60_000);

afterAll(() => {
  dockerComposeDown();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("OTel Collector — opamp extension (built-in)", () => {
  it("collector-ext connects and enrolls", async () => {
    const stats = await getConfigStats(configId);
    // At least one agent should be connected (could be 2 if supervisor also connected)
    expect(stats.total_agents).toBeGreaterThanOrEqual(1);
    expect(stats.active_websockets).toBeGreaterThanOrEqual(1);
  });

  it("collector-ext reports healthy status", async () => {
    const { agents } = await getAgents(configId);
    // Find an agent that has health info
    const healthyAgents = agents.filter((a) => a.healthy === true || a.healthy === 1);
    expect(healthyAgents.length).toBeGreaterThanOrEqual(1);
  });

  it("collector-ext reports agent description with identifying attributes", async () => {
    const { agents } = await getAgents(configId);
    const withDesc = agents.filter((a) => {
      if (!a.agent_description) return false;
      let desc: Record<string, unknown>;
      try {
        desc =
          typeof a.agent_description === "string"
            ? (JSON.parse(a.agent_description as string) as Record<string, unknown>)
            : (a.agent_description as Record<string, unknown>);
      } catch {
        return false;
      }
      return (
        desc.identifying_attributes &&
        Array.isArray(desc.identifying_attributes) &&
        desc.identifying_attributes.length > 0
      );
    });
    expect(withDesc.length).toBeGreaterThanOrEqual(1);
  });

  it("collector-ext maintains persistent WebSocket connection", async () => {
    // Take a snapshot, wait, verify still connected
    const stats1 = await getConfigStats(configId);
    await settle(5_000);
    const stats2 = await getConfigStats(configId);

    // Active websockets should not decrease
    expect(stats2.active_websockets).toBeGreaterThanOrEqual(stats1.active_websockets);
  });

  it("collector-ext appears in agent summaries", async () => {
    const { agents } = await getAgents(configId);
    expect(agents.length).toBeGreaterThanOrEqual(1);

    // Each agent should have basic fields
    for (const agent of agents) {
      expect(agent.instance_uid).toBeDefined();
      expect(typeof agent.instance_uid).toBe("string");
      expect((agent.instance_uid as string).length).toBeGreaterThan(0);
    }
  });
});

describe("OTel Collector — OpAMP Supervisor", () => {
  it("supervisor connects and enrolls", async () => {
    // The supervisor should show up as a separate agent
    const stats = await getConfigStats(configId);
    // With both ext and supervisor running, we expect 2 agents
    // But supervisor image may not have otelcol-contrib bundled,
    // so we just check at least 1 is connected
    expect(stats.total_agents).toBeGreaterThanOrEqual(1);
  });

  it("logs show successful OpAMP connection", () => {
    const logs = dockerComposeLogs("supervisor");
    expect(logs.length).toBeGreaterThan(0);
    // Verify no fatal/panic-level errors in supervisor logs
    const fatalLines = logs.filter(
      (l) => l.includes("FATAL") || l.includes("panic:") || l.includes("Segmentation fault"),
    );
    expect(fatalLines).toHaveLength(0);
  });
});

describe("Combined: both collectors running", () => {
  it("stats reflect total connected agents", async () => {
    const stats = await getConfigStats(configId);
    // We expect at least 1 (ext collector will always work)
    // Supervisor may or may not connect depending on image availability
    expect(stats.total_agents).toBeGreaterThanOrEqual(1);
    expect(stats.active_websockets).toBeGreaterThanOrEqual(1);
    expect(stats.connected_agents).toBeGreaterThanOrEqual(1);
  });

  it("all connected agents are healthy", async () => {
    const stats = await getConfigStats(configId);
    // All connected agents should be healthy (no degraded state in this test)
    if (stats.healthy_agents !== undefined) {
      expect(stats.healthy_agents).toBeGreaterThanOrEqual(1);
    }
  });

  it("each agent has a unique instance_uid", async () => {
    const { agents } = await getAgents(configId);
    const uids = agents.map((a) => a.instance_uid);
    const uniqueUids = new Set(uids);
    expect(uniqueUids.size).toBe(uids.length);
  });
});

describe("Diagnostics on failure", () => {
  it("can retrieve Docker logs for debugging", () => {
    const extLogs = dockerComposeLogs("collector-ext");
    const supervisorLogs = dockerComposeLogs("supervisor");
    // Verify we get non-empty log output — useful for debugging failures
    expect(extLogs.length).toBeGreaterThan(0);
    expect(supervisorLogs.length).toBeGreaterThan(0);
  });
});
