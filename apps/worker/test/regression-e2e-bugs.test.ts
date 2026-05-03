// Regression tests for bugs found during e2e stress testing.
//
// Bug 1: parseAttachment was dropping is_first_message and pending_connection_settings
// Bug 2: Generation never incremented on reconnect (always stayed at 1)
// Bug 3: All-zero instance_uid handling (opamp-go rejects it, server accepts it)
//
// These tests run in the workerd pool against the real DO and catch regressions at the unit level.

// Note: importing from "vitest" is correct here — @cloudflare/vitest-pool-workers
// re-exports vitest globals and the workerd pool config handles the runtime transform.
import { describe, it, expect, beforeAll } from "vitest";
import { verifyClaim } from "@o11yfleet/core/auth";
import {
  bootstrapSchema,
  O11YFLEET_CLAIM_HMAC_SECRET,
  createTenant,
  createConfig,
  createEnrollmentToken,
  connectWithEnrollment,
  connectWithClaim,
  sendHello,
  getAgentSummaries,
} from "./helpers.js";

/** Helper to get agents list (unwraps the {agents: [...]} envelope) */
async function getAgents(configId: string): Promise<Record<string, unknown>[]> {
  const result = await getAgentSummaries(configId);
  return result.agents;
}

// ─── Bug 1: parseAttachment field preservation ─────────────────────────────

describe("parseAttachment field preservation (regression)", () => {
  let configId: string;

  beforeAll(async () => {
    await bootstrapSchema();
    const tenant = await createTenant("att-fields-tenant");
    const config = await createConfig(tenant.id, "att-fields");
    configId = config.id;
  });

  it("pending_connection_settings is delivered on first response after enrollment", async () => {
    const { token } = await createEnrollmentToken(configId);
    const { ws, enrollment } = await connectWithEnrollment(token);

    // The assignment_claim in the enrollment response proves pending_connection_settings
    // was serialized and read back correctly (it's consumed during first processFrame response)
    expect(enrollment.assignment_claim).toBeDefined();
    expect(enrollment.assignment_claim.length).toBeGreaterThan(10);

    // Verify the claim is valid
    const claim = await verifyClaim(enrollment.assignment_claim, O11YFLEET_CLAIM_HMAC_SECRET);
    expect(claim).not.toBeNull();
    expect(claim!.config_id).toBe(configId);
    expect(claim!.instance_uid).toBe(enrollment.instance_uid);

    ws.close();
  });

  it("is_first_message triggers generation bump on first processFrame", async () => {
    const { token } = await createEnrollmentToken(configId);
    const { ws, enrollment } = await connectWithEnrollment(token);

    // After enrollment + first hello, generation should be > 0 in the DB
    // (the is_first_message flag must survive parseAttachment round-trip)
    const agents = await getAgents(configId);
    const agent = agents.find((a) => a.instance_uid === enrollment.instance_uid);
    expect(agent, "Agent must exist after enrollment").toBeDefined();
    expect(
      agent!.generation,
      "Generation must be > 0 (is_first_message was preserved)",
    ).toBeGreaterThan(0);

    ws.close();
  });
});

// ─── Bug 2: Generation increment on reconnect ──────────────────────────────

describe("Generation increment on reconnect (regression)", () => {
  beforeAll(async () => {
    await bootstrapSchema();
  });

  it("generation increments on first enrollment", async () => {
    // Fresh config so no prior state for this UID
    const tenant = await createTenant("gen-test-1");
    const config = await createConfig(tenant.id, "gen1");
    const { token } = await createEnrollmentToken(config.id);
    const { ws, enrollment } = await connectWithEnrollment(token);

    const agents = await getAgents(config.id);
    const agent = agents.find((a) => a.instance_uid === enrollment.instance_uid);
    // New agent: loadAgentState returns generation=1 for first-time agent, then += 1 = 2
    expect(agent!.generation).toBe(2);

    ws.close();
  });

  it("generation increments again on reconnect (2 → 3)", async () => {
    const tenant = await createTenant("gen-test-2");
    const config = await createConfig(tenant.id, "gen2");
    const { token } = await createEnrollmentToken(config.id);
    const { ws: ws1, enrollment } = await connectWithEnrollment(token);

    // Parse the claim for reconnect
    const claim = await verifyClaim(enrollment.assignment_claim, O11YFLEET_CLAIM_HMAC_SECRET);
    expect(claim).not.toBeNull();

    // First connection: generation should be 2
    const agents1 = await getAgents(config.id);
    const agent1 = agents1.find((a) => a.instance_uid === enrollment.instance_uid);
    const gen1 = agent1!.generation as number;
    expect(gen1).toBe(2);

    // Disconnect
    ws1.close();

    // Reconnect with the assignment claim
    const ws2 = await connectWithClaim(claim!);
    await sendHello(ws2);

    // After reconnect, generation must have incremented
    const agents2 = await getAgents(config.id);
    const agent2 = agents2.find((a) => a.instance_uid === enrollment.instance_uid);
    const gen2 = agent2!.generation as number;
    expect(gen2, "Generation must increment on reconnect").toBe(gen1 + 1);

    ws2.close();
  });

  it("generation increments on every new connection (not just first reconnect)", async () => {
    const tenant = await createTenant("gen-test-3");
    const config = await createConfig(tenant.id, "gen3");
    const { token } = await createEnrollmentToken(config.id);
    const { ws: ws1, enrollment } = await connectWithEnrollment(token);
    const claim = await verifyClaim(enrollment.assignment_claim, O11YFLEET_CLAIM_HMAC_SECRET);
    ws1.close();

    // Reconnect 3 times
    for (let i = 0; i < 3; i++) {
      const ws = await connectWithClaim(claim!);
      await sendHello(ws);
      ws.close();
    }

    // Generation should be 2 (initial) + 3 (reconnects) = 5
    const agents = await getAgents(config.id);
    const agent = agents.find((a) => a.instance_uid === enrollment.instance_uid);
    expect(agent!.generation).toBe(5);
  });
});

// ─── Bug 3: Zero UID handling ───────────────────────────────────────────────
// Our test helper sends all-zero UID in the OpAMP message (new Uint8Array(16)).
// The server uses whatever UID the client provides (stored in the WS attachment).
// This documents that our server is tolerant of all-zero UIDs even though opamp-go
// clients reject them. Important to verify the server doesn't crash on them.

describe("Zero UID handling (regression)", () => {
  let configId: string;

  beforeAll(async () => {
    await bootstrapSchema();
    const tenant = await createTenant("zero-uid-regression");
    const config = await createConfig(tenant.id, "zero-uid");
    configId = config.id;
  });

  it("server accepts all-zero UID in message body without error", async () => {
    // connectWithEnrollment sends instance_uid: new Uint8Array(16) (all zeros).
    // The server stores the hex representation. This must not crash.
    const { token } = await createEnrollmentToken(configId);
    const { ws, enrollment } = await connectWithEnrollment(token);

    expect(enrollment.instance_uid).toBeDefined();
    // Server uses the UID from the message (all zeros → hex "000...0")
    expect(enrollment.instance_uid).toMatch(/^[0-9a-f]{32}$/);

    ws.close();
  });

  it("enrolled agent with zero UID is stored and retrievable", async () => {
    const { token } = await createEnrollmentToken(configId);
    const { ws, enrollment } = await connectWithEnrollment(token);

    const agents = await getAgents(configId);
    const agent = agents.find((a) => a.instance_uid === enrollment.instance_uid);
    expect(agent).toBeDefined();
    // UID in DB matches what we sent (all-zero hex string)
    expect(agent!.instance_uid).toBe(enrollment.instance_uid);
    // Verify agent is fully functional (has generation, status, etc.)
    expect(agent!.generation).toBeGreaterThan(0);
    expect(agent!.status).toBeDefined();

    ws.close();
  });
});
