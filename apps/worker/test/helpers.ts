// Shared test helpers for worker integration tests
// Centralizes D1 schema setup, WebSocket helpers, and tenant/config creation

import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";
import { signClaim, verifyEnrollmentToken } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import { encodeFrame, decodeFrame, AgentCapabilities } from "@o11yfleet/core/codec";
import type { AgentToServer, ServerToAgent } from "@o11yfleet/core/codec";
import { uint8ToHex } from "@o11yfleet/core/hex";
import {
  buildHello,
  buildHeartbeat,
  buildHealthReport,
  buildConfigAck,
  buildDescriptionReport,
} from "@o11yfleet/test-utils";
import { bootstrapSchema } from "./fixtures/schema.js";

export const O11YFLEET_CLAIM_HMAC_SECRET = "dev-secret-key-for-testing-only-32ch";
export const O11YFLEET_API_BEARER_SECRET = "test-api-secret-for-dev-only-32chars";
const TEST_ADMIN_USER_ID = "test-admin-user";
const TEST_ADMIN_EMAIL = "admin@o11yfleet.test";

/** Standard auth headers for API requests in tests */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${O11YFLEET_API_BEARER_SECRET}`, ...extra };
}

async function ensureAuthTables(): Promise<void> {
  // Production migrations create users / sessions / auth_identities (and
  // their indexes). bootstrapSchema is idempotent so calling it from each
  // helper that needs auth tables is fine.
  await bootstrapSchema();
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
 * Initialize all D1 tables by applying the production migrations. Idempotent —
 * `bootstrapSchema` records progress in the standard `d1_migrations` table and
 * skips already-applied migrations, so calling this from every `beforeAll` is
 * safe.
 *
 * @deprecated Prefer importing `bootstrapSchema` from `./fixtures/schema.js`
 * directly. Kept as a thin alias so existing call sites don't break.
 */
export async function setupD1(): Promise<void> {
  await bootstrapSchema();
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
 *
 * Note: After protobuf-only refactor (c315fc1), the server no longer sends
 * enrollment_complete text messages. Instead, we construct the assignment_claim
 * locally from the enrollment token and server response.
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

  // Receive OpAMP binary response (server accepts enrollment and sends response)
  // The response contains instance_uid assigned by the server.
  const msgEvent = await waitForMsg(ws);
  const buf = await msgToBuffer(msgEvent);
  const response = decodeFrame<ServerToAgent>(buf);
  expect(response.instance_uid).toBeDefined();

  const instanceUid = uint8ToHex(response.instance_uid);

  // Construct a proper assignment claim for reconnect.
  // The enrollment token contains tenant_id and config_id, and the server
  // response gives us instance_uid. Generation starts at 1 for new enrollments.
  const enrollmentClaim = await verifyEnrollmentToken(token, O11YFLEET_CLAIM_HMAC_SECRET);
  const assignmentClaim: AssignmentClaim = {
    v: 1,
    tenant_id: enrollmentClaim.tenant_id,
    config_id: enrollmentClaim.config_id,
    instance_uid: instanceUid,
    generation: 1,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // 24h
  };
  const assignmentToken = await signClaim(assignmentClaim, O11YFLEET_CLAIM_HMAC_SECRET);

  return {
    ws,
    enrollment: {
      type: "enrollment_complete",
      assignment_claim: assignmentToken,
      instance_uid: instanceUid,
    },
    instanceUid,
  };
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
