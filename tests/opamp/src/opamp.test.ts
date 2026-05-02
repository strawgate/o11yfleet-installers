/**
 * OpAMP Protocol Compliance Tests
 *
 * Tests our server against the OpAMP specification:
 *   https://github.com/open-telemetry/opamp-spec/blob/main/specification.md
 *
 * Each test references the relevant spec section. Tests are written to describe
 * correct behavior — failing tests indicate spec compliance gaps to fix.
 *
 * Prerequisites:
 *   just dev       # start wrangler dev (port 8787)
 *   just setup     # migrate + seed
 *
 * Run: just test-opamp
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { FakeOpampAgent } from "@o11yfleet/test-utils";
import {
  encodeFrame,
  type AgentToServer,
  type ServerToAgent,
  AgentCapabilities,
  RemoteConfigStatuses,
  ServerToAgentFlags,
  ServerErrorResponseType,
} from "@o11yfleet/core/codec";

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = process.env.FP_URL ?? "http://localhost:8787";
const WS_URL = BASE_URL.replace(/^http/, "ws") + "/v1/opamp";
// Match the resolution chain in tests/e2e/src/helpers.ts so this stays
// in sync with however CI/the worker exports the deployment-level
// bearer secret. The `O11YFLEET_API_BEARER_SECRET` rotation case is the
// one the existing fallback chain protects against.
const API_KEY =
  process.env.FP_API_KEY ??
  process.env.O11YFLEET_API_KEY ??
  process.env.O11YFLEET_API_BEARER_SECRET ??
  "test-api-secret-for-dev-only-32chars";
const ADMIN_EMAIL = process.env.O11YFLEET_SEED_ADMIN_EMAIL ?? "admin@o11yfleet.com";
// No fallback — `just dev-up` randomizes the placeholder in
// apps/worker/.dev.vars; CI sets this env var explicitly.
const ADMIN_PASSWORD = process.env.O11YFLEET_SEED_ADMIN_PASSWORD;

let adminSessionCookie: string | null = null;
async function ensureAdminSession(): Promise<string> {
  if (adminSessionCookie) return adminSessionCookie;
  if (!ADMIN_PASSWORD) {
    throw new Error("Set O11YFLEET_SEED_ADMIN_PASSWORD before running opamp tests");
  }
  const seedRes = await fetch(`${BASE_URL}/auth/seed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!seedRes.ok) throw new Error(`/auth/seed failed: ${seedRes.status}`);
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE_URL },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`/auth/login failed: ${loginRes.status}`);
  const match = loginRes.headers.get("set-cookie")?.match(/fp_session=([^;]+)/);
  if (!match) throw new Error(`/auth/login returned no fp_session cookie`);
  adminSessionCookie = `fp_session=${match[1]}`;
  return adminSessionCookie;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const agents: FakeOpampAgent[] = [];
const rawSockets: WebSocket[] = [];

function createAgent(opts: Record<string, unknown> = {}) {
  const agent = new FakeOpampAgent({
    endpoint: WS_URL,
    ...opts,
  } as Record<string, unknown>);
  agents.push(agent);
  return agent;
}

async function api<T = unknown>(
  path: string,
  opts?: RequestInit,
): Promise<{ status: number; data: T }> {
  const baseHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (path.startsWith("/api/admin/")) {
    baseHeaders.Cookie = await ensureAdminSession();
    baseHeaders.Origin = BASE_URL;
  } else {
    baseHeaders.Authorization = `Bearer ${API_KEY}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { ...baseHeaders, ...((opts?.headers as Record<string, string>) ?? {}) },
  });
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
}

async function setupTenantAndConfig(): Promise<{
  tenantId: string;
  configId: string;
  token: string;
}> {
  const name = `opamp-test-${Date.now()}`;
  const { data: tenant } = await api<{ id: string }>("/api/admin/tenants", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  const { data: config } = await api<{ id: string }>("/api/v1/configurations", {
    method: "POST",
    body: JSON.stringify({ name: "test-config" }),
    headers: { "X-Tenant-Id": tenant.id } as Record<string, string>,
  });
  const { data: tokenData } = await api<{ token: string }>(
    `/api/v1/configurations/${config.id}/enrollment-token`,
    {
      method: "POST",
      body: JSON.stringify({ label: "opamp-test" }),
      headers: { "X-Tenant-Id": tenant.id } as Record<string, string>,
    },
  );
  return { tenantId: tenant.id, configId: config.id, token: tokenData.token };
}

async function enrollAgent(token: string, name?: string): Promise<FakeOpampAgent> {
  const agent = createAgent({ enrollmentToken: token, name: name ?? `agent-${Date.now()}` });
  await agent.connectAndEnroll();
  return agent;
}

function settle(ms = 300): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

async function waitForServer(maxWaitMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${BASE_URL}/healthz`);
      if (res.status === 200) return;
    } catch {
      /* retry */
    }
    await settle(200);
  }
  throw new Error(`Server not ready after ${maxWaitMs}ms`);
}

// ─── Setup & Cleanup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await waitForServer();
});

afterEach(() => {
  for (const agent of agents) {
    try {
      agent.close();
    } catch {
      /* ignore */
    }
  }
  agents.length = 0;
  for (const ws of rawSockets) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  rawSockets.length = 0;
});

// ─── §4.1 WebSocket Transport ────────────────────────────────────────────────

describe("WebSocket Transport (§4.1)", () => {
  it("accepts binary WebSocket frames with varint-length header", async () => {
    // Spec: Messages are encoded as binary protobuf with a varint size prefix
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token);

    await agent.sendHeartbeat();
    const response = await agent.waitForMessage();

    // If we got a valid decoded response, the server accepted our binary frame
    expect(response).toBeDefined();
    expect(response.flags).toBeDefined();
  });

  it("rejects text WebSocket frames with close code 4000", async () => {
    // Spec: Server MUST only accept binary messages. Text frames are invalid.
    const { token } = await setupTenantAndConfig();
    const url = `${WS_URL}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // Send an invalid text frame that isn't "ping" (keepalive)
    ws.send("this is not valid opamp");

    const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.onclose = (e) => resolve({ code: e.code, reason: e.reason });
    });

    // Server should close with 4000 (or similar protocol error)
    expect(closeEvent.code).toBeGreaterThanOrEqual(4000);
  });

  it("client sends first after WebSocket connect", async () => {
    // Spec §4.1: "The client MUST send the first message after the connection is established."
    // Our enrollment flow expects: connect → client sends hello → server responds
    const { token } = await setupTenantAndConfig();
    const agent = createAgent({ enrollmentToken: token });
    await agent.connect();

    // Send hello (client sends first)
    await agent.sendHello();
    const response = await agent.waitForMessage();

    // Server responded to our first message
    expect(response).toBeDefined();
    expect(response.instance_uid).toBeDefined();
  });
});

// ─── §4.2 Connection Establishment ──────────────────────────────────────────

describe("Connection Establishment (§4.2)", () => {
  it("responds to first message with server capabilities and instance_uid", async () => {
    // Spec: ServerToAgent MUST contain instance_uid echoing the agent's UID
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token);

    await agent.sendHeartbeat();
    const response = await agent.waitForMessage();

    expect(response.instance_uid).toBeDefined();
    expect(response.capabilities).toBeGreaterThan(0);
  });

  it("requests full state on first connection with ReportFullState flag", async () => {
    // Spec §4.2: Server MAY respond with ReportFullState flag to request
    // complete agent state on first connection.
    const { token } = await setupTenantAndConfig();
    const agent = createAgent({ enrollmentToken: token });
    await agent.connect();
    await agent.sendHello();
    const response = await agent.waitForMessage();

    // The enrollment response or the first hello response should have ReportFullState
    // This is recommended but not required — test documents current behavior
    expect(response.flags & ServerToAgentFlags.ReportFullState).toBe(
      ServerToAgentFlags.ReportFullState,
    );
  });

  it("rejects connection with invalid auth token (HTTP 401 or WS close)", async () => {
    // Spec: Server should reject unauthorized connections
    const agent = createAgent({ enrollmentToken: "totally-invalid-token" });

    try {
      await agent.connect();
      // If connect succeeds, server should close quickly
      await agent.sendHello();
      await agent.waitForMessage(3000);
      // If we get here without error, check close code
      expect(agent.lastCloseCode).toBeGreaterThanOrEqual(4000);
    } catch (err) {
      // Connection rejected or errored — verify it's actually a rejection
      expect(err).toBeDefined();
    }
  });
});

// ─── §4.3 Heartbeat ─────────────────────────────────────────────────────────

describe("Heartbeat (§4.3)", () => {
  it("responds to heartbeat messages without error", async () => {
    // Spec: Server MUST respond to every AgentToServer message
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token);

    await agent.sendHeartbeat();
    const response = await agent.waitForMessage();

    expect(response).toBeDefined();
    expect(response.error_response).toBeUndefined();
  });

  it("includes heart_beat_interval in response to set agent heartbeat cadence", async () => {
    // Spec §4.3.2: Server MAY send recommended heartbeat interval
    // Our server SHOULD send this to manage DO wake frequency
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token);

    await agent.sendHeartbeat();
    const response = await agent.waitForMessage();

    // Server should tell agents a preferred heartbeat interval
    expect(response.heart_beat_interval).toBeDefined();
    expect(response.heart_beat_interval).toBeGreaterThan(0);
  });
});

// ─── §4.4 ServerToAgent Message ──────────────────────────────────────────────

describe("ServerToAgent Message (§4.4)", () => {
  it("always includes instance_uid matching the agent", async () => {
    // Spec: "instance_uid is set by Server and MUST match the instance_uid
    // field previously received from the Agent"
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token);

    await agent.sendHeartbeat();
    const response = await agent.waitForMessage();

    const responseUid = response.instance_uid;
    expect(responseUid).toBeDefined();
    expect(responseUid.length).toBeGreaterThan(0);
  });

  it("includes server capabilities in response", async () => {
    // Spec: ServerToAgent.capabilities indicates what the server can do
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token);

    await agent.sendHeartbeat();
    const response = await agent.waitForMessage();

    expect(response.capabilities).toBeDefined();
    // Server should at least accept status
    expect(response.capabilities & 0x01).toBe(0x01); // AcceptsStatus
  });
});

// ─── §4.5 Error Handling ─────────────────────────────────────────────────────

describe("Error Handling (§4.5)", () => {
  // SKIPPED: Worker is protobuf-only after #399 — TEXT/JSON frames are not supported.
  // Re-enable when JSON/TEXT frame support is added: #463
  // Server disconnects instead of sending error_response when it can't decode the message.
  it.skip("returns error_response for malformed protobuf instead of disconnecting", async () => {
    // Spec §4.5.1: "If the Server receives a malformed AgentToServer message,
    // it SHOULD respond with a ServerToAgent that has the error_response field set"
    const { token } = await setupTenantAndConfig();
    const url = `${WS_URL}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    rawSockets.push(ws);
    ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // First send a valid hello to authenticate
    const agent = createAgent({ enrollmentToken: token });
    await agent.connect();
    await agent.sendHello();
    const enrollResponse = await agent.waitForMessage();
    expect(enrollResponse).toBeDefined();

    // Now send garbage binary that isn't valid protobuf
    const _garbage = new Uint8Array([0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

    // Use the raw websocket to send garbage after enrollment
    // Re-connect with the assignment claim
    const claim = enrollResponse.connection_settings?.opamp?.headers
      ?.find((h) => h.key === "Authorization")
      ?.value?.replace("Bearer ", "");
    agent.close();

    if (!claim) {
      throw new Error(
        "Enrollment did not return an assignment claim in connection_settings — cannot test malformed frame handling",
      );
    }

    const agent2 = createAgent({ assignmentClaim: claim });
    await agent2.connect();
    await agent2.sendHello();
    await agent2.waitForMessage();

    // Send malformed binary frame (varint header + garbage)
    const malformed = new Uint8Array([0x05, 0xde, 0xad, 0xbe, 0xef, 0x00]);
    // We need raw WS access — use a fresh connection
    const ws2 = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    rawSockets.push(ws2);
    ws2.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws2.onopen = () => resolve();
      ws2.onerror = (e) => reject(e);
    });

    // Send a valid hello first
    const helloMsg: AgentToServer = {
      instance_uid: crypto.getRandomValues(new Uint8Array(16)),
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    ws2.send(encodeFrame(helloMsg));

    // Wait for response to hello
    await new Promise<void>((resolve) => {
      ws2.onmessage = () => resolve();
    });

    // Now send garbage
    ws2.send(malformed);

    // Spec says: respond with error_response, NOT disconnect
    const result = await new Promise<
      { type: "message"; data: ArrayBuffer } | { type: "close"; code: number }
    >((resolve) => {
      ws2.onmessage = (e) => resolve({ type: "message", data: e.data as ArrayBuffer });
      ws2.onclose = (e) => resolve({ type: "close", code: e.code });
      setTimeout(() => resolve({ type: "close", code: -1 }), 5000);
    });

    if (result.type === "message") {
      // Got an error_response back — correct behavior per spec
      const { decodeFrame } = await import("@o11yfleet/core/codec");
      const msg = decodeFrame<ServerToAgent>(result.data);
      expect(msg.error_response).toBeDefined();
      expect(msg.error_response!.type).toBe(ServerErrorResponseType.BadRequest);
    } else {
      // Server disconnected instead of sending error — this is the gap
      // Test fails to document the compliance issue
      expect(result.type).toBe("message");
    }

    ws.close();
    ws2.close();
  });
});

// ─── §5.1 AgentIdentification ────────────────────────────────────────────────

describe("AgentIdentification (§5.1)", () => {
  it("assigns a new instance_uid when agent sends duplicate UID", async () => {
    // Spec §5.1: "If the Server detects that the instance_uid is already used
    // by another Agent, it SHOULD generate a new instance_uid and send it to
    // the Agent via agent_identification.new_instance_uid"
    const { token } = await setupTenantAndConfig();

    // Enroll first agent
    const agent1 = await enrollAgent(token, "agent-dup-1");
    const uid1 = agent1.uid;

    // Agent1 stays connected. Now connect a SECOND agent with the SAME UID.
    const agent2 = createAgent({
      enrollmentToken: token,
      instanceUid: uid1,
      name: "agent-dup-2",
    });

    await agent2.connect();
    await agent2.sendHello();
    const response = await agent2.waitForMessage(5000);

    // Server MUST do one of:
    // 1. Send agent_identification.new_instance_uid (preferred per spec)
    // 2. Reject with a close code ≥ 4000
    // It must NOT silently accept the duplicate.
    const gotNewUid =
      response.agent_identification?.new_instance_uid &&
      response.agent_identification.new_instance_uid.length === 16;
    const wasRejected = agent2.lastCloseCode !== null && agent2.lastCloseCode >= 4000;

    expect(gotNewUid || wasRejected).toBe(true);

    if (gotNewUid) {
      // Verify the new UID differs from the duplicate
      const newUid = Array.from(response.agent_identification!.new_instance_uid).join(",");
      const origUid = Array.from(uid1).join(",");
      expect(newUid).not.toBe(origUid);
    }
  });
});

// ─── §5.2 Health Reporting ───────────────────────────────────────────────────

describe("Health Reporting (§5.2)", () => {
  it("stores and reflects agent health status string", async () => {
    // Spec: AgentHealth.status is a human-readable string describing agent state
    const { token, configId, tenantId } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "health-test-agent");

    // Report a specific status
    await agent.sendHealth(true, "All pipelines running");
    await agent.waitForMessage();
    await settle(500);

    // Query the API to verify the status is stored
    const { data } = await api<{
      agents: Array<{ health_status?: string; healthy?: boolean; status?: string }>;
    }>(`/api/v1/configurations/${configId}/agents`, {
      headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
    });

    const found = data.agents?.find((a) => a.healthy === true);
    expect(found).toBeDefined();
    // Server should persist the status string, not just the boolean
    expect(found!.status).toBeDefined();
  });

  it("stores unhealthy status with last_error", async () => {
    const { token, configId, tenantId } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "unhealthy-agent");

    await agent.sendHealth(false, "Pipeline failed: connection refused");
    await agent.waitForMessage();
    await settle(500);

    const { data } = await api<{
      agents: Array<{ healthy?: boolean; last_error?: string; status?: string }>;
    }>(`/api/v1/configurations/${configId}/agents`, {
      headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
    });

    const found = data.agents?.find((a) => a.healthy === false);
    expect(found).toBeDefined();
    expect(found!.last_error).toContain("Pipeline failed");
  });
});

// ─── §5.3 Remote Configuration ──────────────────────────────────────────────

describe("Remote Configuration (§5.3)", () => {
  it("pushes config to agent with config_hash for deduplication", async () => {
    // Spec: remote_config contains config body + config_hash
    const { token, configId, tenantId } = await setupTenantAndConfig();

    // Upload a config version
    const yaml = "receivers:\n  otlp:\n    protocols:\n      grpc:\n";
    await fetch(`${BASE_URL}/api/v1/configurations/${configId}/versions`, {
      method: "POST",
      body: yaml,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "text/yaml",
        "X-Tenant-Id": tenantId,
      },
    });

    const agent = await enrollAgent(token, "config-test-agent");

    // Trigger rollout
    await api(`/api/v1/configurations/${configId}/rollout`, {
      method: "POST",
      headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
    });

    // Wait for config push
    const configMsg = await agent.waitForRemoteConfig(10_000);

    expect(configMsg.remote_config).toBeDefined();
    expect(configMsg.remote_config!.config_hash).toBeDefined();
    expect(configMsg.remote_config!.config_hash.length).toBeGreaterThan(0);
    expect(configMsg.remote_config!.config.config_map).toBeDefined();
  });

  it("does not re-push config when agent reports matching hash", async () => {
    // Spec: Server SHOULD NOT resend config if agent already has it
    const { token, configId, tenantId } = await setupTenantAndConfig();

    const yaml = "receivers:\n  otlp:\n    protocols:\n      http:\n";
    await fetch(`${BASE_URL}/api/v1/configurations/${configId}/versions`, {
      method: "POST",
      body: yaml,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "text/yaml",
        "X-Tenant-Id": tenantId,
      },
    });

    const agent = await enrollAgent(token, "no-repush-agent");

    // Rollout config
    await api(`/api/v1/configurations/${configId}/rollout`, {
      method: "POST",
      headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
    });

    const configMsg = await agent.waitForRemoteConfig(10_000);
    const hash = configMsg.remote_config!.config_hash;

    // ACK the config
    await agent.applyConfig(hash);
    const _ackResponse = await agent.waitForMessage();

    // Send another heartbeat — should NOT get config again
    await agent.sendHeartbeat();
    const hbResponse = await agent.waitForMessage();

    expect(hbResponse.remote_config).toBeUndefined();
  });
});

// ─── §5.4 Connection Settings ────────────────────────────────────────────────

describe("Connection Settings (§5.4)", () => {
  it("offers OpAMP connection settings on enrollment with auth headers", async () => {
    // Spec: Server MAY offer new connection settings including auth
    const { token } = await setupTenantAndConfig();
    const agent = createAgent({ enrollmentToken: token, name: "conn-settings-agent" });
    await agent.connect();
    await agent.sendHello();
    const response = await agent.waitForMessage();

    expect(response.connection_settings).toBeDefined();
    expect(response.connection_settings!.opamp).toBeDefined();

    const opampSettings = response.connection_settings!.opamp!;
    const authHeader = opampSettings.headers?.find((h) => h.key === "Authorization");
    expect(authHeader).toBeDefined();
    expect(authHeader!.value).toMatch(/^Bearer /);
  });

  it("includes heartbeat_interval_seconds in connection settings", async () => {
    // Spec §5.4: OpAMPConnectionSettings MAY include heartbeat_interval_seconds
    // to tell agent the preferred heartbeat cadence
    const { token } = await setupTenantAndConfig();
    const agent = createAgent({ enrollmentToken: token, name: "hb-interval-agent" });
    await agent.connect();
    await agent.sendHello();
    const response = await agent.waitForMessage();

    expect(response.connection_settings).toBeDefined();
    const opampSettings = response.connection_settings!.opamp;
    expect(opampSettings?.heartbeat_interval_seconds).toBeDefined();
    expect(opampSettings!.heartbeat_interval_seconds!).toBeGreaterThan(0);
  });
});

// ─── §5.5 Reconnection ──────────────────────────────────────────────────────

describe("Reconnection (§5.5)", () => {
  it("accepts reconnection with assignment claim after disconnect", async () => {
    // Spec: Agent should be able to reconnect using previously offered credentials
    const { token } = await setupTenantAndConfig();
    const agent1 = await enrollAgent(token, "reconnect-agent");
    const claim = agent1.enrollment!.assignment_claim;

    // Disconnect
    agent1.close();
    await settle(500);

    // Reconnect with the assignment claim
    const agent2 = createAgent({ assignmentClaim: claim, name: "reconnect-agent" });
    await agent2.connect();
    await agent2.sendHello();
    const response = await agent2.waitForMessage();

    expect(response).toBeDefined();
    expect(response.instance_uid).toBeDefined();
    expect(response.error_response).toBeUndefined();
  });

  it("reconnected agent resumes normal heartbeat exchange", async () => {
    const { token } = await setupTenantAndConfig();
    const agent1 = await enrollAgent(token, "reconnect-hb-agent");
    const claim = agent1.enrollment!.assignment_claim;
    agent1.close();
    await settle(500);

    const agent2 = createAgent({ assignmentClaim: claim, name: "reconnect-hb-agent" });
    await agent2.connect();
    await agent2.sendHello();
    await agent2.waitForMessage();

    // Heartbeat should work
    await agent2.sendHeartbeat();
    const hbResponse = await agent2.waitForMessage();
    expect(hbResponse).toBeDefined();
    expect(hbResponse.error_response).toBeUndefined();
  });
});

// ─── §5.6 Capacity / Rate Limiting ──────────────────────────────────────────

describe("Capacity and Rate Limiting (§5.6)", () => {
  it("includes Retry-After mechanism for overloaded connections", async () => {
    // Spec: "If the Server is unable to accept a WebSocket connection it SHOULD
    // respond with an HTTP 503 or 429 status code and MAY include a Retry-After header."
    //
    // We test that the server has a capacity-aware rejection mechanism by checking
    // that the HTTP endpoint responds appropriately to a probe.
    // Full capacity testing requires load generation beyond unit tests.

    // Verify the server exposes a way to check or enforce capacity limits
    // This could be a header in responses, a config endpoint, or rejection behavior
    const { token, configId, tenantId } = await setupTenantAndConfig();

    // Connect an agent and verify the server at least tracks connection count
    const _agent = await enrollAgent(token, "capacity-probe-agent");
    await settle(300);

    // Check DO stats endpoint — server must track connected agents to know capacity
    const { status, data } = await api<{ connected_agents?: number; active_websockets?: number }>(
      `/api/v1/configurations/${configId}/stats`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );

    // Server must at minimum track connection count (prerequisite for capacity limiting)
    expect(status).toBe(200);
    expect(data.connected_agents !== undefined || data.active_websockets !== undefined).toBe(true);
  });
});

// ─── §5.7 Server-Initiated Disconnect ────────────────────────────────────────

describe("Server-Initiated Disconnect (§5.7)", () => {
  it("server can disconnect an agent with proper close code", async () => {
    // Spec: Server MAY disconnect agents by closing WebSocket with appropriate code
    // Testing via the admin disconnect API if available
    const { token, configId, tenantId } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "disconnect-test-agent");
    await settle(500);

    // Try the disconnect API (may not exist yet)
    const { status } = await api(`/api/v1/configurations/${configId}/disconnect`, {
      method: "POST",
      headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
    });

    if (status === 200) {
      // Wait for disconnect
      await settle(2000);
      expect(agent.connected).toBe(false);
    } else {
      // API doesn't exist yet — document as gap
      expect(status).toBe(200);
    }
  });
});

// ─── §6.1 Enrollment ─────────────────────────────────────────────────────────

describe("Enrollment (§6.1)", () => {
  it("completes enrollment flow: token → hello → connection_settings", async () => {
    const { token } = await setupTenantAndConfig();
    const agent = createAgent({ enrollmentToken: token, name: "enroll-flow-agent" });
    const result = await agent.connectAndEnroll();

    expect(result.type).toBe("enrollment_complete");
    expect(result.assignment_claim).toBeTruthy();
    expect(result.instance_uid).toBeTruthy();
  });

  it("enrolled agent can immediately send heartbeats", async () => {
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "post-enroll-hb");

    await agent.sendHeartbeat();
    const response = await agent.waitForMessage();

    expect(response).toBeDefined();
    expect(response.error_response).toBeUndefined();
  });

  it("revoked enrollment token cannot be used for new enrollments", async () => {
    const { token, configId, tenantId } = await setupTenantAndConfig();

    // First enrollment should work
    const agent1 = await enrollAgent(token, "before-revoke");
    expect(agent1.enrollment).toBeDefined();

    // Revoke the token
    const { data: tokens } = await api<{ tokens: Array<{ id: string }> }>(
      `/api/v1/configurations/${configId}/enrollment-tokens`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );
    const tokenId = tokens.tokens[0]?.id;
    if (tokenId) {
      await api(`/api/v1/configurations/${configId}/enrollment-tokens/${tokenId}`, {
        method: "DELETE",
        headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
      });
    }

    await settle(500);

    // New enrollment with revoked token should fail
    const agent2 = createAgent({ enrollmentToken: token, name: "after-revoke" });
    try {
      await agent2.connect();
      await agent2.sendHello();
      const response = await agent2.waitForMessage(5000);
      // Should either get error_response or connection closed
      if (response) {
        expect(response.error_response !== undefined || agent2.lastCloseCode !== null).toBe(true);
      }
    } catch (err) {
      // Connection rejected or errored — verify it's actually a rejection
      expect(err).toBeDefined();
    }
  });

  it("previously enrolled agent stays connected after token revocation", async () => {
    const { token, configId, tenantId } = await setupTenantAndConfig();

    // Enroll
    const agent = await enrollAgent(token, "stays-connected");

    // Revoke
    const { data: tokens } = await api<{ tokens: Array<{ id: string }> }>(
      `/api/v1/configurations/${configId}/enrollment-tokens`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );
    const tokenId = tokens.tokens[0]?.id;
    if (tokenId) {
      await api(`/api/v1/configurations/${configId}/enrollment-tokens/${tokenId}`, {
        method: "DELETE",
        headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
      });
    }

    await settle(500);

    // Existing agent should still be able to heartbeat
    await agent.sendHeartbeat();
    const response = await agent.waitForMessage(5000);

    expect(response).toBeDefined();
    expect(response.error_response).toBeUndefined();
    expect(agent.connected).toBe(true);
  });
});

// ─── §7 Sequence Numbers ─────────────────────────────────────────────────────

describe("Sequence Numbers (§7)", () => {
  it("server accepts incrementing sequence numbers", async () => {
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "seq-test-agent");

    // Send multiple heartbeats with incrementing seq
    for (let i = 0; i < 5; i++) {
      await agent.sendHeartbeat();
      const response = await agent.waitForMessage();
      expect(response.error_response).toBeUndefined();
    }
  });

  it("server handles sequence_num 0 as reconnection indicator", async () => {
    // Spec: sequence_num=0 indicates a new session / fresh connection
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "seq-zero-agent");

    // Send heartbeats to advance seq
    await agent.sendHeartbeat();
    await agent.waitForMessage();
    await agent.sendHeartbeat();
    await agent.waitForMessage();

    // Re-send with seq=0 (simulates reconnect without new WS)
    // Our FakeAgent's sendHello resets seq to 0
    await agent.sendHello();
    const response = await agent.waitForMessage();

    expect(response).toBeDefined();
    expect(response.error_response).toBeUndefined();
  });
});

// ─── §8 Multi-Agent Scale ────────────────────────────────────────────────────

describe("Multi-Agent Scale", () => {
  it("handles 20 concurrent agents enrolling and heartbeating", async () => {
    const { token } = await setupTenantAndConfig();
    const agentCount = 20;

    // Enroll all in parallel
    const enrolled = await Promise.all(
      Array.from({ length: agentCount }, (_, i) => enrollAgent(token, `scale-agent-${i}`)),
    );

    expect(enrolled.length).toBe(agentCount);

    // All send heartbeats
    const heartbeatResults = await Promise.all(
      enrolled.map(async (agent) => {
        await agent.sendHeartbeat();
        const response = await agent.waitForMessage(10_000);
        return response;
      }),
    );

    // All should get valid responses
    for (const response of heartbeatResults) {
      expect(response).toBeDefined();
      expect(response.error_response).toBeUndefined();
    }
  });
});

// ─── §4.4.1 Server Capabilities ──────────────────────────────────────────────

describe("Server Capabilities (§4.4.1)", () => {
  it("advertises OffersConnectionSettings capability (0x20)", async () => {
    // Spec: If server offers connection_settings, it MUST advertise the
    // corresponding capability bit. OpAMP proto: ServerCapabilities value 0x20
    // is ServerCapabilities_OffersConnectionSettings.
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "cap-check-agent");

    await agent.sendHeartbeat();
    const response = await agent.waitForMessage();

    // 0x20 = ServerCapabilities_OffersConnectionSettings
    const OffersConnectionSettings = 0x20;
    expect(response.capabilities & OffersConnectionSettings).toBe(OffersConnectionSettings);
  });

  it("advertises AcceptsStatus capability", async () => {
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "cap-status-agent");

    await agent.sendHeartbeat();
    const response = await agent.waitForMessage();

    // 0x01 = AcceptsStatus
    expect(response.capabilities & 0x01).toBe(0x01);
  });

  it("advertises OffersRemoteConfig capability", async () => {
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "cap-config-agent");

    await agent.sendHeartbeat();
    const response = await agent.waitForMessage();

    // 0x02 = OffersRemoteConfig
    expect(response.capabilities & 0x02).toBe(0x02);
  });
});

// ─── §5.3.1 Config Hash Consistency ─────────────────────────────────────────

describe("Config Hash Consistency (§5.3.1)", () => {
  it("config_hash is a valid SHA-256 (32 bytes) matching expected digest", async () => {
    // Spec: config_hash is a cryptographic hash of the config for deduplication.
    // We standardize on SHA-256 (32 bytes). Verify by computing expected hash.
    const { token, configId, tenantId } = await setupTenantAndConfig();

    const yaml = "exporters:\n  debug:\n    verbosity: detailed\n";
    await fetch(`${BASE_URL}/api/v1/configurations/${configId}/versions`, {
      method: "POST",
      body: yaml,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "text/yaml",
        "X-Tenant-Id": tenantId,
      },
    });

    const agent = await enrollAgent(token, "hash-check-agent");

    await api(`/api/v1/configurations/${configId}/rollout`, {
      method: "POST",
      headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
    });

    const configMsg = await agent.waitForRemoteConfig(10_000);
    const hash = configMsg.remote_config!.config_hash;

    // Must be exactly 32 bytes (SHA-256)
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);

    // Compute expected SHA-256 of the config body we sent
    const configBody = configMsg.remote_config!.config.config_map;
    const keys = Object.keys(configBody);
    expect(keys.length).toBeGreaterThan(0);
    const body = configBody[keys[0]].body;

    const expectedHash = new Uint8Array(await crypto.subtle.digest("SHA-256", body));

    // The config_hash should match SHA-256 of the config body
    expect(Array.from(hash)).toEqual(Array.from(expectedHash));
  });

  it("same config content produces same hash across requests", async () => {
    // Spec: hash must be deterministic for deduplication to work
    const { token: _token, configId, tenantId } = await setupTenantAndConfig();
    const yaml = "processors:\n  batch:\n    timeout: 5s\n";

    // Upload same content twice
    const res1 = await fetch(`${BASE_URL}/api/v1/configurations/${configId}/versions`, {
      method: "POST",
      body: yaml,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "text/yaml",
        "X-Tenant-Id": tenantId,
      },
    });
    const { hash: hash1 } = (await res1.json()) as { hash: string };

    const res2 = await fetch(`${BASE_URL}/api/v1/configurations/${configId}/versions`, {
      method: "POST",
      body: yaml,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "text/yaml",
        "X-Tenant-Id": tenantId,
      },
    });
    const { hash: hash2 } = (await res2.json()) as { hash: string };

    expect(hash1).toBe(hash2);
  });
});

// ─── §5.4.1 ConnectionSettingsOffers Hash ────────────────────────────────────

describe("ConnectionSettingsOffers Hash (§5.4.1)", () => {
  it("includes hash field in connection_settings for change detection", async () => {
    // Spec: ConnectionSettingsOffers.hash allows the agent to detect whether
    // the offered settings have changed since last time.
    const { token } = await setupTenantAndConfig();
    const agent = createAgent({ enrollmentToken: token, name: "cs-hash-agent" });
    await agent.connect();
    await agent.sendHello();
    const response = await agent.waitForMessage();

    expect(response.connection_settings).toBeDefined();
    expect(response.connection_settings!.hash).toBeDefined();
    expect(response.connection_settings!.hash!.length).toBeGreaterThan(0);
  });
});

// ─── §5.2.1 Component Health Map ─────────────────────────────────────────────

describe("Component Health Map (§5.2.1)", () => {
  it("server accepts AgentToServer with component_health_map without error", async () => {
    // Spec: ComponentHealth.component_health_map allows agents to report
    // health per sub-component (e.g., per pipeline, per exporter).
    // Server MUST accept this field without disconnecting.
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "comp-health-accept");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    // Connect raw WS to send component_health_map
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // Hello
    const helloMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
    };
    ws.send(encodeFrame(helloMsg));
    await new Promise<void>((resolve) => {
      ws.onmessage = () => resolve();
    });

    // Send health WITH component_health_map
    const healthMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
      health: {
        healthy: true,
        start_time_unix_nano: BigInt(Date.now()) * 1000000n,
        last_error: "",
        status: "running",
        status_time_unix_nano: BigInt(Date.now()) * 1000000n,
        component_health_map: {
          "pipeline:traces": {
            healthy: true,
            start_time_unix_nano: BigInt(Date.now()) * 1000000n,
            last_error: "",
            status: "running",
            status_time_unix_nano: BigInt(Date.now()) * 1000000n,
            component_health_map: {},
          },
          "exporter:otlp": {
            healthy: false,
            start_time_unix_nano: BigInt(Date.now()) * 1000000n,
            last_error: "connection refused",
            status: "error",
            status_time_unix_nano: BigInt(Date.now()) * 1000000n,
            component_health_map: {},
          },
        },
      },
    };
    ws.send(encodeFrame(healthMsg));

    const result = await new Promise<
      { type: "message"; data: ArrayBuffer } | { type: "close"; code: number }
    >((resolve) => {
      ws.onmessage = (e) => resolve({ type: "message", data: e.data as ArrayBuffer });
      ws.onclose = (e) => resolve({ type: "close", code: e.code });
      setTimeout(() => resolve({ type: "close", code: -1 }), 5000);
    });

    // Server must accept the message (not disconnect)
    expect(result.type).toBe("message");
    ws.close();
  });

  it("component_health_map is stored and queryable per-component via API", async () => {
    // Spec: Server SHOULD store per-component health for fleet visibility.
    // API should expose individual component status (not just overall healthy bool).
    const { token, configId, tenantId } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "comp-health-stored");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    const helloMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
    };
    ws.send(encodeFrame(helloMsg));
    await new Promise<void>((resolve) => {
      ws.onmessage = () => resolve();
    });

    // Send health with one healthy and one unhealthy component
    const healthMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
      health: {
        healthy: false,
        start_time_unix_nano: BigInt(Date.now()) * 1000000n,
        last_error: "exporter:otlp unhealthy",
        status: "degraded",
        status_time_unix_nano: BigInt(Date.now()) * 1000000n,
        component_health_map: {
          "receiver:otlp": {
            healthy: true,
            start_time_unix_nano: BigInt(Date.now()) * 1000000n,
            last_error: "",
            status: "running",
            status_time_unix_nano: BigInt(Date.now()) * 1000000n,
            component_health_map: {},
          },
          "exporter:otlp": {
            healthy: false,
            start_time_unix_nano: BigInt(Date.now()) * 1000000n,
            last_error: "connection refused to backend",
            status: "error",
            status_time_unix_nano: BigInt(Date.now()) * 1000000n,
            component_health_map: {},
          },
        },
      },
    };
    ws.send(encodeFrame(healthMsg));
    await new Promise<void>((resolve) => {
      ws.onmessage = () => resolve();
    });
    ws.close();
    await settle(500);

    // Query API for this agent's component health
    const { data } = await api<{ agents: Array<Record<string, unknown>> }>(
      `/api/v1/configurations/${configId}/agents`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );

    // Find our agent and check component-level health is stored
    const found = data.agents?.find((a) => {
      const desc = a.agent_description as string | null;
      return typeof desc === "string" && desc.includes("comp-health-stored");
    });
    expect(found).toBeDefined();

    // Server must expose component_health_map (or equivalent nested structure)
    // Not just the top-level healthy boolean
    const componentHealth =
      found!.component_health_map ?? found!.component_health ?? found!.components;
    expect(componentHealth).toBeDefined();
    expect(typeof componentHealth).toBe("object");

    // Should include both components we reported
    const components = componentHealth as Record<string, unknown>;
    expect(components["receiver:otlp"] || components["exporter:otlp"]).toBeDefined();
  });

  it("unhealthy component status is reflected separately from overall health", async () => {
    // When overall=healthy but one component is unhealthy, the API should
    // allow querying which specific component is failing.
    const { token, configId, tenantId } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "comp-health-separate");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    const helloMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
    };
    ws.send(encodeFrame(helloMsg));
    await new Promise<void>((resolve) => {
      ws.onmessage = () => resolve();
    });

    // Agent is overall healthy, but one component has an error
    const healthMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
      health: {
        healthy: true,
        start_time_unix_nano: BigInt(Date.now()) * 1000000n,
        last_error: "",
        status: "running",
        status_time_unix_nano: BigInt(Date.now()) * 1000000n,
        component_health_map: {
          "processor:batch": {
            healthy: true,
            start_time_unix_nano: BigInt(Date.now()) * 1000000n,
            last_error: "",
            status: "running",
            status_time_unix_nano: BigInt(Date.now()) * 1000000n,
            component_health_map: {},
          },
          "exporter:kafka": {
            healthy: false,
            start_time_unix_nano: BigInt(Date.now()) * 1000000n,
            last_error: "broker unreachable",
            status: "error",
            status_time_unix_nano: BigInt(Date.now()) * 1000000n,
            component_health_map: {},
          },
        },
      },
    };
    ws.send(encodeFrame(healthMsg));
    await new Promise<void>((resolve) => {
      ws.onmessage = () => resolve();
    });
    ws.close();
    await settle(500);

    const { data } = await api<{ agents: Array<Record<string, unknown>> }>(
      `/api/v1/configurations/${configId}/agents`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );

    const found = data.agents?.[0];
    expect(found).toBeDefined();

    // The unhealthy component's error message should be retrievable
    const componentHealth =
      found!.component_health_map ?? found!.component_health ?? found!.components;
    expect(componentHealth).toBeDefined();

    const components = componentHealth as Record<
      string,
      { healthy?: boolean; last_error?: string }
    >;
    const kafkaExporter = components["exporter:kafka"];
    expect(kafkaExporter).toBeDefined();
    expect(kafkaExporter.healthy).toBe(false);
    expect(kafkaExporter.last_error).toContain("broker unreachable");
  });
});

// ─── §5.3.2 Config Applying Status ──────────────────────────────────────────

describe("Config Applying Status (§5.3.2)", () => {
  it("tracks APPLYING status while agent is processing config", async () => {
    // Spec: When agent receives config, it reports APPLYING before APPLIED.
    // Server should accept APPLYING status and not treat it as final.
    const { token, configId, tenantId } = await setupTenantAndConfig();

    const yaml = "receivers:\n  hostmetrics:\n    collection_interval: 30s\n";
    await fetch(`${BASE_URL}/api/v1/configurations/${configId}/versions`, {
      method: "POST",
      body: yaml,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "text/yaml",
        "X-Tenant-Id": tenantId,
      },
    });

    const agent = await enrollAgent(token, "applying-status-agent");

    // Rollout
    await api(`/api/v1/configurations/${configId}/rollout`, {
      method: "POST",
      headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
    });

    const configMsg = await agent.waitForRemoteConfig(10_000);
    const hash = configMsg.remote_config!.config_hash;

    // Report APPLYING (status=2) — the intermediate state
    // Need to use encodeFrame directly since FakeAgent doesn't expose this
    const ws = new WebSocket(
      `${WS_URL}?token=${encodeURIComponent(agent.enrollment!.assignment_claim)}`,
    );
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // Send hello
    const helloMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 0,
      capabilities:
        AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsRemoteConfig,
      flags: 0,
    };
    ws.send(encodeFrame(helloMsg));
    await new Promise<void>((resolve) => {
      ws.onmessage = () => resolve();
    });

    // Send APPLYING status
    const applyingMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 1,
      capabilities:
        AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsRemoteConfig,
      flags: 0,
      remote_config_status: {
        last_remote_config_hash: hash,
        status: RemoteConfigStatuses.APPLYING,
        error_message: "",
      },
    };
    ws.send(encodeFrame(applyingMsg));

    // Server should respond without error and keep connection open
    const result = await new Promise<
      { type: "message"; data: ArrayBuffer } | { type: "close"; code: number }
    >((resolve) => {
      ws.onmessage = (e) => resolve({ type: "message", data: e.data as ArrayBuffer });
      ws.onclose = (e) => resolve({ type: "close", code: e.code });
      setTimeout(() => resolve({ type: "close", code: -1 }), 5000);
    });

    expect(result.type).toBe("message");
    ws.close();
    agent.close();
  });
});

// ─── §4.5.1 Error Recovery ───────────────────────────────────────────────────

describe("Error Recovery (§4.5.1)", () => {
  it("connection stays alive after receiving a bad message", async () => {
    // Spec §4.5: After an error, the connection SHOULD remain open.
    // We send garbage, then verify the connection still works for valid messages.
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "error-recovery-agent");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();

    // Open raw WS to control messages precisely
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // Send valid hello
    const helloMsg: AgentToServer = {
      instance_uid: crypto.getRandomValues(new Uint8Array(16)),
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    ws.send(encodeFrame(helloMsg));
    await new Promise<void>((resolve) => {
      ws.onmessage = () => resolve();
    });

    // Send garbage binary
    ws.send(new Uint8Array([0x05, 0xde, 0xad, 0xbe, 0xef, 0x00]));

    // Wait briefly for error processing
    await settle(500);

    // If connection is still open, send another valid message
    if (ws.readyState === WebSocket.OPEN) {
      const heartbeatMsg: AgentToServer = {
        instance_uid: helloMsg.instance_uid,
        sequence_num: 1,
        capabilities: AgentCapabilities.ReportsStatus,
        flags: 0,
      };
      ws.send(encodeFrame(heartbeatMsg));

      const result = await new Promise<"message" | "close">((resolve) => {
        ws.onmessage = () => resolve("message");
        ws.onclose = () => resolve("close");
        setTimeout(() => resolve("close"), 3000);
      });

      // If server kept connection alive and responded, that's compliant
      expect(result).toBe("message");
    } else {
      // Connection was closed by the garbage — this is the gap
      // (server should have sent error_response and kept alive)
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }

    ws.close();
  });
});

// ─── §6.1.1 Token Revocation ─────────────────────────────────────────────────

describe("Token Revocation (§6.1.1)", () => {
  // SKIPPED: Server does not reject revoked tokens immediately on new enrollment attempt.
  // Re-enable when token revocation is implemented: #464
  // The worker accepts the WS connection and waits for the first message rather than
  // checking token validity before upgrade.
  it.skip("revoked token is rejected immediately on new enrollment attempt", async () => {
    // Server MUST check token validity at enrollment time.
    // Revoked tokens should fail fast, not after WS upgrade.
    const { token, configId, tenantId } = await setupTenantAndConfig();

    // Revoke immediately
    const { data: tokens } = await api<{ tokens: Array<{ id: string }> }>(
      `/api/v1/configurations/${configId}/enrollment-tokens`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );
    const tokenId = tokens.tokens[0]?.id;
    if (tokenId) {
      await api(`/api/v1/configurations/${configId}/enrollment-tokens/${tokenId}`, {
        method: "DELETE",
        headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
      });
    }
    await settle(300);

    // Try to enroll with revoked token
    const agent = createAgent({ enrollmentToken: token, name: "revoked-token-agent" });
    let rejected = false;
    try {
      await agent.connect();
      await agent.sendHello();
      const response = await agent.waitForMessage(5000);
      // If we get a response, it should be an error or close
      if (response?.error_response) {
        rejected = true;
      } else if (agent.lastCloseCode && agent.lastCloseCode >= 4000) {
        rejected = true;
      }
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
  });

  it("assignment claims from revoked tokens remain valid", async () => {
    // Revoking an enrollment token should NOT invalidate already-issued claims.
    // Agents that already enrolled should keep working.
    const { token, configId, tenantId } = await setupTenantAndConfig();

    // Enroll first
    const agent1 = await enrollAgent(token, "claim-survives-agent");
    const claim = agent1.enrollment!.assignment_claim;
    agent1.close();
    await settle(300);

    // Revoke the enrollment token
    const { data: tokens } = await api<{ tokens: Array<{ id: string }> }>(
      `/api/v1/configurations/${configId}/enrollment-tokens`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );
    const tokenId = tokens.tokens[0]?.id;
    if (tokenId) {
      await api(`/api/v1/configurations/${configId}/enrollment-tokens/${tokenId}`, {
        method: "DELETE",
        headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
      });
    }
    await settle(300);

    // Reconnect with the claim — should still work
    const agent2 = createAgent({ assignmentClaim: claim, name: "claim-survives-agent" });
    await agent2.connect();
    await agent2.sendHello();
    const response = await agent2.waitForMessage(5000);

    expect(response).toBeDefined();
    expect(response.error_response).toBeUndefined();
    expect(agent2.connected).toBe(true);
  });
});

// ─── §5.6.1 Pre-Upgrade Rejection ───────────────────────────────────────────

describe("Pre-Upgrade Rejection (§5.6.1)", () => {
  it("returns HTTP error (not WS upgrade) for invalid tokens before upgrade", async () => {
    // Spec: Server SHOULD reject invalid connections BEFORE WebSocket upgrade
    // to avoid wasting resources on the WS handshake.
    // Test: an invalid token should ideally get HTTP 401/403, not a WS upgrade
    // followed by a close frame.
    const url = `${WS_URL}?token=completely-bogus-token-12345`;

    let gotHttpError = false;
    let gotWsClose = false;
    let closeCode = 0;

    try {
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, _reject) => {
        ws.onopen = () => {
          // WS upgraded — not ideal but acceptable if it closes quickly
          gotWsClose = true;
          resolve();
        };
        ws.onerror = () => {
          gotHttpError = true;
          resolve();
        };
        ws.onclose = (e) => {
          closeCode = e.code;
          gotWsClose = true;
          resolve();
        };
        setTimeout(resolve, 3000);
      });

      if (ws.readyState === WebSocket.OPEN) {
        // If connection opened, send hello and see if it rejects
        ws.send("test");
        await new Promise<void>((resolve) => {
          ws.onclose = (e) => {
            closeCode = e.code;
            resolve();
          };
          setTimeout(resolve, 2000);
        });
        ws.close();
      }
    } catch {
      gotHttpError = true;
    }

    // Either HTTP rejection before upgrade OR quick WS close is acceptable.
    // Close code 1002 (protocol error) or 1006 (abnormal closure) indicates
    // the server rejected at HTTP level before completing the WS upgrade.
    expect(gotHttpError || gotWsClose).toBe(true);
    if (gotWsClose && closeCode > 0) {
      // Acceptable codes: 1002/1006 (pre-upgrade HTTP rejection) or ≥4000 (app-level rejection)
      const isPreUpgradeRejection = closeCode === 1002 || closeCode === 1006;
      const isAppRejection = closeCode >= 4000;
      expect(isPreUpgradeRejection || isAppRejection).toBe(true);
    }
  });
});

// ─── §5.3.3 Multi-File Config Map ───────────────────────────────────────────

describe("Multi-File Config Map (§5.3.3)", () => {
  it("config_map supports at least one named file entry", async () => {
    // Spec: AgentConfigMap.config_map is a map of file name to AgentConfigFile.
    // Server should deliver config in a named entry (e.g., "collector.yaml").
    const { token, configId, tenantId } = await setupTenantAndConfig();

    const yaml = "service:\n  pipelines:\n    traces:\n      receivers: [otlp]\n";
    await fetch(`${BASE_URL}/api/v1/configurations/${configId}/versions`, {
      method: "POST",
      body: yaml,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "text/yaml",
        "X-Tenant-Id": tenantId,
      },
    });

    const agent = await enrollAgent(token, "multi-file-agent");

    await api(`/api/v1/configurations/${configId}/rollout`, {
      method: "POST",
      headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
    });

    const configMsg = await agent.waitForRemoteConfig(10_000);
    const configMap = configMsg.remote_config!.config.config_map;

    // Should have at least one entry
    const keys = Object.keys(configMap);
    expect(keys.length).toBeGreaterThanOrEqual(1);

    // Each entry should have body and content_type
    for (const key of keys) {
      expect(configMap[key].body).toBeDefined();
      expect(configMap[key].body.length).toBeGreaterThan(0);
      expect(configMap[key].content_type).toBeDefined();
    }
  });
});

// ─── §5.2.2 Available Components ─────────────────────────────────────────────

describe("Available Components (§5.2.2)", () => {
  it("server accepts agent_description with identifying_attributes", async () => {
    // Spec: Agent sends agent_description with attributes identifying its type/version.
    // Server must accept and store this.
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "avail-comp-desc");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // Send hello with agent_description including identifying attributes
    const helloMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      agent_description: {
        identifying_attributes: [
          { key: "service.name", value: { string_value: "otelcol-contrib" } },
          { key: "service.version", value: { string_value: "0.98.0" } },
          { key: "service.instance.id", value: { string_value: "node-xyz-123" } },
        ],
        non_identifying_attributes: [
          { key: "os.type", value: { string_value: "linux" } },
          { key: "host.arch", value: { string_value: "amd64" } },
        ],
      },
    };
    ws.send(encodeFrame(helloMsg));

    const { decodeFrame: decode } = await import("@o11yfleet/core/codec");
    const responseData = await new Promise<ArrayBuffer>((resolve) => {
      ws.onmessage = (e) => resolve(e.data as ArrayBuffer);
    });
    const response = decode<ServerToAgent>(responseData);

    expect(response.error_response).toBeUndefined();
    ws.close();
  });

  it("stored agent_description is exposed via agents API", async () => {
    // Server must store the agent_description and expose it via API
    // so operators can see what collector versions are in the fleet.
    const { token, configId, tenantId } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "avail-comp-api");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    const helloMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      agent_description: {
        identifying_attributes: [
          { key: "service.name", value: { string_value: "otelcol-contrib" } },
          { key: "service.version", value: { string_value: "0.102.0" } },
        ],
        non_identifying_attributes: [{ key: "os.type", value: { string_value: "darwin" } }],
      },
    };
    ws.send(encodeFrame(helloMsg));
    await new Promise<void>((resolve) => {
      ws.onmessage = () => resolve();
    });
    ws.close();
    await settle(500);

    // Query API
    const { data } = await api<{ agents: Array<Record<string, unknown>> }>(
      `/api/v1/configurations/${configId}/agents`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );

    expect(data.agents?.length).toBeGreaterThanOrEqual(1);
    const agentRecord = data.agents?.[0];
    expect(agentRecord).toBeDefined();

    // agent_description should be stored and returned
    const desc = agentRecord!.agent_description;
    expect(desc).toBeDefined();

    // Parse it (may be stored as JSON string or object)
    const parsed = typeof desc === "string" ? JSON.parse(desc) : desc;
    expect(parsed.identifying_attributes).toBeDefined();
    expect(parsed.identifying_attributes.length).toBeGreaterThan(0);

    // Verify actual attribute values were stored
    const serviceName = parsed.identifying_attributes.find(
      (a: { key: string }) => a.key === "service.name",
    );
    expect(serviceName?.value?.string_value ?? serviceName?.value).toBe("otelcol-contrib");
  });

  // SKIPPED: Worker is protobuf-only after #399 — TEXT/JSON frames are not supported.
  // Re-enable when JSON/TEXT frame support is added: #463
  // available_components is sent via JSON frame which the worker rejects.
  it.skip("available_components field is stored when sent by agent", async () => {
    // Spec: Agent MAY report available_components listing what receivers,
    // processors, exporters, extensions it supports. This is SEPARATE from
    // agent_description — it's a dedicated field for component inventory.
    // Server should store this for fleet management / config validation.
    const { token, configId, tenantId } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "avail-comp-store");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // Send hello — note: available_components is NOT in our type defs yet
    // (it's a newer OpAMP field). We test forward compatibility by sending
    // it as an extra field in the JSON frame.
    const uid = agent.uid;
    const msgPayload = {
      instance_uid: { __type: "bytes", data: Array.from(uid) },
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus | 0x00004000, // 0x4000 = ReportsAvailableComponents
      flags: 0,
      available_components: {
        hash: { __type: "bytes", data: Array.from(crypto.getRandomValues(new Uint8Array(32))) },
        components: {
          receiver: [
            { name: "otlp", version: "0.98.0" },
            { name: "hostmetrics", version: "0.98.0" },
            { name: "filelog", version: "0.98.0" },
          ],
          processor: [
            { name: "batch", version: "0.98.0" },
            { name: "filter", version: "0.98.0" },
          ],
          exporter: [
            { name: "otlp", version: "0.98.0" },
            { name: "debug", version: "0.98.0" },
          ],
        },
      },
    };

    // Manually encode JSON frame (since our encodeFrame doesn't know about available_components)
    const TEXT_ENCODER = new TextEncoder();
    const json = JSON.stringify(msgPayload);
    const payload = TEXT_ENCODER.encode(json);
    const buf = new ArrayBuffer(4 + payload.byteLength);
    const view = new DataView(buf);
    view.setUint32(0, payload.byteLength, false);
    new Uint8Array(buf, 4).set(payload);
    ws.send(buf);

    const result = await new Promise<
      { type: "message"; data: ArrayBuffer } | { type: "close"; code: number }
    >((resolve) => {
      ws.onmessage = (e) => resolve({ type: "message", data: e.data as ArrayBuffer });
      ws.onclose = (e) => resolve({ type: "close", code: e.code });
      setTimeout(() => resolve({ type: "close", code: -1 }), 5000);
    });

    // At minimum: server must not crash on available_components
    expect(result.type).toBe("message");
    ws.close();
    await settle(500);

    // Check API for stored components
    const { data } = await api<{ agents: Array<Record<string, unknown>> }>(
      `/api/v1/configurations/${configId}/agents`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );

    const agentRecord = data.agents?.[0];
    expect(agentRecord).toBeDefined();

    // Server should store available_components for fleet inventory
    const components = agentRecord!.available_components;
    expect(components).toBeDefined();
  });
});

// ─── §5.8 Connection Settings Request ────────────────────────────────────────

describe("Connection Settings Request (§5.8)", () => {
  it("server responds with connection_settings when agent requests them", async () => {
    // Spec: Agent MAY request new connection settings by setting
    // AgentCapabilities_AcceptsOpAMPConnectionSettings. Server SHOULD respond.
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "conn-settings-req-agent");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    // Reconnect with AcceptsOpAMPConnectionSettings (0x100) in capabilities
    const AcceptsOpAMPConnectionSettings = 0x100;
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // Send hello WITH AcceptsOpAMPConnectionSettings capability
    const helloMsg: AgentToServer = {
      instance_uid: agent.uid,
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus | AcceptsOpAMPConnectionSettings,
      flags: 0,
    };
    ws.send(encodeFrame(helloMsg));

    const { decodeFrame: decode } = await import("@o11yfleet/core/codec");
    const responseData = await new Promise<ArrayBuffer>((resolve) => {
      ws.onmessage = (e) => resolve(e.data as ArrayBuffer);
    });
    const response = decode<ServerToAgent>(responseData);

    // Server should at minimum not error when agent advertises this capability.
    // Full compliance: server responds with connection_settings offering new creds.
    expect(response.error_response).toBeUndefined();

    // Server SHOULD offer connection settings to an agent that accepts them
    // (especially since this is a reconnection with just an assignment claim)
    expect(response.connection_settings).toBeDefined();

    ws.close();
  });
});

// ─── §5.9 Restart Command ────────────────────────────────────────────────────

describe("Restart Command (§5.9)", () => {
  // SKIPPED: Server does not send restart commands to agents.
  // Re-enable when restart command is implemented: #465
  // The /api/v1/configurations/:id/restart endpoint returns 404 or the server
  // doesn't send the command message after the agent connects.
  it.skip("server can send restart command to agent", async () => {
    // Spec: Server MAY send a Command message with type=Restart to ask
    // the agent to restart. Requires agent to advertise AcceptsRestartCommand.
    const { token, configId, tenantId } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "restart-cmd-agent");

    // Try the restart API (if it exists)
    const { status } = await api(`/api/v1/configurations/${configId}/restart`, {
      method: "POST",
      headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
    });

    if (status === 200) {
      // Wait for command message
      const msg = await agent.waitForMessage(5000);
      expect(msg).toBeDefined();
      // Assert the server actually sent a Restart command, not just any message
      expect(msg.command).toBeDefined();
      expect(msg.command!.type).toBe(0); // CommandType.Restart = 0
    } else {
      // API doesn't exist — gap
      expect(status).toBe(200);
    }
  });
});

// ─── §5.10 Custom Messages / Capabilities ────────────────────────────────────

describe("Custom Messages (§5.10)", () => {
  // SKIPPED: Worker is protobuf-only after #399 — TEXT/JSON frames are not supported.
  // Re-enable when JSON/TEXT frame support is added: #463
  // The worker disconnects when it receives a text frame with unknown fields.
  it.skip("server does not disconnect when message contains unknown JSON fields", async () => {
    // Spec: Agent MAY send custom_capabilities and custom_message fields.
    // Server MUST NOT reject messages containing unknown/extra fields.
    // Our JSON framing means unknown fields survive JSON.parse natively.
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "custom-unknown-fields");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // Send a message with extra unknown fields that a future OpAMP version might add
    const uid = agent.uid;
    const msgPayload = {
      instance_uid: { __type: "bytes", data: Array.from(uid) },
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      // These are hypothetical future fields — server must ignore them gracefully
      custom_capabilities: {
        capabilities: ["com.example.feature1", "com.example.feature2"],
      },
      custom_message: {
        capability: "com.example.feature1",
        type: "request",
        data: { __type: "bytes", data: [0x01, 0x02, 0x03, 0x04] },
      },
      // Completely unknown field
      future_field_42: { some: "data", version: 99 },
    };

    const TEXT_ENCODER = new TextEncoder();
    const json = JSON.stringify(msgPayload);
    const payload = TEXT_ENCODER.encode(json);
    const buf = new ArrayBuffer(4 + payload.byteLength);
    const view = new DataView(buf);
    view.setUint32(0, payload.byteLength, false);
    new Uint8Array(buf, 4).set(payload);
    ws.send(buf);

    const result = await new Promise<
      { type: "message"; data: ArrayBuffer } | { type: "close"; code: number }
    >((resolve) => {
      ws.onmessage = (e) => resolve({ type: "message", data: e.data as ArrayBuffer });
      ws.onclose = (e) => resolve({ type: "close", code: e.code });
      setTimeout(() => resolve({ type: "close", code: -1 }), 5000);
    });

    // Server MUST respond normally — not crash or disconnect
    expect(result.type).toBe("message");
    ws.close();
  });

  // SKIPPED: Worker is protobuf-only after #399 — TEXT/JSON frames are not supported.
  // Re-enable when JSON/TEXT frame support is added: #463
  it.skip("server responds normally after receiving custom_capabilities in message", async () => {
    // After receiving a message with custom fields, the server should continue
    // operating normally — next valid message should still get a response.
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "custom-cap-continues");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    const uid = agent.uid;

    // First: send hello with custom_capabilities
    const helloWithCustom = {
      instance_uid: { __type: "bytes", data: Array.from(uid) },
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      custom_capabilities: {
        capabilities: ["com.vendor.remote_debug", "com.vendor.profiling"],
      },
    };
    const TEXT_ENCODER = new TextEncoder();
    const json = JSON.stringify(helloWithCustom);
    const payloadBytes = TEXT_ENCODER.encode(json);
    const frameBuf = new ArrayBuffer(4 + payloadBytes.byteLength);
    new DataView(frameBuf).setUint32(0, payloadBytes.byteLength, false);
    new Uint8Array(frameBuf, 4).set(payloadBytes);
    ws.send(frameBuf);

    // Wait for hello response
    await new Promise<void>((resolve) => {
      ws.onmessage = () => resolve();
    });

    // Second: send a normal heartbeat (no custom fields)
    const heartbeat: AgentToServer = {
      instance_uid: uid,
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    ws.send(encodeFrame(heartbeat));

    const result = await new Promise<{ type: "message" } | { type: "close"; code: number }>(
      (resolve) => {
        ws.onmessage = () => resolve({ type: "message" });
        ws.onclose = (e) => resolve({ type: "close", code: e.code });
        setTimeout(() => resolve({ type: "close", code: -1 }), 5000);
      },
    );

    // Normal heartbeat after custom message should still work
    expect(result.type).toBe("message");
    ws.close();
  });

  it("large custom_message payload does not crash server", async () => {
    // Agents may send large custom payloads for vendor-specific features.
    // Server should handle gracefully (accept or reject cleanly, not crash).
    const { token } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "custom-large-payload");
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(claim)}`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    const uid = agent.uid;
    // Create a message with a ~50KB custom payload
    const largeData = Array.from({ length: 50000 }, () => Math.floor(Math.random() * 256));
    const msgPayload = {
      instance_uid: { __type: "bytes", data: Array.from(uid) },
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      custom_message: {
        capability: "com.vendor.large_transfer",
        type: "bulk_data",
        data: { __type: "bytes", data: largeData },
      },
    };

    const TEXT_ENCODER = new TextEncoder();
    const json = JSON.stringify(msgPayload);
    const payload = TEXT_ENCODER.encode(json);
    const buf = new ArrayBuffer(4 + payload.byteLength);
    const view = new DataView(buf);
    view.setUint32(0, payload.byteLength, false);
    new Uint8Array(buf, 4).set(payload);
    ws.send(buf);

    const result = await new Promise<
      { type: "message"; data: ArrayBuffer } | { type: "close"; code: number }
    >((resolve) => {
      ws.onmessage = (e) => resolve({ type: "message", data: e.data as ArrayBuffer });
      ws.onclose = (e) => resolve({ type: "close", code: e.code });
      setTimeout(() => resolve({ type: "close", code: -1 }), 5000);
    });

    // Server should either respond normally or close cleanly with a code
    // It must NOT crash (which would kill all connections in the DO)
    expect(result.type === "message" || (result.type === "close" && result.code > 0)).toBe(true);
    ws.close();
  });
});

// ─── §6.1.2 Token Revocation (Rust Worker) ──────────────────────────────────

describe("Token Revocation - Rust Worker (§6.1.2)", () => {
  // These tests target the Rust/WASM worker specifically to verify
  // revocation checking parity with the TS worker.
  const RUST_URL = process.env.RUST_URL;

  it("rust worker rejects revoked enrollment tokens", async () => {
    if (!RUST_URL) {
      // Skip if Rust worker not running (not available in CI)
      return;
    }

    const { token, configId, tenantId } = await setupTenantAndConfig();

    // Revoke the token
    const { data: tokens } = await api<{ tokens: Array<{ id: string }> }>(
      `/api/v1/configurations/${configId}/enrollment-tokens`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );
    const tokenId = tokens.tokens[0]?.id;
    if (tokenId) {
      await api(`/api/v1/configurations/${configId}/enrollment-tokens/${tokenId}`, {
        method: "DELETE",
        headers: { "X-Tenant-Id": tenantId } as Record<string, string>,
      });
    }
    await settle(500);

    // Try enrolling against the Rust worker
    const rustWsUrl = RUST_URL.replace(/^http/, "ws") + "/v1/opamp";
    const agent = createAgent({
      endpoint: rustWsUrl,
      enrollmentToken: token,
      name: "rust-revoke-test",
    });

    let rejected = false;
    try {
      await agent.connect();
      await agent.sendHello();
      const response = await agent.waitForMessage(5000);
      if (response?.error_response || (agent.lastCloseCode && agent.lastCloseCode >= 4000)) {
        rejected = true;
      }
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
  });
});

// ─── §4.3.1 Heartbeat Interval Persistence ──────────────────────────────────

describe("Heartbeat Interval Persistence (§4.3.1)", () => {
  it("server sends consistent heart_beat_interval across reconnections", async () => {
    // Spec: The server's preferred heartbeat interval should be consistent.
    // Agent reconnecting should get the same (or updated) interval.
    const { token } = await setupTenantAndConfig();
    const agent1 = await enrollAgent(token, "hb-persist-agent");

    await agent1.sendHeartbeat();
    const response1 = await agent1.waitForMessage();
    const interval1 = response1.heart_beat_interval;

    const claim = agent1.enrollment!.assignment_claim;
    agent1.close();
    await settle(500);

    // Reconnect
    const agent2 = createAgent({ assignmentClaim: claim, name: "hb-persist-agent" });
    await agent2.connect();
    await agent2.sendHello();
    await agent2.waitForMessage();

    await agent2.sendHeartbeat();
    const response2 = await agent2.waitForMessage();
    const interval2 = response2.heart_beat_interval;

    // Both intervals should be defined and consistent
    expect(interval1).toBeDefined();
    expect(interval2).toBeDefined();
    expect(interval1).toBe(interval2);
  });
});

// ─── §4.6 Connection Settings Status Tracking ───────────────────────────────

describe("Connection Settings Status (§4.6)", () => {
  it("tracks whether agent accepted offered connection settings", async () => {
    // Spec: After offering connection_settings, server should be able to
    // determine whether the agent applied them (reconnected with new creds)
    // or rejected them.
    const { token, configId, tenantId } = await setupTenantAndConfig();
    const agent = await enrollAgent(token, "cs-status-agent");

    // After enrollment, agent should reconnect with the offered credentials.
    // The server should track that the enrollment was successful.
    const claim = agent.enrollment!.assignment_claim;
    agent.close();
    await settle(300);

    // Reconnect with offered claim
    const agent2 = createAgent({ assignmentClaim: claim, name: "cs-status-agent" });
    await agent2.connect();
    await agent2.sendHello();
    const response = await agent2.waitForMessage();

    // Server should recognize this as a successful credential transition
    expect(response).toBeDefined();
    expect(response.error_response).toBeUndefined();

    // Check DO stats — agent should show as connected
    await settle(300);
    const { data: stats } = await api<{ connected_agents: number }>(
      `/api/v1/configurations/${configId}/stats`,
      { headers: { "X-Tenant-Id": tenantId } as Record<string, string> },
    );
    expect(stats.connected_agents).toBeGreaterThanOrEqual(1);
  });
});
