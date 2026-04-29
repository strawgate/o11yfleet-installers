import { env } from "cloudflare:workers";
import { describe, it, expect, beforeAll } from "vitest";
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import { encodeFrame } from "@o11yfleet/core/codec";
import type { AgentToServer } from "@o11yfleet/core/codec";
import { AgentCapabilities } from "@o11yfleet/core/codec";
import { apiFetch } from "./helpers.js";

const CLAIM_SECRET = "dev-secret-key-for-testing-only-32ch";

beforeAll(async () => {
  // Set up D1 tables
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free', max_configs INTEGER NOT NULL DEFAULT 5, max_agents_per_config INTEGER NOT NULL DEFAULT 50000, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
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

describe("Ingress Router", () => {
  it("rejects requests without Authorization header", async () => {
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
  });

  it("rejects non-WebSocket requests", async () => {
    const response = await apiFetch("http://localhost/v1/opamp");
    expect(response.status).toBe(426);
  });

  it("rejects invalid assignment claim", async () => {
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: "Bearer invalid.claim.token",
      },
    });
    expect(response.status).toBe(401);
  });

  it("rejects expired assignment claim", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "t1",
      config_id: "c1",
      instance_uid: "uid1",
      generation: 1,
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const token = await signClaim(claim, CLAIM_SECRET);
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${token}`,
      },
    });
    expect(response.status).toBe(401);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain("expired");
  });

  it("accepts valid assignment claim and routes to DO (WebSocket upgrade)", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "tenant-ws",
      config_id: "config-ws",
      instance_uid: "abcdef0123456789",
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signClaim(claim, CLAIM_SECRET);
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${token}`,
      },
    });
    // Should get a 101 WebSocket upgrade
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
    response.webSocket!.accept();
    response.webSocket!.close();
  });

  it("rejects invalid enrollment token", async () => {
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: "Bearer fp_enroll_nonexistent_token_value",
      },
    });
    expect(response.status).toBe(401);
  });

  it("strips spoofed x-fp-* headers", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "real-tenant",
      config_id: "real-config",
      instance_uid: "real-uid-12345678",
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signClaim(claim, CLAIM_SECRET);

    // Try to spoof headers — ingress should strip them and use claim values
    const response = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${token}`,
        "x-fp-tenant-id": "spoofed-tenant",
        "x-fp-config-id": "spoofed-config",
      },
    });
    // Should succeed (101) — spoofed headers stripped, claim values used
    expect(response.status).toBe(101);
    response.webSocket!.accept();
    response.webSocket!.close();
  });

  it("enrollment flow: create tenant, config, token, then connect", async () => {
    // Create tenant
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Enrollment Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    // Create config
    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "enroll-config" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    // Create enrollment token
    const tokenRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-token`,
      {
        method: "POST",
        body: JSON.stringify({ label: "test" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    const tokenBody = await tokenRes.json<{ token: string }>();
    expect(tokenBody.token).toMatch(/^fp_enroll_/);

    // Connect with enrollment token
    const wsRes = await apiFetch("http://localhost/v1/opamp", {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${tokenBody.token}`,
      },
    });
    expect(wsRes.status).toBe(101);
    expect(wsRes.webSocket).toBeDefined();

    // The DO waits for client-first message per OpAMP spec
    const ws = wsRes.webSocket!;
    ws.accept();

    // Send hello to trigger enrollment
    const hello: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    };
    ws.send(encodeFrame(hello));

    // Read enrollment message
    const enrollmentMsg = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout")), 5000);
      ws.addEventListener("message", (event) => {
        clearTimeout(timer);
        resolve(event.data as string);
      });
    });

    const parsed = JSON.parse(enrollmentMsg);
    expect(parsed.type).toBe("enrollment_complete");
    expect(parsed.assignment_claim).toBeDefined();
    expect(parsed.instance_uid).toBeDefined();

    ws.close();
  });

  it("accepts auth via ?token= query param (WebSocket client compat)", async () => {
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: "qp-tenant",
      config_id: "qp-config",
      instance_uid: "qpuid123456789ab",
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const signed = await signClaim(claim, CLAIM_SECRET);

    // Use query param instead of Authorization header
    const response = await apiFetch(
      `http://localhost/v1/opamp?token=${encodeURIComponent(signed)}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
    response.webSocket!.accept();
    response.webSocket!.close();
  });
});
