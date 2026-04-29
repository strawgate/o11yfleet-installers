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

  it("serves compact latest-vs-previous version diff for copilot light fetches", async () => {
    const tenant = await createTenant(`V1 Version Diff ${crypto.randomUUID()}`);

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ name: "diff-target" }),
      headers: v1Headers(tenant.id, { "Content-Type": "application/json" }),
    });
    expect(configRes.status).toBe(201);
    const config = await configRes.json<{ id: string }>();

    const first = `receivers:\n  otlp: {}\nexporters:\n  debug: {}\nservice:\n  pipelines:\n    logs:\n      receivers: [otlp]\n      exporters: [debug]\n`;
    const second = `receivers:\n  otlp: {}\nprocessors:\n  batch: {}\nexporters:\n  debug: {}\nservice:\n  pipelines:\n    logs:\n      receivers: [otlp]\n      processors: [batch]\n      exporters: [debug]\n`;

    const uploadFirst = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
      {
        method: "POST",
        body: first,
        headers: v1Headers(tenant.id, { "Content-Type": "text/yaml" }),
      },
    );
    expect(uploadFirst.status).toBe(201);
    const firstVersion = await uploadFirst.json<{ hash: string }>();
    const uploadSecond = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
      {
        method: "POST",
        body: second,
        headers: v1Headers(tenant.id, { "Content-Type": "text/yaml" }),
      },
    );
    expect(uploadSecond.status).toBe(201);
    const secondVersion = await uploadSecond.json<{ hash: string }>();

    const diffRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/version-diff-latest-previous`,
      { headers: v1Headers(tenant.id) },
    );
    expect(diffRes.status).toBe(200);
    const diff = await diffRes.json<{
      available: boolean;
      latest: { config_hash: string };
      previous: { config_hash: string };
      diff: { added_lines: number; removed_lines: number; size_bytes_delta: number };
    }>();
    expect(diff.available).toBe(true);
    expect(diff.latest.config_hash).toBe(secondVersion.hash);
    expect(diff.previous.config_hash).toBe(firstVersion.hash);
    expect(diff.diff.added_lines).toBeGreaterThan(0);
    expect(diff.diff.size_bytes_delta).toBeGreaterThan(0);
  });

  it("counts reordered version lines as ordered diff changes", async () => {
    const tenant = await createTenant(`V1 Version Reorder Diff ${crypto.randomUUID()}`);

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ name: "reorder-diff-target" }),
      headers: v1Headers(tenant.id, { "Content-Type": "application/json" }),
    });
    expect(configRes.status).toBe(201);
    const config = await configRes.json<{ id: string }>();

    const first = `receivers:\n  otlp: {}\nexporters:\n  debug: {}\nservice:\n  pipelines:\n    logs:\n      receivers: [otlp]\n      exporters: [debug]\n`;
    const reordered = `exporters:\n  debug: {}\nreceivers:\n  otlp: {}\nservice:\n  pipelines:\n    logs:\n      receivers: [otlp]\n      exporters: [debug]\n`;

    const uploadFirst = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
      {
        method: "POST",
        body: first,
        headers: v1Headers(tenant.id, { "Content-Type": "text/yaml" }),
      },
    );
    expect(uploadFirst.status).toBe(201);
    const uploadSecond = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
      {
        method: "POST",
        body: reordered,
        headers: v1Headers(tenant.id, { "Content-Type": "text/yaml" }),
      },
    );
    expect(uploadSecond.status).toBe(201);

    const diffRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/version-diff-latest-previous`,
      { headers: v1Headers(tenant.id) },
    );
    expect(diffRes.status).toBe(200);
    const diff = await diffRes.json<{
      available: boolean;
      diff: { added_lines: number; removed_lines: number; line_count_delta: number };
    }>();
    expect(diff.available).toBe(true);
    expect(diff.diff.line_count_delta).toBe(0);
    expect(diff.diff.added_lines).toBeGreaterThan(0);
    expect(diff.diff.removed_lines).toBeGreaterThan(0);
  });

  it("lists versions with newest-first version ordinals", async () => {
    const tenant = await createTenant(`V1 Version Ordinals ${crypto.randomUUID()}`);

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ name: "version-ordinal-target" }),
      headers: v1Headers(tenant.id, { "Content-Type": "application/json" }),
    });
    expect(configRes.status).toBe(201);
    const config = await configRes.json<{ id: string }>();

    await apiFetch(`http://localhost/api/v1/configurations/${config.id}/versions`, {
      method: "POST",
      body: "receivers:\n  otlp: {}\n# first\n",
      headers: v1Headers(tenant.id, { "Content-Type": "text/yaml" }),
    });
    await apiFetch(`http://localhost/api/v1/configurations/${config.id}/versions`, {
      method: "POST",
      body: "receivers:\n  otlp: {}\n# second\n",
      headers: v1Headers(tenant.id, { "Content-Type": "text/yaml" }),
    });

    const versionsRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
      {
        headers: v1Headers(tenant.id),
      },
    );
    expect(versionsRes.status).toBe(200);
    const body = await versionsRes.json<{
      versions: Array<{ version: number; config_hash: string }>;
      current_config_hash: string;
    }>();
    expect(body.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(body.versions[0]?.config_hash).toBe(body.current_config_hash);
  });

  it("reports version diff unavailable when only one version exists", async () => {
    const tenant = await createTenant(`V1 Single Version Diff ${crypto.randomUUID()}`);

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ name: "single-version-diff-target" }),
      headers: v1Headers(tenant.id, { "Content-Type": "application/json" }),
    });
    expect(configRes.status).toBe(201);
    const config = await configRes.json<{ id: string }>();

    const uploadRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/versions`,
      {
        method: "POST",
        body: "receivers:\n  otlp: {}\n",
        headers: v1Headers(tenant.id, { "Content-Type": "text/yaml" }),
      },
    );
    expect(uploadRes.status).toBe(201);

    const diffRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/version-diff-latest-previous`,
      { headers: v1Headers(tenant.id) },
    );
    expect(diffRes.status).toBe(200);
    const diff = await diffRes.json<{
      available: boolean;
      versions_seen: number;
      reason: string;
    }>();
    expect(diff.available).toBe(false);
    expect(diff.versions_seen).toBe(1);
    expect(diff.reason).toContain("At least two versions");
  });

  it("serves rollout cohort summary for explicit copilot light fetches", async () => {
    const tenant = await createTenant(`V1 Rollout Summary ${crypto.randomUUID()}`);

    const configRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      body: JSON.stringify({ name: "rollout-target" }),
      headers: v1Headers(tenant.id, { "Content-Type": "application/json" }),
    });
    expect(configRes.status).toBe(201);
    const config = await configRes.json<{ id: string }>();

    const summaryRes = await apiFetch(
      `http://localhost/api/v1/configurations/${config.id}/rollout-cohort-summary`,
      { headers: v1Headers(tenant.id) },
    );
    expect(summaryRes.status).toBe(200);
    const summary = await summaryRes.json<{
      total_agents: number;
      connected_agents: number;
      drifted_agents: number;
      status_counts: Record<string, number>;
    }>();
    expect(summary.total_agents).toBe(0);
    expect(summary.connected_agents).toBe(0);
    expect(summary.drifted_agents).toBe(0);
    expect(summary.status_counts).toEqual({});
  });
});
