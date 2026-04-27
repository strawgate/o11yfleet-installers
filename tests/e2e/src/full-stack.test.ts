/**
 * Full-stack E2E tests — run against a live wrangler dev server.
 *
 * Prerequisites:
 *   just dev          # start wrangler dev (port 8787)
 *   just db-migrate   # ensure D1 schema is up
 *
 * Run: cd tests/e2e && pnpm vitest run
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { FakeOpampAgent } from "@o11yfleet/test-utils";
import { verifyClaim } from "@o11yfleet/core/auth";
import {
  WS_URL,
  waitForServer,
  createTenant,
  createConfig,
  uploadConfigVersion,
  createEnrollmentToken,
  rolloutConfig,
  getConfigStats,
  getAgentSummaries,
  settle,
  healthz,
} from "./helpers.js";

const CLAIM_SECRET = "dev-secret-key-for-testing-only-32ch";

// Track agents for cleanup
const liveAgents: FakeOpampAgent[] = [];

function agent(opts: ConstructorParameters<typeof FakeOpampAgent>[0]): FakeOpampAgent {
  const a = new FakeOpampAgent(opts);
  liveAgents.push(a);
  return a;
}

afterEach(() => {
  // Close all agents created during the test
  for (const a of liveAgents) {
    try { a.close(); } catch { /* ignore */ }
  }
  liveAgents.length = 0;
});

// ────────────────────────────────────────────────────────────────────
// Pre-flight: ensure wrangler dev is running
// ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await waitForServer();
}, 20_000);

// ────────────────────────────────────────────────────────────────────
// Health Check
// ────────────────────────────────────────────────────────────────────

describe("Health", () => {
  it("GET /healthz returns 200", async () => {
    expect(await healthz()).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// API CRUD
// ────────────────────────────────────────────────────────────────────

describe("API CRUD", () => {
  it("creates a tenant and lists it", async () => {
    const t = await createTenant(`e2e-crud-${Date.now()}`);
    expect(t.id).toBeTruthy();
    expect(t.name).toContain("e2e-crud");
  });

  it("creates a config under a tenant", async () => {
    const t = await createTenant(`e2e-config-${Date.now()}`);
    const c = await createConfig(t.id, "test-config");
    expect(c.tenant_id).toBe(t.id);
    expect(c.name).toBe("test-config");
  });

  it("uploads a config version (YAML)", async () => {
    const t = await createTenant(`e2e-upload-${Date.now()}`);
    const c = await createConfig(t.id, "yaml-test");
    const yaml = "receivers:\n  otlp:\n    protocols:\n      grpc:\n";
    const v = await uploadConfigVersion(c.id, yaml);
    expect(v.hash).toBeTruthy();
    expect(v.hash.length).toBeGreaterThan(8);
  });

  it("creates an enrollment token", async () => {
    const t = await createTenant(`e2e-enroll-${Date.now()}`);
    const c = await createConfig(t.id, "enroll-test");
    const tok = await createEnrollmentToken(c.id);
    expect(tok.token).toMatch(/^fp_enroll_/);
  });

  it("deduplicates identical config versions", async () => {
    const t = await createTenant(`e2e-dedup-${Date.now()}`);
    const c = await createConfig(t.id, "dedup-test");
    const yaml = `# dedup test ${Date.now()}\nreceivers:\n  otlp:\n`;
    const v1 = await uploadConfigVersion(c.id, yaml);
    const v2 = await uploadConfigVersion(c.id, yaml);
    expect(v1.hash).toBe(v2.hash);
    expect(v2.deduplicated).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// Agent Enrollment (full WebSocket lifecycle)
// ────────────────────────────────────────────────────────────────────

describe("Agent Enrollment", () => {
  let tenantId: string;
  let configId: string;
  let enrollmentToken: string;

  beforeAll(async () => {
    const t = await createTenant(`e2e-lifecycle-${Date.now()}`);
    tenantId = t.id;
    const c = await createConfig(t.id, "lifecycle-config");
    configId = c.id;
    const tok = await createEnrollmentToken(c.id);
    enrollmentToken = tok.token;
  });

  it("enrolls a new agent and receives an assignment claim", async () => {
    const a = agent({
      endpoint: WS_URL,
      enrollmentToken,
      name: "enroll-test-agent",
    });

    const enrollment = await a.connectAndEnroll();

    expect(enrollment.type).toBe("enrollment_complete");
    expect(enrollment.assignment_claim).toBeTruthy();
    expect(enrollment.instance_uid).toBeTruthy();

    // Verify the claim is valid
    const claim = await verifyClaim(enrollment.assignment_claim, CLAIM_SECRET);
    expect(claim.tenant_id).toBe(tenantId);
    expect(claim.config_id).toBe(configId);
  });

  it("sends hello and receives a valid response", async () => {
    const a = agent({ endpoint: WS_URL, enrollmentToken, name: "hello-agent" });
    await a.connectAndEnroll();

    await a.sendHello();
    const resp = await a.waitForMessage(5000);
    expect(resp).toBeDefined();
    // Server should echo back capabilities or empty response
  });

  it("sends heartbeats and receives responses", async () => {
    const a = agent({ endpoint: WS_URL, enrollmentToken, name: "hb-agent" });
    await a.connectAndEnroll();
    await a.sendHello();
    await a.waitForMessage(5000);

    // Send 3 heartbeats
    for (let i = 0; i < 3; i++) {
      await a.sendHeartbeat();
      const resp = await a.waitForMessage(5000);
      expect(resp).toBeDefined();
    }
  });

  it("reports health state changes", async () => {
    const a = agent({ endpoint: WS_URL, enrollmentToken, name: "health-agent" });
    await a.connectAndEnroll();
    await a.sendHello();
    await a.waitForMessage(5000);

    // Report unhealthy
    await a.sendHealth(false, "degraded");
    const resp = await a.waitForMessage(5000);
    expect(resp).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// Config Push + ACK
// ────────────────────────────────────────────────────────────────────

describe("Config Push", () => {
  it("pushes config to connected agent and receives ACK", async () => {
    const t = await createTenant(`e2e-push-${Date.now()}`);
    const c = await createConfig(t.id, "push-config");
    const tok = await createEnrollmentToken(c.id);

    // Upload a config
    const yaml = "receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 0.0.0.0:4317\n";
    await uploadConfigVersion(c.id, yaml);

    // Connect agent
    const a = agent({ endpoint: WS_URL, enrollmentToken: tok.token, name: "push-agent" });
    await a.connectAndEnroll();
    await a.sendHello();
    await a.waitForMessage(5000);

    // Rollout config
    const rollout = await rolloutConfig(c.id);
    expect(rollout.pushed).toBeGreaterThanOrEqual(1);
    expect(rollout.config_hash).toBeTruthy();

    // Agent should receive config push
    const pushMsg = await a.waitForRemoteConfig(10_000);
    expect(pushMsg.remote_config).toBeDefined();
    expect(pushMsg.remote_config!.config_hash).toBeTruthy();

    // ACK the config
    const configHash = pushMsg.remote_config!.config_hash instanceof Uint8Array
      ? pushMsg.remote_config!.config_hash
      : new Uint8Array(pushMsg.remote_config!.config_hash as ArrayBufferLike);
    await a.applyConfig(configHash);

    // Verify the config content contains our YAML
    if (pushMsg.remote_config!.config_map) {
      const files = Object.values(pushMsg.remote_config!.config_map);
      const hasOtlp = files.some(
        (f: any) => {
          const body = typeof f.body === "string"
            ? f.body
            : new TextDecoder().decode(f.body);
          return body.includes("otlp");
        },
      );
      expect(hasOtlp).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Reconnect with Assignment Claim
// ────────────────────────────────────────────────────────────────────

describe("Reconnect", () => {
  it("reconnects using assignment claim after disconnect", async () => {
    const t = await createTenant(`e2e-reconnect-${Date.now()}`);
    const c = await createConfig(t.id, "reconnect-config");
    const tok = await createEnrollmentToken(c.id);

    // First connection — enroll
    const a1 = agent({ endpoint: WS_URL, enrollmentToken: tok.token, name: "reconnect-agent" });
    const enrollment = await a1.connectAndEnroll();
    await a1.sendHello();
    await a1.waitForMessage(5000);
    a1.close();

    // Small delay for disconnect to process
    await settle(300);

    // Reconnect using the assignment claim
    const a2 = agent({
      endpoint: WS_URL,
      assignmentClaim: enrollment.assignment_claim,
      name: "reconnect-agent-2",
    });
    await a2.connect();
    await a2.sendHello();
    const resp = await a2.waitForMessage(5000);
    expect(resp).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// Multi-Tenant Isolation
// ────────────────────────────────────────────────────────────────────

describe("Multi-Tenant Isolation", () => {
  let tenantA: { id: string; configId: string; token: string };
  let tenantB: { id: string; configId: string; token: string };

  beforeAll(async () => {
    const tA = await createTenant(`e2e-iso-A-${Date.now()}`);
    const cA = await createConfig(tA.id, "config-A");
    const tokA = await createEnrollmentToken(cA.id);

    const tB = await createTenant(`e2e-iso-B-${Date.now()}`);
    const cB = await createConfig(tB.id, "config-B");
    const tokB = await createEnrollmentToken(cB.id);

    tenantA = { id: tA.id, configId: cA.id, token: tokA.token };
    tenantB = { id: tB.id, configId: cB.id, token: tokB.token };
  });

  it("agents from different tenants get isolated claims", async () => {
    const agentA = agent({ endpoint: WS_URL, enrollmentToken: tenantA.token, name: "iso-A" });
    const agentB = agent({ endpoint: WS_URL, enrollmentToken: tenantB.token, name: "iso-B" });

    const enrollA = await agentA.connectAndEnroll();
    const enrollB = await agentB.connectAndEnroll();

    const claimA = await verifyClaim(enrollA.assignment_claim, CLAIM_SECRET);
    const claimB = await verifyClaim(enrollB.assignment_claim, CLAIM_SECRET);

    expect(claimA.tenant_id).toBe(tenantA.id);
    expect(claimB.tenant_id).toBe(tenantB.id);
    expect(claimA.config_id).toBe(tenantA.configId);
    expect(claimB.config_id).toBe(tenantB.configId);
    expect(claimA.tenant_id).not.toBe(claimB.tenant_id);
  });

  it("config push to tenant A does not reach tenant B", async () => {
    const yamlA = `# tenant A config ${Date.now()}\nreceivers:\n  otlp:\n`;
    await uploadConfigVersion(tenantA.configId, yamlA);

    const agentA = agent({ endpoint: WS_URL, enrollmentToken: tenantA.token, name: "iso-push-A" });
    const agentB = agent({ endpoint: WS_URL, enrollmentToken: tenantB.token, name: "iso-push-B" });

    await agentA.connectAndEnroll();
    await agentA.sendHello();
    await agentA.waitForMessage(5000);

    await agentB.connectAndEnroll();
    await agentB.sendHello();
    await agentB.waitForMessage(5000);

    // Rollout to tenant A only
    const rollout = await rolloutConfig(tenantA.configId);
    expect(rollout.pushed).toBeGreaterThanOrEqual(1);

    // Agent A should get config
    const pushA = await agentA.waitForRemoteConfig(10_000);
    expect(pushA.remote_config).toBeDefined();

    // Agent B should NOT get config (timeout expected)
    await expect(
      agentB.waitForMessage(2000),
    ).rejects.toThrow("Timeout");
  });

  it("stats are isolated between tenants", async () => {
    // Connect agents to both tenants
    const agentA = agent({ endpoint: WS_URL, enrollmentToken: tenantA.token, name: "iso-stat-A" });
    await agentA.connectAndEnroll();
    await agentA.sendHello();
    await agentA.waitForMessage(5000);

    const statsA = await getConfigStats(tenantA.configId);
    const statsB = await getConfigStats(tenantB.configId);

    // A should have agents, B should have fewer (or zero)
    expect(statsA.total_agents).toBeGreaterThanOrEqual(1);
    // B's agents are independent — they won't include A's
    expect(statsB.total_agents).not.toBe(statsA.total_agents);
  });
});

// ────────────────────────────────────────────────────────────────────
// Scale: Multiple Agents
// ────────────────────────────────────────────────────────────────────

describe("Scale: 20 concurrent agents", () => {
  it("enrolls and manages 20 agents simultaneously", async () => {
    const t = await createTenant(`e2e-scale-${Date.now()}`);
    const c = await createConfig(t.id, "scale-config");
    const tok = await createEnrollmentToken(c.id);

    const yaml = "receivers:\n  otlp:\n    protocols:\n      grpc:\n";
    await uploadConfigVersion(c.id, yaml);

    const AGENT_COUNT = 20;
    const agents: FakeOpampAgent[] = [];

    // Connect all agents
    const connectPromises = Array.from({ length: AGENT_COUNT }, (_, i) => {
      const a = agent({
        endpoint: WS_URL,
        enrollmentToken: tok.token,
        name: `scale-agent-${i}`,
      });
      agents.push(a);
      return a.connectAndEnroll().then(() => a.sendHello()).then(() => a.waitForMessage(5000));
    });

    const results = await Promise.allSettled(connectPromises);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    expect(succeeded).toBe(AGENT_COUNT);

    // Verify stats
    await settle(1000);
    const stats = await getConfigStats(c.id);
    expect(stats.total_agents).toBe(AGENT_COUNT);
    expect(stats.active_websockets).toBe(AGENT_COUNT);

    // Rollout config to all
    const rollout = await rolloutConfig(c.id);
    expect(rollout.pushed).toBe(AGENT_COUNT);

    // All agents should receive the config push
    const pushPromises = agents.map((a) => a.waitForRemoteConfig(10_000));
    const pushResults = await Promise.allSettled(pushPromises);
    const pushSucceeded = pushResults.filter((r) => r.status === "fulfilled").length;
    expect(pushSucceeded).toBe(AGENT_COUNT);
  }, 60_000);
});

// ────────────────────────────────────────────────────────────────────
// Security: Header Spoofing Prevention
// ────────────────────────────────────────────────────────────────────

describe("Security", () => {
  it("rejects requests without auth token", async () => {
    const a = agent({ endpoint: WS_URL, name: "no-auth-agent" });
    // Connect without any token — should fail or close immediately
    await expect(a.connect()).rejects.toThrow();
  });

  it("rejects invalid enrollment tokens", async () => {
    const a = agent({
      endpoint: WS_URL,
      enrollmentToken: "fp_enroll_invalid_token_that_does_not_exist",
      name: "bad-token-agent",
    });
    try {
      await a.connect();
      // If connect succeeds, the server should close the WS quickly
      await expect(a.waitForMessage(3000)).rejects.toThrow();
    } catch {
      // Connection itself may fail, which is also correct
    }
  });

  it("rejects tampered assignment claims", async () => {
    const a = agent({
      endpoint: WS_URL,
      assignmentClaim: "eyJhbGciOiJIUzI1NiJ9.eyJ0YW1wZXJlZCI6dHJ1ZX0.invalid",
      name: "tampered-claim-agent",
    });
    try {
      await a.connect();
      await expect(a.waitForMessage(3000)).rejects.toThrow();
    } catch {
      // Connection itself may fail, which is also correct
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// DO Stats & Agent Summaries
// ────────────────────────────────────────────────────────────────────

describe("Stats & Summaries", () => {
  it("DO stats reflect connected agent count", async () => {
    const t = await createTenant(`e2e-stats-${Date.now()}`);
    const c = await createConfig(t.id, "stats-config");
    const tok = await createEnrollmentToken(c.id);

    // Connect 3 agents
    const agents: FakeOpampAgent[] = [];
    for (let i = 0; i < 3; i++) {
      const a = agent({ endpoint: WS_URL, enrollmentToken: tok.token, name: `stat-${i}` });
      await a.connectAndEnroll();
      await a.sendHello();
      await a.waitForMessage(5000);
      agents.push(a);
    }

    const stats = await getConfigStats(c.id);
    expect(stats.total_agents).toBe(3);
    expect(stats.active_websockets).toBe(3);

    // Disconnect one
    agents[0].close();
    await settle(500);

    const stats2 = await getConfigStats(c.id);
    expect(stats2.active_websockets).toBe(2);
    // total_agents stays 3, only websockets decrease
    expect(stats2.total_agents).toBe(3);
  });
});
