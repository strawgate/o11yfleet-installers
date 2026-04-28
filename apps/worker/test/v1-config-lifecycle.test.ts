import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { apiFetch, createTenant, setupD1 } from "./helpers.js";

beforeAll(setupD1);

function v1Headers(tenantId: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "X-Tenant-Id": tenantId, ...extra };
}

describe("v1 configuration lifecycle", () => {
  it("enforces config limit under concurrent creates", async () => {
    const tenant = await createTenant(`V1 Concurrent Limit ${crypto.randomUUID()}`);
    await env.FP_DB.prepare(`UPDATE tenants SET max_configs = 1 WHERE id = ?`)
      .bind(tenant.id)
      .run();

    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        apiFetch("http://localhost/api/v1/configurations", {
          method: "POST",
          body: JSON.stringify({ name: `concurrent-${i}` }),
          headers: v1Headers(tenant.id, { "Content-Type": "application/json" }),
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
    const tenant = await createTenant(`V1 R2 Cleanup ${crypto.randomUUID()}`);

    const configARes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ name: "shared-a" }),
      headers: v1Headers(tenant.id, { "Content-Type": "application/json" }),
    });
    expect(configARes.status).toBe(201);
    const configA = await configARes.json<{ id: string }>();

    const configBRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ name: "shared-b" }),
      headers: v1Headers(tenant.id, { "Content-Type": "application/json" }),
    });
    expect(configBRes.status).toBe(201);
    const configB = await configBRes.json<{ id: string }>();

    const yaml = `receivers:\n  otlp:\n    protocols:\n      http:\n# ${crypto.randomUUID()}\n`;
    const uploadARes = await apiFetch(
      `http://localhost/api/v1/configurations/${configA.id}/versions`,
      {
        method: "POST",
        body: yaml,
        headers: v1Headers(tenant.id, { "Content-Type": "text/yaml" }),
      },
    );
    expect(uploadARes.status).toBe(201);
    const uploadA = await uploadARes.json<{ r2Key: string }>();

    const uploadBRes = await apiFetch(
      `http://localhost/api/v1/configurations/${configB.id}/versions`,
      {
        method: "POST",
        body: yaml,
        headers: v1Headers(tenant.id, { "Content-Type": "text/yaml" }),
      },
    );
    expect(uploadBRes.status).toBe(201);
    const uploadB = await uploadBRes.json<{ r2Key: string }>();
    expect(uploadB.r2Key).toBe(uploadA.r2Key);

    const deleteARes = await apiFetch(`http://localhost/api/v1/configurations/${configA.id}`, {
      method: "DELETE",
      headers: v1Headers(tenant.id),
    });
    expect(deleteARes.status).toBe(204);
    expect(await env.FP_CONFIGS.get(uploadA.r2Key)).not.toBeNull();

    const deleteBRes = await apiFetch(`http://localhost/api/v1/configurations/${configB.id}`, {
      method: "DELETE",
      headers: v1Headers(tenant.id),
    });
    expect(deleteBRes.status).toBe(204);
    expect(await env.FP_CONFIGS.get(uploadA.r2Key)).toBeNull();
  });
});
