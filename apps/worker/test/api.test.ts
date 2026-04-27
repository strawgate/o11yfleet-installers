import { env, exports } from "cloudflare:workers";
import { describe, it, expect, beforeAll } from "vitest";

// Apply D1 migrations before tests
beforeAll(async () => {
  await env.FP_DB.exec(`CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free', max_configs INTEGER NOT NULL DEFAULT 5, max_agents_per_config INTEGER NOT NULL DEFAULT 50000, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await env.FP_DB.exec(`CREATE TABLE IF NOT EXISTS configurations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, current_config_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await env.FP_DB.exec(`CREATE TABLE IF NOT EXISTS config_versions (id TEXT PRIMARY KEY, config_id TEXT NOT NULL, tenant_id TEXT NOT NULL, config_hash TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(config_id, config_hash))`);
  await env.FP_DB.exec(`CREATE TABLE IF NOT EXISTS enrollment_tokens (id TEXT PRIMARY KEY, config_id TEXT NOT NULL, tenant_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, label TEXT, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await env.FP_DB.exec(`CREATE TABLE IF NOT EXISTS agent_summaries (instance_uid TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, config_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unknown', healthy INTEGER NOT NULL DEFAULT 1, current_config_hash TEXT, last_seen_at TEXT, connected_at TEXT, disconnected_at TEXT, agent_description TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
});

describe("API routes", () => {
  it("POST /api/tenants creates a tenant", async () => {
    const response = await exports.default.fetch("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Test Corp" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(201);
    const body = await response.json<{ id: string; name: string; plan: string }>();
    expect(body.name).toBe("Test Corp");
    expect(body.plan).toBe("free");
    expect(body.id).toBeDefined();
  });

  it("POST /api/configurations creates a configuration", async () => {
    // First create a tenant
    const tenantRes = await exports.default.fetch("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Config Test Corp" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const response = await exports.default.fetch("http://localhost/api/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "production" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(201);
    const body = await response.json<{ id: string; name: string }>();
    expect(body.name).toBe("production");
  });

  it("GET /api/configurations/:id returns config", async () => {
    // Create tenant + config
    const tenantRes = await exports.default.fetch("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Get Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configRes = await exports.default.fetch("http://localhost/api/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "staging" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    const getRes = await exports.default.fetch(
      `http://localhost/api/configurations/${config.id}`,
    );
    expect(getRes.status).toBe(200);
    const body = await getRes.json<{ id: string; name: string }>();
    expect(body.name).toBe("staging");
  });

  it("GET /api/configurations/nonexistent returns 404", async () => {
    const response = await exports.default.fetch(
      "http://localhost/api/configurations/does-not-exist",
    );
    expect(response.status).toBe(404);
  });

  it("POST /api/configurations/:id/versions uploads YAML", async () => {
    // Create tenant + config
    const tenantRes = await exports.default.fetch("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Upload Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configRes = await exports.default.fetch("http://localhost/api/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "upload-test" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    const yaml = "receivers:\n  otlp:\n    protocols:\n      grpc:\n";
    const uploadRes = await exports.default.fetch(
      `http://localhost/api/configurations/${config.id}/versions`,
      {
        method: "POST",
        body: yaml,
        headers: { "Content-Type": "text/yaml" },
      },
    );
    expect(uploadRes.status).toBe(201);
    const body = await uploadRes.json<{ hash: string; r2Key: string; deduplicated: boolean }>();
    expect(body.hash).toBeDefined();
    expect(body.r2Key).toContain("configs/sha256/");
    expect(body.deduplicated).toBe(false);
  });

  it("POST same YAML twice results in dedup", async () => {
    const tenantRes = await exports.default.fetch("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Dedup Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configRes = await exports.default.fetch("http://localhost/api/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "dedup-test" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    const yaml = "exporters:\n  debug:\n    verbosity: detailed\n";

    // First upload
    const r1 = await exports.default.fetch(
      `http://localhost/api/configurations/${config.id}/versions`,
      { method: "POST", body: yaml },
    );
    const b1 = await r1.json<{ hash: string; deduplicated: boolean }>();
    expect(b1.deduplicated).toBe(false);

    // Second upload — same content
    const r2 = await exports.default.fetch(
      `http://localhost/api/configurations/${config.id}/versions`,
      { method: "POST", body: yaml },
    );
    const b2 = await r2.json<{ hash: string; deduplicated: boolean }>();
    expect(b2.deduplicated).toBe(true);
    expect(b2.hash).toBe(b1.hash);
  });

  it("POST /api/configurations/:id/enrollment-token creates token", async () => {
    const tenantRes = await exports.default.fetch("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Token Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configRes = await exports.default.fetch("http://localhost/api/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "token-test" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    const tokenRes = await exports.default.fetch(
      `http://localhost/api/configurations/${config.id}/enrollment-token`,
      {
        method: "POST",
        body: JSON.stringify({ label: "test-agent" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(tokenRes.status).toBe(201);
    const body = await tokenRes.json<{ token: string; id: string }>();
    expect(body.token).toMatch(/^fp_enroll_/);
  });

  it("GET /api/tenants/:id/configurations lists configs", async () => {
    const tenantRes = await exports.default.fetch("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "List Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    // Create 2 configs
    await exports.default.fetch("http://localhost/api/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "config-a" }),
      headers: { "Content-Type": "application/json" },
    });
    await exports.default.fetch("http://localhost/api/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "config-b" }),
      headers: { "Content-Type": "application/json" },
    });

    const listRes = await exports.default.fetch(
      `http://localhost/api/tenants/${tenant.id}/configurations`,
    );
    expect(listRes.status).toBe(200);
    const body = await listRes.json<{ configurations: Array<{ name: string }> }>();
    expect(body.configurations.length).toBe(2);
  });

  it("enforces config limit for free tier", async () => {
    const tenantRes = await exports.default.fetch("http://localhost/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Limit Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    // Create 5 configs (free tier limit)
    for (let i = 0; i < 5; i++) {
      const res = await exports.default.fetch("http://localhost/api/configurations", {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenant.id, name: `config-${i}` }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(201);
    }

    // 6th should fail
    const res = await exports.default.fetch("http://localhost/api/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "config-overflow" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(429);
  });
});
