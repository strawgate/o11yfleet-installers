import { describe, it, expect, beforeAll } from "vitest";
import { apiFetch } from "./helpers.js";
import { bootstrapSchema } from "./fixtures/schema.js";

beforeAll(() => bootstrapSchema());

// Helper to create a tenant
async function createTenant(name = "Test Corp") {
  const res = await apiFetch("http://localhost/api/admin/tenants", {
    method: "POST",
    body: JSON.stringify({ name, plan: "growth" }),
    headers: { "Content-Type": "application/json" },
  });
  return res.json<{ id: string; name: string; plan: string }>();
}

// Helper to create a config
async function createConfig(tenantId: string, name = "test-config") {
  const res = await apiFetch("http://localhost/api/v1/configurations", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId, name }),
    headers: { "Content-Type": "application/json" },
  });
  return res.json<{ id: string; tenant_id: string; name: string }>();
}

// Helper to create enrollment token
async function createToken(configId: string) {
  const res = await apiFetch(
    `http://localhost/api/v1/configurations/${configId}/enrollment-token`,
    {
      method: "POST",
      body: JSON.stringify({ label: "test" }),
      headers: { "Content-Type": "application/json" },
    },
  );
  return res.json<{ id: string; token: string }>();
}

// ─── YAML Validation ────────────────────────────────────────────────

describe("YAML validation", () => {
  it("rejects invalid YAML syntax", async () => {
    const tenant = await createTenant("yaml-test");
    const config = await createConfig(tenant.id);

    const response = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
      {
        method: "POST",
        body: "this is: [not: valid: yaml:",
        headers: { "Content-Type": "text/yaml" },
      },
    );
    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain("Invalid YAML");
  });

  it("rejects YAML that parses to a scalar", async () => {
    const tenant = await createTenant("yaml-scalar");
    const config = await createConfig(tenant.id);

    const response = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
      {
        method: "POST",
        body: "just a plain string",
        headers: { "Content-Type": "text/yaml" },
      },
    );
    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain("Invalid YAML");
  });

  it("accepts valid YAML mapping", async () => {
    const tenant = await createTenant("yaml-valid");
    const config = await createConfig(tenant.id);

    const response = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
      {
        method: "POST",
        body: "receivers:\n  otlp:\n    protocols:\n      grpc:\n",
        headers: { "Content-Type": "text/yaml" },
      },
    );
    expect(response.status).toBe(201);
  });
});

// ─── Tenant CRUD ────────────────────────────────────────────────────

describe("Tenant CRUD", () => {
  it("GET /api/admin/tenants lists all tenants", async () => {
    await createTenant("list-test-1");
    await createTenant("list-test-2");

    const res = await apiFetch("http://localhost/api/admin/tenants");
    expect(res.status).toBe(200);
    const body = await res.json<{ tenants: Array<{ name: string }> }>();
    expect(body.tenants.length).toBeGreaterThanOrEqual(2);
  });

  it("GET /api/admin/tenants/:id returns a specific tenant", async () => {
    const tenant = await createTenant("get-test");
    const res = await apiFetch(`http://localhost/api/admin/tenants/${tenant.id}`);
    expect(res.status).toBe(200);
    const body = await res.json<{ id: string; name: string }>();
    expect(body.id).toBe(tenant.id);
    expect(body.name).toBe("get-test");
  });

  it("GET /api/admin/tenants/nonexistent returns 404", async () => {
    const res = await apiFetch("http://localhost/api/admin/tenants/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("PUT /api/admin/tenants/:id updates name", async () => {
    const tenant = await createTenant("before-update");
    const res = await apiFetch(`http://localhost/api/admin/tenants/${tenant.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "after-update" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ name: string }>();
    expect(body.name).toBe("after-update");
  });

  it("PUT /api/admin/tenants/:id validates update shape", async () => {
    const tenant = await createTenant("admin-update-shape");
    const res = await apiFetch(`http://localhost/api/admin/tenants/${tenant.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: 123 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "validation_error",
      field: "name",
    });
  });

  it("DELETE /api/admin/tenants/:id deletes an empty tenant", async () => {
    const tenant = await createTenant("delete-me");
    const res = await apiFetch(`http://localhost/api/admin/tenants/${tenant.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);

    // Verify it's gone
    const check = await apiFetch(`http://localhost/api/admin/tenants/${tenant.id}`);
    expect(check.status).toBe(404);
  });

  it("DELETE /api/admin/tenants/:id rejects when tenant has configs", async () => {
    const tenant = await createTenant("has-configs");
    await createConfig(tenant.id, "blocking-config");

    const res = await apiFetch(`http://localhost/api/admin/tenants/${tenant.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("configuration");
  });
});

// ─── Configuration CRUD ─────────────────────────────────────────────

describe("Configuration CRUD", () => {
  it("PUT /api/v1/configurations/:id updates name", async () => {
    const tenant = await createTenant("config-update");
    const config = await createConfig(tenant.id, "old-name");

    const res = await apiFetch(`http://localhost/api/v1/configurations/${config.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "new-name" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ name: string }>();
    expect(body.name).toBe("new-name");
  });

  it("PUT /api/v1/configurations/:id validates update shape", async () => {
    const tenant = await createTenant("config-update-shape");
    const config = await createConfig(tenant.id, "old-name");

    const res = await apiFetch(`http://localhost/api/v1/configurations/${config.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: 123 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "validation_error",
      field: "name",
    });
  });

  it("DELETE /api/v1/configurations/:id cascades deletes", async () => {
    const tenant = await createTenant("config-delete");
    const config = await createConfig(tenant.id, "to-delete");

    // Upload a version + create a token so there's stuff to cascade
    await apiFetch(`http://localhost/api/v1/configurations/${config.id}/versions`, {
      method: "POST",
      body: "key: value\n",
      headers: { "Content-Type": "text/yaml" },
    });
    await apiFetch(`http://localhost/api/v1/configurations/${config.id}/enrollment-token`, {
      method: "POST",
      body: JSON.stringify({ label: "cascade" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await apiFetch(`http://localhost/api/v1/configurations/${config.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);

    // Verify it's gone
    const check = await apiFetch(`http://localhost/api/v1/configurations/${config.id}`);
    expect(check.status).toBe(404);
  });
});

// ─── Config Versions ────────────────────────────────────────────────

describe("Config Versions", () => {
  it("GET /api/v1/configurations/:id/versions lists versions", async () => {
    const tenant = await createTenant("versions-list");
    const config = await createConfig(tenant.id, "with-versions");

    // Upload 2 versions
    await apiFetch(`http://localhost/api/v1/configurations/${config.id}/versions`, {
      method: "POST",
      body: "version: one\n",
      headers: { "Content-Type": "text/yaml" },
    });
    await apiFetch(`http://localhost/api/v1/configurations/${config.id}/versions`, {
      method: "POST",
      body: "version: two\n",
      headers: { "Content-Type": "text/yaml" },
    });

    const res = await apiFetch(`http://localhost/api/v1/configurations/${config.id}/versions`);
    expect(res.status).toBe(200);
    const body = await res.json<{
      versions: Array<{ config_hash: string }>;
      current_config_hash: string;
    }>();
    expect(body.versions.length).toBe(2);
    expect(body.current_config_hash).toBeTruthy();
  });
});

// ─── Token Revocation ───────────────────────────────────────────────

describe("Token revocation", () => {
  it("GET /api/v1/configurations/:id/enrollment-tokens lists tokens", async () => {
    const tenant = await createTenant("tokens-list");
    const config = await createConfig(tenant.id, "with-tokens");

    // Create 2 tokens
    await createToken(config.id);
    await createToken(config.id);

    const res = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-tokens`,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ tokens: Array<{ id: string }> }>();
    expect(body.tokens.length).toBe(2);
  });

  it("DELETE /api/v1/configurations/:id/enrollment-tokens/:tokenId revokes a token", async () => {
    const tenant = await createTenant("token-revoke");
    const config = await createConfig(tenant.id, "revoke-test");
    const token = await createToken(config.id);

    const res = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-tokens/${token.id}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ id: string; revoked: boolean }>();
    expect(body.revoked).toBe(true);

    // Verify it shows as revoked in the list
    const listRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-tokens`,
    );
    const list = await listRes.json<{ tokens: Array<{ id: string; revoked_at: string | null }> }>();
    const revokedToken = list.tokens.find((t) => t.id === token.id);
    expect(revokedToken?.revoked_at).toBeTruthy();
  });

  it("rejects revoking an already-revoked token", async () => {
    const tenant = await createTenant("double-revoke");
    const config = await createConfig(tenant.id, "double-test");
    const token = await createToken(config.id);

    // First revoke
    await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-tokens/${token.id}`,
      { method: "DELETE" },
    );

    // Second revoke
    const res = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-tokens/${token.id}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for nonexistent token", async () => {
    const tenant = await createTenant("token-404");
    const config = await createConfig(tenant.id, "missing-token");

    const res = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-tokens/does-not-exist`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });
});

// ─── Error Contract ─────────────────────────────────────────────────

describe("Consistent error contract", () => {
  it("returns { error } for invalid JSON body", async () => {
    const res = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: "not json at all",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBeTruthy();
    expect(typeof body.error).toBe("string");
  });

  it("returns { error } for missing required fields", async () => {
    const res = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("name");
  });

  it("returns { error } for 404 routes", async () => {
    const res = await apiFetch("http://localhost/api/nonexistent");
    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Not found");
  });

  it("returns { error } for invalid plan", async () => {
    const res = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "test", plan: "invalid-plan" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("Invalid plan");
  });
});
