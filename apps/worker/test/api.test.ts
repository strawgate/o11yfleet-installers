import { env } from "cloudflare:workers";
import { describe, it, expect, beforeAll } from "vitest";
import { apiFetch } from "./helpers.js";
import { bootstrapSchema } from "./fixtures/schema.js";

beforeAll(() => bootstrapSchema());

describe("API routes", () => {
  it("POST /api/admin/tenants creates a tenant", async () => {
    const response = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Test Corp" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(201);
    const body = await response.json<{ id: string; name: string; plan: string }>();
    expect(body.name).toBe("Test Corp");
    expect(body.plan).toBe("starter");
    expect(body.id).toBeDefined();
  });

  it("POST /api/v1/configurations creates a configuration", async () => {
    // First create a tenant
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Config Test Corp", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const response = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "production" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(201);
    const body = await response.json<{ id: string; name: string }>();
    expect(body.name).toBe("production");
  });

  it("derives tenant scope when test helper receives a blank tenant header", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Blank Header Test Corp", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const response = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "blank-header" }),
      headers: { "Content-Type": "application/json", "X-Tenant-Id": " " },
    });
    expect(response.status).toBe(201);
  });

  it("POST /api/v1/configurations trims and validates configuration name", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: `Trim Test ${crypto.randomUUID()}`, plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const whitespaceRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "   " }),
      headers: { "Content-Type": "application/json" },
    });
    expect(whitespaceRes.status).toBe(400);

    const response = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "  production  " }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(201);
    const body = await response.json<{ name: string }>();
    expect(body.name).toBe("production");
  });

  it("POST /api/v1/configurations rejects schema drift", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: `Schema Drift ${crypto.randomUUID()}`, plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const wrongType = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: 42 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toMatchObject({
      code: "validation_error",
      field: "name",
    });

    const unknown = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "valid", enabled: true }),
      headers: { "Content-Type": "application/json" },
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      code: "validation_error",
      field: "enabled",
    });
  });

  it("POST /api/v1/configurations rejects missing and overlong names", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: `Schema Limits ${crypto.randomUUID()}`, plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const missingName = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id }),
      headers: { "Content-Type": "application/json" },
    });
    expect(missingName.status).toBe(400);
    expect(await missingName.json()).toMatchObject({
      code: "validation_error",
      field: "name",
      detail: "required",
    });

    const overlongName = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "x".repeat(256) }),
      headers: { "Content-Type": "application/json" },
    });
    expect(overlongName.status).toBe(400);
    expect(await overlongName.json()).toMatchObject({
      code: "validation_error",
      field: "name",
      detail: "too_long",
    });
  });

  it("GET /api/v1/configurations/:id returns config", async () => {
    // Create tenant + config
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Get Test", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "staging" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    const getRes = await apiFetch(`http://localhost/api/v1/configurations/${config.id}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json<{ id: string; name: string }>();
    expect(body.name).toBe("staging");
  });

  it("GET /api/v1/configurations/nonexistent returns 404", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Missing Config Test", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const response = await apiFetch("http://localhost/api/v1/configurations/does-not-exist", {
      headers: { "X-Tenant-Id": tenant.id },
    });
    expect(response.status).toBe(404);
  });

  it("POST /api/v1/configurations/:id/versions uploads YAML", async () => {
    // Create tenant + config
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Upload Test", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "upload-test" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    const yaml = "receivers:\n  otlp:\n    protocols:\n      grpc:\n";
    const uploadRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
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
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Dedup Test", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "dedup-test" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    const yaml = "exporters:\n  debug:\n    verbosity: detailed\n";

    // First upload
    const r1 = await apiFetch(`http://localhost/api/v1/configurations/${config.id}/versions`, {
      method: "POST",
      body: yaml,
    });
    const b1 = await r1.json<{ hash: string; deduplicated: boolean }>();
    expect(b1.deduplicated).toBe(false);

    // Second upload — same content
    const r2 = await apiFetch(`http://localhost/api/v1/configurations/${config.id}/versions`, {
      method: "POST",
      body: yaml,
    });
    const b2 = await r2.json<{ hash: string; deduplicated: boolean }>();
    expect(b2.deduplicated).toBe(true);
    expect(b2.hash).toBe(b1.hash);
  });

  it("POST /api/v1/configurations/:id/enrollment-token creates token", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Token Test", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "token-test" }),
      headers: { "Content-Type": "application/json" },
    });
    const config = await configRes.json<{ id: string }>();

    const tokenRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-token`,
      {
        method: "POST",
        body: JSON.stringify({ label: "test-agent" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(tokenRes.status).toBe(201);
    const body = await tokenRes.json<{ token: string; id: string }>();
    expect(body.token).toMatch(/^fp_enroll_/);

    const invalidTokenRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-token`,
      {
        method: "POST",
        body: JSON.stringify({ label: "test-agent", expires_in_hours: "soon" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(invalidTokenRes.status).toBe(400);
    expect(await invalidTokenRes.json()).toMatchObject({
      code: "validation_error",
      field: "expires_in_hours",
    });

    const tooLongTokenRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-token`,
      {
        method: "POST",
        body: JSON.stringify({ label: "x".repeat(256) }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(tooLongTokenRes.status).toBe(400);
    expect(await tooLongTokenRes.json()).toMatchObject({
      code: "validation_error",
      field: "label",
      detail: "too_long",
    });

    const tooLargeExpiryRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/enrollment-token`,
      {
        method: "POST",
        body: JSON.stringify({ expires_in_hours: 8761 }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(tooLargeExpiryRes.status).toBe(400);
    expect(await tooLargeExpiryRes.json()).toMatchObject({
      code: "validation_error",
      field: "expires_in_hours",
      detail: "too_large",
    });
  });

  it("PUT /api/v1/tenant validates update shape", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Tenant Update Shape", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const response = await apiFetch("http://localhost/api/v1/tenant", {
      method: "PUT",
      body: JSON.stringify({ name: 123 }),
      headers: { "Content-Type": "application/json", "X-Tenant-Id": tenant.id },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "validation_error",
      field: "name",
    });
  });

  it("GET /api/admin/tenants/:id/configurations lists configs", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "List Test", plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    // Create 2 configs
    await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "config-a" }),
      headers: { "Content-Type": "application/json" },
    });
    await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "config-b" }),
      headers: { "Content-Type": "application/json" },
    });

    const listRes = await apiFetch(
      `http://localhost/api/admin/tenants/${tenant.id}/configurations`,
    );
    expect(listRes.status).toBe(200);
    const body = await listRes.json<{ configurations: Array<{ name: string }> }>();
    expect(body.configurations.length).toBe(2);
  });

  it("enforces policy limit for Starter tier", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: "Limit Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const first = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "starter-policy" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(first.status).toBe(201);

    const res = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "starter-overflow" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(429);
  });

  it("enforces config limit under concurrent creates", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: `Concurrent Limit ${crypto.randomUUID()}`, plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    await env.FP_DB.prepare(`UPDATE tenants SET max_configs = 1 WHERE id = ?`)
      .bind(tenant.id)
      .run();

    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        apiFetch("http://localhost/api/v1/configurations", {
          method: "POST",
          body: JSON.stringify({ tenant_id: tenant.id, name: `concurrent-${i}` }),
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    expect(attempts.filter((res) => res.status === 201)).toHaveLength(1);
    expect(attempts.filter((res) => res.status === 429)).toHaveLength(7);

    const row = await env.FP_DB.prepare(
      `SELECT COUNT(*) as count FROM configurations WHERE tenant_id = ?`,
    )
      .bind(tenant.id)
      .first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it("keeps shared R2 config content until all referencing configs are deleted", async () => {
    const tenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ name: `R2 Cleanup ${crypto.randomUUID()}`, plan: "growth" }),
      headers: { "Content-Type": "application/json" },
    });
    const tenant = await tenantRes.json<{ id: string }>();

    const configARes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "shared-a" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(configARes.status).toBe(201);
    const configA = await configARes.json<{ id: string }>();

    const configBRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenant.id, name: "shared-b" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(configBRes.status).toBe(201);
    const configB = await configBRes.json<{ id: string }>();

    const yaml = `receivers:\n  otlp:\n    protocols:\n      grpc:\n# ${crypto.randomUUID()}\n`;
    const uploadARes = await apiFetch(
      `http://localhost/api/v1/configurations/${configA.id}/versions`,
      { method: "POST", body: yaml, headers: { "Content-Type": "text/yaml" } },
    );
    expect(uploadARes.status).toBe(201);
    const uploadA = await uploadARes.json<{ r2Key: string }>();

    const uploadBRes = await apiFetch(
      `http://localhost/api/v1/configurations/${configB.id}/versions`,
      { method: "POST", body: yaml, headers: { "Content-Type": "text/yaml" } },
    );
    expect(uploadBRes.status).toBe(201);
    const uploadB = await uploadBRes.json<{ r2Key: string }>();
    expect(uploadB.r2Key).toBe(uploadA.r2Key);

    const deleteARes = await apiFetch(`http://localhost/api/v1/configurations/${configA.id}`, {
      method: "DELETE",
    });
    expect(deleteARes.status).toBe(204);
    expect(await env.FP_CONFIGS.get(uploadA.r2Key)).not.toBeNull();

    const deleteBRes = await apiFetch(`http://localhost/api/v1/configurations/${configB.id}`, {
      method: "DELETE",
    });
    expect(deleteBRes.status).toBe(204);
    expect(await env.FP_CONFIGS.get(uploadA.r2Key)).toBeNull();
  });
});
