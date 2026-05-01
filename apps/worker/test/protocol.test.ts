import { env } from "cloudflare:workers";
import { describe, it, expect, beforeAll } from "vitest";
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import {
  AgentCapabilities,
  ServerCapabilities,
  ServerToAgentFlags,
  encodeFrame,
  decodeFrame,
  type ServerToAgent,
} from "@o11yfleet/core/codec";
import { apiFetch, O11YFLEET_CLAIM_HMAC_SECRET, buildHello, buildHeartbeat } from "./helpers.js";

beforeAll(async () => {
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'starter', max_configs INTEGER NOT NULL DEFAULT 1, max_agents_per_config INTEGER NOT NULL DEFAULT 1000, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS configurations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, current_config_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS config_versions (id TEXT PRIMARY KEY, config_id TEXT NOT NULL, tenant_id TEXT NOT NULL, config_hash TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(config_id, config_hash))`,
  );
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS enrollment_tokens (id TEXT PRIMARY KEY, config_id TEXT NOT NULL, tenant_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, label TEXT, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS agent_summaries (instance_uid TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, config_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unknown', healthy INTEGER NOT NULL DEFAULT 1, current_config_hash TEXT, last_seen_at TEXT, connected_at TEXT, disconnected_at TEXT, agent_description TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
});

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

async function makeSignedClaim(): Promise<{ claim: AssignmentClaim; token: string }> {
  const claim: AssignmentClaim = {
    v: 1,
    tenant_id: "test-tenant",
    config_id: "test-config",
    instance_uid: crypto.randomUUID().replace(/-/g, ""),
    generation: 1,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = await signClaim(claim, O11YFLEET_CLAIM_HMAC_SECRET);
  return { claim, token };
}

// ========================
// API Authentication Tests
// ========================
describe("API Authentication", () => {
  it("CORS preflight returns 204 with proper headers", async () => {
    const response = await apiFetch("http://localhost/api/admin/tenants", {
      method: "OPTIONS",
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.o11yfleet.com");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("allows Vite dev server origins in local environments", async () => {
    const response = await apiFetch("http://localhost/api/admin/tenants", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:3001",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:3001");
  });

  it("allows fallback Vite dev server ports in local environments", async () => {
    const response = await apiFetch("http://localhost/api/admin/tenants", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:3002",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:3002");
  });

  it("API responses include CORS headers", async () => {
    const response = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "CORS Test" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.o11yfleet.com");
  });

  it("allows dev frontend origins in dev environment", async () => {
    const devOrigins = [
      "https://dev-app.o11yfleet.com",
      "https://dev-admin.o11yfleet.com",
      "https://dev.o11yfleet.com",
    ];
    for (const origin of devOrigins) {
      const response = await apiFetch("http://localhost/api/admin/tenants", {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
      });
      expect(response.status).toBe(204, `Expected ${origin} to be allowed in dev`);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    }
  });

  it("allows only the Terraform-managed static site Worker origin for the active environment", async () => {
    const previousEnvironment = env.ENVIRONMENT;
    const cases = [
      {
        environment: "production",
        allowed: "https://o11yfleet-site-worker.o11yfleet.workers.dev",
        rejected: "https://o11yfleet-site-worker-staging.o11yfleet.workers.dev",
      },
      {
        environment: "staging",
        allowed: "https://o11yfleet-site-worker-staging.o11yfleet.workers.dev",
        rejected: "https://o11yfleet-site-worker-dev.o11yfleet.workers.dev",
      },
      {
        environment: "dev",
        allowed: "https://o11yfleet-site-worker-dev.o11yfleet.workers.dev",
        rejected: "http://o11yfleet-site-worker-dev.o11yfleet.workers.dev",
      },
    ] as const;

    try {
      for (const testCase of cases) {
        env.ENVIRONMENT = testCase.environment;
        const allowedResponse = await apiFetch("http://localhost/api/admin/tenants", {
          method: "OPTIONS",
          headers: { Origin: testCase.allowed, "Access-Control-Request-Method": "GET" },
        });
        expect(allowedResponse.status).toBe(204, `Expected ${testCase.allowed} to be allowed`);
        expect(allowedResponse.headers.get("Access-Control-Allow-Origin")).toBe(testCase.allowed);

        const rejectedResponse = await apiFetch("http://localhost/api/admin/tenants", {
          method: "OPTIONS",
          headers: { Origin: testCase.rejected, "Access-Control-Request-Method": "GET" },
        });
        expect(rejectedResponse.status).toBe(204);
        expect(rejectedResponse.headers.get("Access-Control-Allow-Origin")).toBe(
          "https://app.o11yfleet.com",
        );
      }
    } finally {
      env.ENVIRONMENT = previousEnvironment;
    }
  });

  it("does not allow retired Pages preview origins", async () => {
    const retiredPreviewOrigin = "https://abc123.o11yfleet-staging-app.pages.dev";
    const response = await apiFetch("http://localhost/api/admin/tenants", {
      method: "OPTIONS",
      headers: { Origin: retiredPreviewOrigin, "Access-Control-Request-Method": "GET" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.o11yfleet.com");
  });

  it("allows staging origins in staging environment", async () => {
    const previousEnvironment = env.ENVIRONMENT;
    env.ENVIRONMENT = "staging";
    try {
      const stagingOrigin = "https://staging-app.o11yfleet.com";
      const response = await apiFetch("http://localhost/api/admin/tenants", {
        method: "OPTIONS",
        headers: { Origin: stagingOrigin, "Access-Control-Request-Method": "GET" },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(stagingOrigin);
    } finally {
      env.ENVIRONMENT = previousEnvironment;
    }
  });

  it("does not allow staging origins when ENVIRONMENT is dev", async () => {
    const stagingOrigin = "https://staging-app.o11yfleet.com";
    const response = await apiFetch("http://localhost/api/admin/tenants", {
      method: "OPTIONS",
      headers: { Origin: stagingOrigin, "Access-Control-Request-Method": "GET" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.o11yfleet.com");
  });
});

// ========================
// DO Protocol Enforcement
// ========================
describe("DO Protocol Enforcement", () => {
  it("text frames are rejected with close code 4000", async () => {
    const { token } = await makeSignedClaim();

    const response = await apiFetch(
      `http://localhost/v1/opamp?token=${encodeURIComponent(token)}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(response.status).toBe(101);

    const ws = response.webSocket!;
    ws.accept();

    // Send text frame — should trigger close
    ws.send("this is a text frame");

    const closePromise = new Promise<CloseEvent>((resolve) => {
      ws.addEventListener("close", (e) => resolve(e as CloseEvent), { once: true });
    });
    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(4000);
  });

  it("binary hello message gets a valid response", async () => {
    const { token } = await makeSignedClaim();

    const response = await apiFetch(
      `http://localhost/v1/opamp?token=${encodeURIComponent(token)}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(response.status).toBe(101);

    const ws = response.webSocket!;
    ws.accept();

    const hello = buildHello({
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
    });
    ws.send(encodeFrame(hello));

    const msg = await waitForMsg(ws);
    const buf =
      msg.data instanceof Blob ? await (msg.data as Blob).arrayBuffer() : (msg.data as ArrayBuffer);
    const serverMsg = decodeFrame<ServerToAgent>(buf);
    expect(serverMsg.instance_uid).toBeDefined();
    expect(serverMsg.capabilities).toBeDefined();
    // Verify required capabilities are present (bitwise, so new caps don't break this)
    expect(serverMsg.capabilities! & ServerCapabilities.AcceptsStatus).toBeTruthy();
    expect(serverMsg.capabilities! & ServerCapabilities.OffersRemoteConfig).toBeTruthy();
    expect(serverMsg.capabilities! & ServerCapabilities.AcceptsEffectiveConfig).toBeTruthy();
    expect(serverMsg.capabilities! & ServerCapabilities.OffersConnectionSettings).toBeTruthy();

    ws.close();
  });

  it("desired-config push uses the same server capabilities as hello responses", async () => {
    const { token } = await makeSignedClaim();
    const response = await apiFetch(
      `http://localhost/v1/opamp?token=${encodeURIComponent(token)}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(response.status).toBe(101);

    const ws = response.webSocket!;
    ws.accept();

    const hello = buildHeartbeat({
      sequenceNum: 0,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
    });
    ws.send(encodeFrame(hello));
    await waitForMsg(ws); // hello response

    const id = env.CONFIG_DO.idFromName("test-tenant:test-config");
    const stub = env.CONFIG_DO.get(id);
    const desiredConfigHash = "00112233445566778899aabbccddeeff";
    const pushPromise = waitForMsg(ws);
    const setRes = await stub.fetch("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({ config_hash: desiredConfigHash, config_content: "receivers: {}" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(setRes.status).toBe(200);

    const pushMsg = await pushPromise;
    const pushBuf =
      pushMsg.data instanceof Blob
        ? await (pushMsg.data as Blob).arrayBuffer()
        : (pushMsg.data as ArrayBuffer);
    const push = decodeFrame<ServerToAgent>(pushBuf);

    // Verify required capabilities are present on config push (bitwise)
    expect(push.capabilities! & ServerCapabilities.AcceptsStatus).toBeTruthy();
    expect(push.capabilities! & ServerCapabilities.OffersRemoteConfig).toBeTruthy();
    expect(push.capabilities! & ServerCapabilities.AcceptsEffectiveConfig).toBeTruthy();
    expect(push.capabilities! & ServerCapabilities.OffersConnectionSettings).toBeTruthy();
    expect(push.remote_config).toBeDefined();

    ws.close();
  });
});

// ========================
// DO Stats and Agents Endpoints
// ========================
describe("DO Stats Endpoints", () => {
  it("stats returns fleet metrics", async () => {
    const id = env.CONFIG_DO.idFromName("stats-test:config-1");
    const stub = env.CONFIG_DO.get(id);

    const response = await stub.fetch("http://internal/stats");
    expect(response.status).toBe(200);
    const stats = await response.json<{
      total_agents: number;
      connected_agents: number;
      healthy_agents: number;
      active_websockets: number;
    }>();
    expect(stats.total_agents).toBeTypeOf("number");
    expect(stats.connected_agents).toBeTypeOf("number");
    expect(stats.healthy_agents).toBeTypeOf("number");
    expect(stats.active_websockets).toBeTypeOf("number");
  });

  it("agents returns agent list", async () => {
    const id = env.CONFIG_DO.idFromName("agents-test:config-1");
    const stub = env.CONFIG_DO.get(id);

    const response = await stub.fetch("http://internal/agents");
    expect(response.status).toBe(200);
    const data = await response.json<{ agents: unknown[] }>();
    expect(Array.isArray(data.agents)).toBe(true);
  });

  it("set-desired-config stores hash", async () => {
    const id = env.CONFIG_DO.idFromName("desired-test:config-1");
    const stub = env.CONFIG_DO.get(id);

    const setRes = await stub.fetch("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({ config_hash: "abc123" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(setRes.status).toBe(200);
    const result = await setRes.json<{ pushed: number; config_hash: string }>();
    expect(result.config_hash).toBe("abc123");
    expect(result.pushed).toBe(0); // no connected agents

    // Verify stats reflects the hash
    const statsRes = await stub.fetch("http://internal/stats");
    const stats = await statsRes.json<{ desired_config_hash: string }>();
    expect(stats.desired_config_hash).toBe("abc123");
  });

  it("set-desired-config with content stores content", async () => {
    const id = env.CONFIG_DO.idFromName("content-test:config-1");
    const stub = env.CONFIG_DO.get(id);

    const yamlContent = "receivers:\n  otlp:\n    protocols:\n      grpc:";
    const setRes = await stub.fetch("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({ config_hash: "hash456", config_content: yamlContent }),
      headers: { "Content-Type": "application/json" },
    });
    expect(setRes.status).toBe(200);
  });

  it("set-desired-config rejects missing hash", async () => {
    const id = env.CONFIG_DO.idFromName("reject-test:config-1");
    const stub = env.CONFIG_DO.get(id);

    const res = await stub.fetch("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("unknown DO path returns 404", async () => {
    const id = env.CONFIG_DO.idFromName("404-test:config-1");
    const stub = env.CONFIG_DO.get(id);

    const res = await stub.fetch("http://internal/nonexistent");
    expect(res.status).toBe(404);
  });
});

// ========================
// Framing Edge Cases
// ========================
describe("Framing Edge Cases", () => {
  it("handles sequence gap — requests full state report", async () => {
    const { token } = await makeSignedClaim();

    const response = await apiFetch(
      `http://localhost/v1/opamp?token=${encodeURIComponent(token)}`,
      { headers: { Upgrade: "websocket" } },
    );
    const ws = response.webSocket!;
    ws.accept();

    // Send hello (seq 0)
    const hello = buildHello({ capabilities: AgentCapabilities.ReportsStatus });
    ws.send(encodeFrame(hello));
    await waitForMsg(ws);

    // Send with sequence gap (skip to 5 instead of 1)
    const gapMsg = buildHeartbeat({
      sequenceNum: 5,
      capabilities: AgentCapabilities.ReportsStatus,
    });
    ws.send(encodeFrame(gapMsg));
    const gapResponse = await waitForMsg(ws);
    const buf2 =
      gapResponse.data instanceof Blob
        ? await (gapResponse.data as Blob).arrayBuffer()
        : (gapResponse.data as ArrayBuffer);
    const serverMsg = decodeFrame<ServerToAgent>(buf2);

    // Server should request full state report
    expect(serverMsg.flags & ServerToAgentFlags.ReportFullState).toBe(
      ServerToAgentFlags.ReportFullState,
    );

    ws.close();
  });
});
