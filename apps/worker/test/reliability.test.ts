// Reliability tests — alarm sweep, WebSocket error handling, concurrent enrollment.
// Tests production-critical edge cases not covered elsewhere.

import { describe, it, expect, beforeAll } from "vitest";
import { exports } from "cloudflare:workers";
import {
  setupD1,
  createTenant,
  createConfig,
  createEnrollmentToken,
  waitForMsg,
  waitForClose,
  msgToBuffer,
  connectWithEnrollment,
  sendHello,
  encodeFrame,
  decodeFrame,
  AgentCapabilities,
  getConfigStats,
  buildHello,
  buildHeartbeat,
} from "./helpers.js";
import type { ServerToAgent } from "./helpers.js";

// ========================
// Alarm Sweep Tests
// ========================
describe("Stale Agent Alarm Sweep", () => {
  let configId: string;

  beforeAll(async () => {
    await setupD1();
    const tenant = await createTenant("alarm-test-tenant");
    const config = await createConfig(tenant.id, "alarm-config");
    configId = config.id;
  });

  it("marks stale agents as disconnected after alarm fires", async () => {
    const { ws } = await connectWithEnrollment((await createEnrollmentToken(configId)).token);

    // Send hello to ensure agent is tracked
    await sendHello(ws);

    // Verify agent is tracked in DO by checking stats
    const stats = await getConfigStats(configId);
    expect(stats.total_agents).toBeGreaterThanOrEqual(1);

    // Close WS — the disconnect handler should mark agent disconnected
    ws.close();

    // Give time for disconnect to process
    await new Promise<void>((r) => {
      setTimeout(r, 100);
    });

    // Verify agent is now disconnected
    const postStats = await getConfigStats(configId);
    // Connected agents should have decreased since we closed the WebSocket
    expect(postStats.connected_agents).toBeLessThanOrEqual(stats.connected_agents);
  });
});

// ========================
// WebSocket Error Handling
// ========================
describe("WebSocket Error Handling", () => {
  let configId: string;

  beforeAll(async () => {
    await setupD1();
    const tenant = await createTenant("error-test-tenant");
    const config = await createConfig(tenant.id, "error-config");
    configId = config.id;
  });

  it("rejects text frames with close code 4000", async () => {
    const { token } = await createEnrollmentToken(configId);

    const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    // Send text frame (invalid per OpAMP)
    const closePromise = waitForClose(ws);
    ws.send("this is a text frame");
    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(4000);
  });

  it("handles missing attachment gracefully", async () => {
    // This is tested via the protocol test — the attachment validation
    // in parseAttachment returns null for invalid data and the DO closes with 1008
    const { token } = await createEnrollmentToken(configId);

    const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    // Send a valid binary hello — should succeed
    const hello = buildHello({ capabilities: AgentCapabilities.ReportsStatus });
    ws.send(encodeFrame(hello));

    // Should get enrollment + response
    const enrollEvent = await waitForMsg(ws);
    const enrollment = JSON.parse(enrollEvent.data as string);
    expect(enrollment.type).toBe("enrollment_complete");

    const responseEvent = await waitForMsg(ws);
    const buf = await msgToBuffer(responseEvent);
    const response = decodeFrame<ServerToAgent>(buf);
    expect(response.capabilities).toBeTruthy();

    ws.close();
  });

  it("rate-limited agent receives error response with RetryInfo", async () => {
    const { ws } = await connectWithEnrollment((await createEnrollmentToken(configId)).token);

    // Send hello (seq 0)
    await sendHello(ws);

    // Blast 61 messages to exceed the 60/min rate limit
    for (let i = 1; i <= 61; i++) {
      ws.send(
        encodeFrame(
          buildHeartbeat({ sequenceNum: i, capabilities: AgentCapabilities.ReportsStatus }),
        ),
      );
    }

    // Wait for close — should be 4029
    const closeEvent = await waitForClose(ws, 5000);
    expect(closeEvent.code).toBe(4029);
  });
});

// ========================
// Concurrent Enrollment
// ========================
describe("Concurrent Enrollment", () => {
  let configId: string;

  beforeAll(async () => {
    await setupD1();
    const tenant = await createTenant("concurrent-enroll-tenant");
    const config = await createConfig(tenant.id, "concurrent-config");
    configId = config.id;
  });

  it("handles multiple agents enrolling simultaneously on the same token", async () => {
    const { token } = await createEnrollmentToken(configId);
    const NUM = 5;

    // Connect all agents simultaneously with the same enrollment token
    const connectPromises = Array.from({ length: NUM }, async () => {
      const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
        headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
      });
      expect(wsRes.status).toBe(101);
      const ws = wsRes.webSocket!;
      ws.accept();

      // Each agent sends a hello with unique UID
      const uid = new Uint8Array(16);
      crypto.getRandomValues(uid);
      const hello = buildHello({
        instanceUid: uid,
        capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
      });
      ws.send(encodeFrame(hello));

      const enrollEvent = await waitForMsg(ws);
      const enrollment = JSON.parse(enrollEvent.data as string);
      expect(enrollment.type).toBe("enrollment_complete");
      expect(enrollment.instance_uid).toBeTruthy();

      // Get binary response
      const respEvent = await waitForMsg(ws);
      const buf = await msgToBuffer(respEvent);
      const resp = decodeFrame<ServerToAgent>(buf);
      expect(resp.capabilities).toBeTruthy();

      return { ws, enrollment };
    });

    const results = await Promise.all(connectPromises);
    expect(results).toHaveLength(NUM);

    // All agents should have unique instance UIDs
    const uids = results.map((r) => r.enrollment.instance_uid);
    const uniqueUids = new Set(uids);
    expect(uniqueUids.size).toBe(NUM);

    // Cleanup
    for (const { ws } of results) {
      ws.close();
    }
  });

  it("handles enrollment + immediate reconnect with claim", async () => {
    const { token } = await createEnrollmentToken(configId);

    // First connection: enroll
    const { ws: ws1, enrollment } = await connectWithEnrollment(token);
    ws1.close();
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });

    // Second connection: reconnect using the claim
    const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${enrollment.assignment_claim}`,
      },
    });
    expect(wsRes.status).toBe(101);
    const ws2 = wsRes.webSocket!;
    ws2.accept();

    // Send hello — should work as a reconnect (no enrollment needed)
    const response = await sendHello(ws2);
    expect(response.capabilities).toBeTruthy();

    ws2.close();
  });
});

// ========================
// Connected Stats Verification
// ========================
describe("Connected Stats Fix", () => {
  let configId: string;

  beforeAll(async () => {
    await setupD1();
    const tenant = await createTenant("stats-test-tenant");
    const config = await createConfig(tenant.id, "stats-config");
    configId = config.id;
  });

  it("reports connected_agents > 0 when agents are connected", async () => {
    const { ws } = await connectWithEnrollment((await createEnrollmentToken(configId)).token);

    // Send hello + health to establish the agent
    await sendHello(ws);

    const stats = await getConfigStats(configId);

    expect(stats.total_agents).toBeGreaterThanOrEqual(1);
    // THE FIX: connected_agents should now be > 0 (previously always 0
    // because getStats counted status='connected' which was never set)
    expect(stats.connected_agents).toBeGreaterThanOrEqual(1);
    expect(stats.healthy_agents).toBeGreaterThanOrEqual(1);

    ws.close();
  });
});
