// Verifies the fleet-compatibility rollout gate forwards the DO 409 INCOMPATIBLE_FLEET
// payload and uses a strict-boolean `override` check.
//
// Regression for #727 (PR #715 follow-up): the worker previously turned the DO 409
// into an opaque 502 (so callers never saw the structured payload), and accepted
// `override: "false"` as truthy because it used `?? false`.

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ConfigDurableObject } from "../src/durable-objects/config-do.js";
import { apiFetch, authHeaders, bootstrapSchema, createTenant } from "./helpers.js";

const YAML_REQUIRES_PROMETHEUS = `receivers:
  prometheus: {}
exporters:
  otlp: {}
`;

interface ConfigCreateResult {
  id: string;
  tenant_id: string;
  name: string;
}

async function createConfig(tenantId: string, name: string): Promise<ConfigCreateResult> {
  const res = await apiFetch("http://localhost/api/v1/configurations", {
    method: "POST",
    body: JSON.stringify({ name }),
    headers: { ...authHeaders(), "X-Tenant-Id": tenantId, "Content-Type": "application/json" },
  });
  expect(res.status).toBe(201);
  return res.json<ConfigCreateResult>();
}

async function uploadVersion(tenantId: string, configId: string, yaml: string): Promise<void> {
  const res = await apiFetch(`http://localhost/api/v1/configurations/${configId}/versions`, {
    method: "POST",
    body: yaml,
    headers: { ...authHeaders(), "X-Tenant-Id": tenantId },
  });
  expect(res.status).toBe(201);
}

/**
 * Inject one agent into the Config DO whose available_components advertise ONLY
 * `otlp` receiver — this makes a YAML that requires `prometheus` incompatible.
 */
async function seedIncompatibleAgent(tenantId: string, configId: string): Promise<void> {
  const doId = env.CONFIG_DO.idFromName(`${tenantId}:${configId}`);
  const stub = env.CONFIG_DO.get(doId);
  // Bootstrapping the DO ensures storage tables are created before we INSERT.
  await stub.fetch("http://internal/stats");
  await runInDurableObject(stub, async (_inst: InstanceType<typeof ConfigDurableObject>, state) => {
    const now = Date.now();
    state.storage.sql.exec(
      `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at, available_components)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "agent-incompat-1",
      tenantId,
      configId,
      "connected",
      now,
      now,
      JSON.stringify({
        components: {
          receivers: { sub_component_map: { otlp: {} } },
          processors: { sub_component_map: {} },
          exporters: { sub_component_map: { otlp: {} } },
          extensions: { sub_component_map: {} },
          connectors: { sub_component_map: {} },
        },
      }),
    );
  });
}

describe("rollout fleet-compatibility gate", () => {
  beforeAll(async () => {
    await bootstrapSchema();
  });

  it("returns 409 INCOMPATIBLE_FLEET (forwarded from DO) when fleet lacks required components", async () => {
    const tenant = await createTenant(`Rollout Gate 409 ${crypto.randomUUID()}`);
    const config = await createConfig(tenant.id, "rollout-gate-409");
    await uploadVersion(tenant.id, config.id, YAML_REQUIRES_PROMETHEUS);
    await seedIncompatibleAgent(tenant.id, config.id);

    const res = await apiFetch(`http://localhost/api/v1/configurations/${config.id}/rollout`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: {
        ...authHeaders(),
        "X-Tenant-Id": tenant.id,
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(409);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const body = (await res.json()) as {
      error: string;
      missing_components: { kind: string; name: string }[];
      incompatible_agents: number;
    };
    expect(body.error).toBe("INCOMPATIBLE_FLEET");
    expect(body.incompatible_agents).toBeGreaterThanOrEqual(1);
    expect(
      body.missing_components.some((c) => c.kind === "receivers" && c.name === "prometheus"),
    ).toBe(true);
  });

  it("proceeds (200) when override is the strict boolean true", async () => {
    const tenant = await createTenant(`Rollout Gate Override ${crypto.randomUUID()}`);
    const config = await createConfig(tenant.id, "rollout-gate-override");
    await uploadVersion(tenant.id, config.id, YAML_REQUIRES_PROMETHEUS);
    await seedIncompatibleAgent(tenant.id, config.id);

    const res = await apiFetch(`http://localhost/api/v1/configurations/${config.id}/rollout`, {
      method: "POST",
      body: JSON.stringify({ override: true }),
      headers: {
        ...authHeaders(),
        "X-Tenant-Id": tenant.id,
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { config_hash?: string };
    expect(typeof body.config_hash).toBe("string");
  });

  it("still blocks (409) when override is the string 'false' (no type coercion bypass)", async () => {
    const tenant = await createTenant(`Rollout Gate StringFalse ${crypto.randomUUID()}`);
    const config = await createConfig(tenant.id, "rollout-gate-stringfalse");
    await uploadVersion(tenant.id, config.id, YAML_REQUIRES_PROMETHEUS);
    await seedIncompatibleAgent(tenant.id, config.id);

    const res = await apiFetch(`http://localhost/api/v1/configurations/${config.id}/rollout`, {
      method: "POST",
      body: JSON.stringify({ override: "false" }),
      headers: {
        ...authHeaders(),
        "X-Tenant-Id": tenant.id,
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INCOMPATIBLE_FLEET");
  });

  it("also blocks (409) when override is a truthy non-boolean like 'true' string", async () => {
    const tenant = await createTenant(`Rollout Gate StringTrue ${crypto.randomUUID()}`);
    const config = await createConfig(tenant.id, "rollout-gate-stringtrue");
    await uploadVersion(tenant.id, config.id, YAML_REQUIRES_PROMETHEUS);
    await seedIncompatibleAgent(tenant.id, config.id);

    const res = await apiFetch(`http://localhost/api/v1/configurations/${config.id}/rollout`, {
      method: "POST",
      body: JSON.stringify({ override: "true" }),
      headers: {
        ...authHeaders(),
        "X-Tenant-Id": tenant.id,
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(409);
  });
});
