// Shared test helpers for worker integration tests
// Centralizes D1 schema setup, WebSocket helpers, and tenant/config creation

import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import { encodeFrame, decodeFrame, AgentCapabilities } from "@o11yfleet/core/codec";
import type { AgentToServer, ServerToAgent } from "@o11yfleet/core/codec";
import {
  buildHello,
  buildHeartbeat,
  buildHealthReport,
  buildConfigAck,
  buildDescriptionReport,
} from "@o11yfleet/test-utils";

export const O11YFLEET_CLAIM_HMAC_SECRET = "dev-secret-key-for-testing-only-32ch";
export const O11YFLEET_API_BEARER_SECRET = "test-api-secret-for-dev-only-32chars";
const TEST_ADMIN_USER_ID = "test-admin-user";
const TEST_ADMIN_EMAIL = "admin@o11yfleet.test";

/** Standard auth headers for API requests in tests */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${O11YFLEET_API_BEARER_SECRET}`, ...extra };
}

async function ensureAuthTables(): Promise<void> {
  await setupD1();
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin')), tenant_id TEXT REFERENCES tenants(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
  await env.FP_DB.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, is_impersonation INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
  await env.FP_DB.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
  await env.FP_DB.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`);
  await env.FP_DB.exec(
    `CREATE INDEX IF NOT EXISTS idx_sessions_impersonation_expires ON sessions(is_impersonation, expires_at)`,
  );
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS auth_identities (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, provider_login TEXT, provider_email TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(provider, provider_user_id))`,
  );
  await env.FP_DB.exec(
    `CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id)`,
  );
}

export async function adminSessionCookie(): Promise<string> {
  await ensureAuthTables();
  await env.FP_DB.prepare(
    `INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role, tenant_id)
     VALUES (?, ?, 'not-used-in-test', 'Test Admin', 'admin', NULL)`,
  )
    .bind(TEST_ADMIN_USER_ID, TEST_ADMIN_EMAIL)
    .run();

  const sessionId = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await env.FP_DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, is_impersonation) VALUES (?, ?, ?, 0)`,
  )
    .bind(sessionId, TEST_ADMIN_USER_ID, expiresAt)
    .run();
  return `fp_session=${sessionId}`;
}

export async function adminSessionHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  return { Origin: "https://app.o11yfleet.com", Cookie: await adminSessionCookie(), ...extra };
}

const configTenantIds = new Map<string, string>();

function tenantIdForConfig(configId: string): string {
  const tenantId = configTenantIds.get(configId);
  if (!tenantId) {
    throw new Error(`No tenant ID tracked for config ${configId}`);
  }
  return tenantId;
}

function authHeadersForConfig(
  configId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return authHeaders({ ...extra, "X-Tenant-Id": tenantIdForConfig(configId) });
}

function tenantIdFromRequest(url: string, init?: RequestInit): string | null {
  const headers = new Headers(init?.headers);
  const explicitTenantId = headers.get("X-Tenant-Id");
  if (explicitTenantId) return explicitTenantId;

  const configId = new URL(url).pathname.match(/^\/api\/v1\/configurations\/([^/]+)/)?.[1];
  if (configId) return configTenantIds.get(configId) ?? null;

  if (typeof init?.body === "string") {
    try {
      const body = JSON.parse(init.body) as { tenant_id?: unknown };
      return typeof body.tenant_id === "string" ? body.tenant_id : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Fetch wrapper that auto-adds Bearer auth for /api/ routes.
 * Drop-in replacement for exports.default.fetch in tests.
 */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const needsAuth = url.includes("/api/");
  if (needsAuth) {
    let requestInit = init;
    const headers = new Headers(init?.headers);
    if (url.includes("/api/admin/") && !headers.has("Cookie")) {
      headers.set("Cookie", await adminSessionCookie());
      if (!headers.has("Origin")) {
        headers.set("Origin", "https://app.o11yfleet.com");
      }
    } else if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${O11YFLEET_API_BEARER_SECRET}`);
    }
    if (url.includes("/api/v1/")) {
      const existingTenantId = headers.get("X-Tenant-Id")?.trim() ?? "";
      if (!existingTenantId) {
        headers.delete("X-Tenant-Id");
        const tenantId = tenantIdFromRequest(url, { ...init, headers })?.trim() ?? "";
        if (tenantId) {
          headers.set("X-Tenant-Id", tenantId);
        }
      }
      if (
        new URL(url).pathname === "/api/v1/configurations" &&
        init?.method === "POST" &&
        typeof init.body === "string"
      ) {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          if (Object.prototype.hasOwnProperty.call(body, "tenant_id")) {
            const bodyWithoutTenantId = Object.fromEntries(
              Object.entries(body).filter(([key]) => key !== "tenant_id"),
            );
            requestInit = { ...init, body: JSON.stringify(bodyWithoutTenantId) };
          }
        } catch {
          /* preserve malformed body for the request under test */
        }
      }
    }
    const response = await exports.default.fetch(url, { ...requestInit, headers });
    if (
      new URL(url).pathname === "/api/v1/configurations" &&
      init?.method === "POST" &&
      response.status === 201
    ) {
      const body = (await response.clone().json()) as { id?: unknown; tenant_id?: unknown };
      if (typeof body.id === "string" && typeof body.tenant_id === "string") {
        configTenantIds.set(body.id, body.tenant_id);
      }
    }
    return response;
  }
  return exports.default.fetch(url, init);
}

// ─── D1 Schema Setup ────────────────────────────────────────────────

/**
 * Initialize all D1 tables. Idempotent — safe to call in every beforeAll.
 */
export async function setupD1(): Promise<void> {
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'starter' CHECK(plan IN ('hobby', 'pro', 'starter', 'growth', 'enterprise')), max_configs INTEGER NOT NULL DEFAULT 1 CHECK(max_configs >= 0), max_agents_per_config INTEGER NOT NULL DEFAULT 1000 CHECK(max_agents_per_config >= 0), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
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
}

// ─── WebSocket Helpers ──────────────────────────────────────────────

/**
 * Wait for the next message on a WebSocket.
 */
export function waitForMsg(ws: WebSocket, timeoutMs = 3000): Promise<MessageEvent> {
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

/**
 * Wait for WebSocket close event.
 */
export function waitForClose(ws: WebSocket, timeoutMs = 3000): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for close")), timeoutMs);
    ws.addEventListener(
      "close",
      (e) => {
        clearTimeout(timer);
        resolve(e as CloseEvent);
      },
      { once: true },
    );
  });
}

/**
 * Convert message data (Blob in workerd) to ArrayBuffer.
 */
export async function msgToBuffer(event: MessageEvent): Promise<ArrayBuffer> {
  return event.data instanceof Blob
    ? await (event.data as Blob).arrayBuffer()
    : (event.data as ArrayBuffer);
}

// ─── API Helpers ────────────────────────────────────────────────────

interface TenantResult {
  id: string;
  name: string;
}

interface ConfigResult {
  id: string;
  tenant_id: string;
  name: string;
}

interface EnrollmentResult {
  token: string;
  id: string;
}

/**
 * Create a tenant via the API. Returns { id, name }.
 */
export async function createTenant(name: string): Promise<TenantResult> {
  const res = await exports.default.fetch("http://localhost/api/admin/tenants", {
    method: "POST",
    body: JSON.stringify({ name, plan: "growth" }),
    headers: await adminSessionHeaders({ "Content-Type": "application/json" }),
  });
  expect(res.status).toBe(201);
  return res.json<TenantResult>();
}

/**
 * Create a configuration for a tenant. Returns { id, tenant_id, name }.
 */
export async function createConfig(tenantId: string, name: string): Promise<ConfigResult> {
  const res = await exports.default.fetch("http://localhost/api/v1/configurations", {
    method: "POST",
    body: JSON.stringify({ name }),
    headers: authHeaders({ "Content-Type": "application/json", "X-Tenant-Id": tenantId }),
  });
  expect(res.status).toBe(201);
  const config = await res.json<ConfigResult>();
  configTenantIds.set(config.id, tenantId);
  return config;
}

/**
 * Upload a YAML config version. Returns { hash, deduplicated }.
 */
export async function uploadConfigVersion(
  configId: string,
  yaml: string,
): Promise<{ hash: string; deduplicated: boolean }> {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/configurations/${configId}/versions`,
    {
      method: "POST",
      body: yaml,
      headers: authHeadersForConfig(configId),
    },
  );
  expect(res.status).toBe(201);
  return res.json<{ hash: string; deduplicated: boolean }>();
}

/**
 * Create an enrollment token for a config. Returns { token, id }.
 */
export async function createEnrollmentToken(configId: string): Promise<EnrollmentResult> {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/configurations/${configId}/enrollment-token`,
    {
      method: "POST",
      body: JSON.stringify({}),
      headers: authHeadersForConfig(configId, { "Content-Type": "application/json" }),
    },
  );
  expect(res.status).toBe(201);
  return res.json<EnrollmentResult>();
}

/**
 * Rollout the current config to all connected agents.
 */
export async function rolloutConfig(
  configId: string,
): Promise<{ pushed: number; config_hash: string }> {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/configurations/${configId}/rollout`,
    {
      method: "POST",
      headers: authHeadersForConfig(configId),
    },
  );
  expect(res.status).toBe(200);
  return res.json<{ pushed: number; config_hash: string }>();
}

/**
 * Get config stats (from DO via API).
 */
export async function getConfigStats(configId: string): Promise<{
  total_agents: number;
  connected_agents: number;
  healthy_agents: number;
  desired_config_hash: string | null;
  active_websockets: number;
}> {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/configurations/${configId}/stats`,
    {
      headers: authHeadersForConfig(configId),
    },
  );
  expect(res.status).toBe(200);
  return res.json();
}

/**
 * Get agent summaries from the config API.
 */
export async function getAgentSummaries(
  configId: string,
): Promise<{ agents: Record<string, unknown>[] }> {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/configurations/${configId}/agents`,
    { headers: authHeadersForConfig(configId) },
  );
  expect(res.status).toBe(200);
  return res.json();
}

// ─── WebSocket Connection Helpers ───────────────────────────────────

/**
 * Connect a WebSocket using an enrollment token. Returns the accepted WS +
 * the enrollment response (assignment_claim, instance_uid).
 *
 * Per OpAMP spec, client sends first. We send an initial hello to trigger
 * the deferred enrollment flow in the DO.
 */
export async function connectWithEnrollment(token: string): Promise<{
  ws: WebSocket;
  enrollment: { type: string; assignment_claim: string; instance_uid: string };
  instanceUid: string;
}> {
  const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
  });
  expect(wsRes.status).toBe(101);
  const ws = wsRes.webSocket!;
  ws.accept();

  // Per OpAMP spec: client sends first. Send hello to trigger enrollment.
  // buildHello() defaults include CONFIGURABLE_CAPABILITIES (ReportsStatus,
  // AcceptsRemoteConfig, ReportsEffectiveConfig, ReportsHealth,
  // ReportsRemoteConfig) which is the expected capability set for enrollment.
  ws.send(encodeFrame(buildHello()));

  // Receive enrollment_complete text message (response to our hello)
  const enrollEvent = await waitForMsg(ws);
  const enrollment = JSON.parse(enrollEvent.data as string);
  expect(enrollment.type).toBe("enrollment_complete");
  expect(enrollment.instance_uid).toBeDefined();

  // Receive OpAMP binary response (from state machine processing our hello)
  await waitForMsg(ws);

  return { ws, enrollment, instanceUid: enrollment.instance_uid as string };
}

/**
 * Connect a WebSocket using a signed assignment claim (reconnect path).
 */
export async function connectWithClaim(claim: AssignmentClaim): Promise<WebSocket> {
  const token = await signClaim(claim, O11YFLEET_CLAIM_HMAC_SECRET);
  const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
  });
  expect(wsRes.status).toBe(101);
  const ws = wsRes.webSocket!;
  ws.accept();
  return ws;
}

/**
 * Send an OpAMP hello message and return the server response.
 */
export async function sendHello(
  ws: WebSocket,
  opts: { seqNum?: number; capabilities?: number } = {},
): Promise<ServerToAgent> {
  const hello = buildHello({
    sequenceNum: opts.seqNum,
    capabilities: opts.capabilities,
  });
  ws.send(encodeFrame(hello));

  const msg = await waitForMsg(ws);
  const buf = await msgToBuffer(msg);
  return decodeFrame<ServerToAgent>(buf);
}

/**
 * Send an OpAMP heartbeat and return the server response.
 */
export async function sendHeartbeat(ws: WebSocket, seqNum: number): Promise<ServerToAgent> {
  ws.send(encodeFrame(buildHeartbeat({ sequenceNum: seqNum })));

  const msg = await waitForMsg(ws);
  const buf = await msgToBuffer(msg);
  return decodeFrame<ServerToAgent>(buf);
}

// Re-export codec utilities for convenience
export {
  encodeFrame,
  decodeFrame,
  AgentCapabilities,
  type AgentToServer,
  type ServerToAgent,
  type AssignmentClaim,
};

// Re-export message builders for convenience
export {
  buildHello,
  buildHeartbeat,
  buildHealthReport,
  buildConfigAck,
  buildDescriptionReport,
} from "@o11yfleet/test-utils";
