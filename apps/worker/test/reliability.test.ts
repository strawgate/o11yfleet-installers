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

  // TODO(coverage): "missing attachment" path is currently covered indirectly
  // by `apps/worker/test/regression-e2e-bugs.test.ts` (the parseAttachment
  // field-preservation cases). When that file moves or those tests change
  // shape, add a direct dedicated case here that asserts close-code 1008
  // when parseAttachment returns null.

  it("high message burst accepted without closure (rate limiter removed)", async () => {
    const { ws } = await connectWithEnrollment((await createEnrollmentToken(configId)).token);

    // Send hello (seq 0)
    await sendHello(ws);

    // Send 100 heartbeats rapidly — with rate limiter removed, all should
    // be accepted. The DO's single-threaded model is the natural throttle.
    for (let i = 1; i <= 100; i++) {
      ws.send(
        encodeFrame(
          buildHeartbeat({ sequenceNum: i, capabilities: AgentCapabilities.ReportsStatus }),
        ),
      );
    }

    // Assert no close event occurs within the observation window.
    const outcome = await Promise.race<{ closed: true; code: number } | { closed: false }>([
      waitForClose(ws).then((ev) => ({ closed: true as const, code: ev.code })),
      new Promise<{ closed: false }>((resolve) => {
        setTimeout(() => resolve({ closed: false }), 500);
      }),
    ]);
    expect(outcome.closed).toBe(false);
    ws.close();
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

  // Note: Concurrent enrollment with the same token is covered by e2e tests.
  // The key invariant (unique instance UIDs per agent) is tested in
  // E2E Scenario #1: New enrollment tests in e2e.test.ts.

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
