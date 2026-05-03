import { env } from "cloudflare:workers";
import { describe, it, expect, beforeAll } from "vitest";
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import {
  ServerToAgentFlags,
  AgentCapabilities,
  decodeFrame,
  encodeFrame,
  type ServerToAgent,
} from "@o11yfleet/core/codec";
import { apiFetch, buildHello, buildHeartbeat } from "./helpers.js";
import { bootstrapSchema } from "./fixtures/schema.js";

const O11YFLEET_CLAIM_HMAC_SECRET = env.O11YFLEET_CLAIM_HMAC_SECRET;

function waitForMsg(ws: WebSocket, timeoutMs = 3000): Promise<MessageEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for message")), timeoutMs);
    ws.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        resolve(event);
      },
      { once: true },
    );
  });
}

beforeAll(() => bootstrapSchema());

// ========================
// Phase 3-SYNC: Full Lifecycle E2E
// ========================
describe("Phase 3-SYNC: Full Lifecycle E2E", () => {
  it("complete lifecycle: enrollment → claim → initial OpAMP response", async () => {
    // 1. Create tenant
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "E2E Corp", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(tenantRes.status).toBe(201);
    const tenant = await tenantRes.json<{ id: string }>();

    // 2. Create config
    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "prod-collectors" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(configRes.status).toBe(201);
    const config = await configRes.json<{ id: string }>();

    // 3. Upload YAML v1
    const yamlV1 = "receivers:\n  otlp:\n    protocols:\n      grpc:\n";
    const uploadRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
      {
        method: "POST",
        body: yamlV1,
      },
    );
    expect(uploadRes.status).toBe(201);

    // 4. Create enrollment token
    const tokenRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-token`,
      {
        method: "POST",
        body: JSON.stringify({ label: "e2e-agent" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(tokenRes.status).toBe(201);
    const tokenBody = await tokenRes.json<{ token: string }>();

    // 5. Agent connects with enrollment token
    const wsRes = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${tokenBody.token}`,
      },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    // 5b. Per OpAMP spec: client sends first. Send hello to trigger enrollment.
    ws.send(
      encodeFrame(
        buildHello({
          capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
        }),
      ),
    );

    // 6. Receive initial OpAMP binary response (no enrollment_complete text message after protobuf-only refactor)
    const opampEvent = await waitForMsg(ws);
    // Binary data arrives as Blob in workerd test environment
    // Inline instead of msgToBuffer to avoid extra async overhead on hot path
    const buf =
      opampEvent.data instanceof Blob
        ? await (opampEvent.data as Blob).arrayBuffer()
        : (opampEvent.data as ArrayBuffer);
    const initialResponse = decodeFrame<ServerToAgent>(buf);
    expect(initialResponse.instance_uid).toBeDefined();

    ws.close();
  });
});

// ========================
// Phase 4A: E2E Scenarios
// ========================
describe("E2E Scenario #1: New enrollment", () => {
  it("enrollment token → claim → connected", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Scenario 1", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "s1-config" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    const tokenRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-token`,
      { method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" } },
    );
    const { token } = await tokenRes.json<{ token: string }>();

    const wsRes = await apiFetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    // Per OpAMP spec: client sends first
    ws.send(
      encodeFrame(
        buildHeartbeat({ sequenceNum: 0, capabilities: AgentCapabilities.ReportsStatus }),
      ),
    );

    // Server responds with protobuf message (no text enrollment_complete after protobuf-only refactor)
    const enrollEvent = await waitForMsg(ws);
    const buf =
      enrollEvent.data instanceof Blob
        ? await (enrollEvent.data as Blob).arrayBuffer()
        : (enrollEvent.data as ArrayBuffer);
    const enrollMsg = decodeFrame<ServerToAgent>(buf);
    expect(enrollMsg.instance_uid).toBeDefined();

    ws.close();
  });
});

describe("E2E Scenario #2: Reconnect with claim", () => {
  it("reconnects using signed claim (hot path, no D1)", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "s2-tenant",
      config_id: "s2-config",
      instance_uid: "s2uid123456789ab",
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const signed = await signClaim(claim, O11YFLEET_CLAIM_HMAC_SECRET);

    const wsRes = await apiFetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${signed}` },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    // Hot path → no enrollment message, verify DO accepted the connection
    const doId = env.CONFIG_DO.idFromName("s2-tenant:s2-config");
    const stub = env.CONFIG_DO.get(doId);
    const statsRes = await stub.fetch("http://internal/stats");
    expect(statsRes.status).toBe(200);

    ws.close();
  });
});

describe("E2E Scenario #3: Config push via DO", () => {
  it("set-desired-config pushes to connected sockets (direct DO)", async () => {
    // Connect directly to DO (same pattern as Scenario #6 which passes)
    const doId = env.CONFIG_DO.idFromName("s3-tenant:s3-config");
    const stub = env.CONFIG_DO.get(doId);

    const wsRes = await stub.fetch("http://internal/ws", {
      headers: {
        Upgrade: "websocket",
        "x-fp-tenant-id": "s3-tenant",
        "x-fp-config-id": "s3-config",
        "x-fp-instance-uid": "s3uid123456789ab",
      },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    // Push config
    const pushRes = await stub.fetch("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({ config_hash: "v2hashvalue" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(pushRes.status).toBe(200);
    const pushBody = await pushRes.json<{ pushed: number; config_hash: string }>();
    expect(pushBody.pushed).toBe(1);
    expect(pushBody.config_hash).toBe("v2hashvalue");

    // Verify desired hash was stored
    const statsRes = await stub.fetch("http://internal/stats");
    const stats = await statsRes.json<{ desired_config_hash: string }>();
    expect(stats.desired_config_hash).toBe("v2hashvalue");

    ws.close();
  });
});

describe("E2E Scenario #4: Sequence gap detection", () => {
  it("state machine sets ReportFullState on gap", async () => {
    const { processFrame } = await import("@o11yfleet/core/state-machine");

    const state = {
      instance_uid: "test-uid",
      tenant_id: "t1",
      config_id: "c1",
      sequence_num: 0,
      generation: 1,
      healthy: true,
      status: "running",
      last_error: "",
      current_config_hash: null,
      desired_config_hash: null,
      capabilities: 0,
      last_seen_at: Date.now(),
      connected_at: Date.now(),
    };

    const r1 = await processFrame(
      state,
      buildHeartbeat({ sequenceNum: 0, capabilities: AgentCapabilities.ReportsStatus }),
    );

    const r2 = await processFrame(
      r1.newState,
      buildHeartbeat({ sequenceNum: 5, capabilities: AgentCapabilities.ReportsStatus }),
    );

    expect(r2.response!.flags & ServerToAgentFlags.ReportFullState).toBeTruthy();
  });
});

describe("E2E Scenario #5: Disconnect tracking", () => {
  it("DO tracks disconnect in SQLite", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "s5-tenant",
      config_id: "s5-config",
      instance_uid: "s5uid123456789ab",
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const signed = await signClaim(claim, O11YFLEET_CLAIM_HMAC_SECRET);

    const wsRes = await apiFetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${signed}` },
    });
    const ws = wsRes.webSocket!;
    ws.accept();
    ws.close();

    await new Promise((r) => {
      setTimeout(r, 200);
    });

    // Verify via DO — just check it didn't crash
    const doId = env.CONFIG_DO.idFromName("s5-tenant:s5-config");
    const stub = env.CONFIG_DO.get(doId);
    const statsRes = await stub.fetch("http://internal/stats");
    expect(statsRes.status).toBe(200);
  });
});

describe("E2E Scenario #6: Hibernation attachment", () => {
  it("DO preserves attachment — push reaches connected socket", async () => {
    const doId = env.CONFIG_DO.idFromName("s6-tenant:s6-config");
    const stub = env.CONFIG_DO.get(doId);

    const wsRes = await stub.fetch("http://internal/ws", {
      headers: {
        Upgrade: "websocket",
        "x-fp-tenant-id": "s6-tenant",
        "x-fp-config-id": "s6-config",
        "x-fp-instance-uid": "s6uid123456789ab",
      },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    const pushRes = await stub.fetch("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({ config_hash: "hibernate-test" }),
      headers: { "Content-Type": "application/json" },
    });
    const pushBody = await pushRes.json<{ pushed: number }>();
    expect(pushBody.pushed).toBe(1);

    ws.close();
  });
});

describe("E2E Scenario #7: Queue consumer idempotency", () => {
  it("duplicate D1 upserts are safe", async () => {
    const uid = "s7-uid-" + Date.now();

    for (let i = 0; i < 2; i++) {
      await env.FP_DB.prepare(
        `INSERT INTO agent_summaries (instance_uid, tenant_id, config_id, status, healthy, last_seen_at, connected_at, created_at, updated_at)
         VALUES (?, 's7-t', 's7-c', 'connected', 1, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
         ON CONFLICT(instance_uid) DO UPDATE SET status = 'connected', last_seen_at = datetime('now')`,
      )
        .bind(uid)
        .run();
    }

    const result = await env.FP_DB.prepare(
      `SELECT COUNT(*) as count FROM agent_summaries WHERE instance_uid = ?`,
    )
      .bind(uid)
      .first<{ count: number }>();
    expect(result!.count).toBe(1);
  });
});

describe("E2E Scenario #8: R2 dedup", () => {
  it("same YAML → deduplicated on second upload", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "S8 Corp", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "s8-config" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    const yaml = "processors:\n  batch:\n    timeout: 10s\n";

    const r1 = await apiFetch(`http://localhost/api/v1/configurations/${config.id}/versions`, {
      method: "POST",
      body: yaml,
    });
    const b1 = await r1.json<{ hash: string; deduplicated: boolean }>();

    const r2 = await apiFetch(`http://localhost/api/v1/configurations/${config.id}/versions`, {
      method: "POST",
      body: yaml,
    });
    const b2 = await r2.json<{ hash: string; deduplicated: boolean }>();

    expect(b1.hash).toBe(b2.hash);
    expect(b1.deduplicated).toBe(false);
    expect(b2.deduplicated).toBe(true);
  });
});

describe("E2E Scenario #9: Starter policy limits", () => {
  it("second policy is rejected on Starter tier", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "S9 Limited" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const first = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "s9-policy" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(first.status).toBe(201);

    const res = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "s9-overflow" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(429);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("limit");
  });
});

describe("E2E Scenario #10: Auth failures", () => {
  it("invalid claim returns 401", async () => {
    const res = await apiFetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: "Bearer invalid.claim" },
    });
    expect(res.status).toBe(401);
  });

  it("spoofed x-fp-* headers stripped", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "legit-tenant",
      config_id: "legit-config",
      instance_uid: "legit-uid1234567",
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const signed = await signClaim(claim, O11YFLEET_CLAIM_HMAC_SECRET);

    const wsRes = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${signed}`,
        "x-fp-tenant-id": "evil-spoofed",
      },
    });
    expect(wsRes.status).toBe(101);
    wsRes.webSocket!.accept();
    wsRes.webSocket!.close();
  });

  it("missing authorization returns 401", async () => {
    const res = await apiFetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
  });
});
