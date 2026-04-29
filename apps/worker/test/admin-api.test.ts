import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setupD1 } from "./helpers.js";

beforeAll(async () => {
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
});

describe("admin API routes", () => {
  it("rejects admin route access without bearer token", async () => {
    const response = await exports.default.fetch("http://localhost/api/admin/health");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin access required" });
  });

  it("rejects admin route access for non-admin session", async () => {
    const tenantId = crypto.randomUUID();
    await env.FP_DB.prepare(
      `INSERT INTO tenants (id, name, plan, max_configs, max_agents_per_config) VALUES (?, ?, 'free', 5, 50000)`,
    )
      .bind(tenantId, `Auth Tenant ${tenantId}`)
      .run();

    const userId = crypto.randomUUID();
    await env.FP_DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, tenant_id) VALUES (?, ?, ?, ?, 'member', ?)`,
    )
      .bind(userId, `${userId}@example.com`, "not-used-in-test", "Member User", tenantId)
      .run();

    const sessionId = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await env.FP_DB.prepare(
      `INSERT INTO sessions (id, user_id, expires_at, is_impersonation) VALUES (?, ?, ?, 0)`,
    )
      .bind(sessionId, userId, expiresAt)
      .run();

    const response = await exports.default.fetch("http://localhost/api/admin/overview", {
      headers: { Cookie: `fp_session=${sessionId}` },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin access required" });
  });

  it("covers tenant CRUD routes plus tenant scoped admin listings", async () => {
    const createRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Admin Tenant", plan: "pro" }),
    });
    expect(createRes.status).toBe(201);
    const createdTenant = await createRes.json<{
      id: string;
      name: string;
      plan: string;
    }>();
    expect(createdTenant.name).toBe("Admin Tenant");
    expect(createdTenant.plan).toBe("pro");

    const listTenantsRes = await apiFetch("http://localhost/api/admin/tenants");
    expect(listTenantsRes.status).toBe(200);
    const listTenantsBody = await listTenantsRes.json<{
      tenants: Array<{ id: string; name: string; plan: string }>;
    }>();
    expect(listTenantsBody.tenants.some((t) => t.id === createdTenant.id)).toBe(true);

    const getTenantRes = await apiFetch(`http://localhost/api/admin/tenants/${createdTenant.id}`);
    expect(getTenantRes.status).toBe(200);
    const getTenantBody = await getTenantRes.json<{ id: string; name: string; plan: string }>();
    expect(getTenantBody.id).toBe(createdTenant.id);
    expect(getTenantBody.name).toBe("Admin Tenant");

    const updateRes = await apiFetch(`http://localhost/api/admin/tenants/${createdTenant.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Admin Tenant Updated", plan: "enterprise" }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json<{
      id: string;
      name: string;
      plan: string;
      max_configs: number;
      max_agents_per_config: number;
    }>();
    expect(updateBody.name).toBe("Admin Tenant Updated");
    expect(updateBody.plan).toBe("enterprise");
    expect(updateBody.max_configs).toBe(1000);

    const createConfigRes = await apiFetch("http://localhost/api/v1/configurations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: createdTenant.id, name: "admin-config-a" }),
    });
    expect(createConfigRes.status).toBe(201);
    const createdConfig = await createConfigRes.json<{ id: string }>();

    const countedTenantsRes = await apiFetch("http://localhost/api/admin/tenants?limit=1");
    expect(countedTenantsRes.status).toBe(200);
    const countedTenantsBody = await countedTenantsRes.json<{
      tenants: Array<{ id: string; config_count: number; agent_count: number }>;
      pagination: { page: number; limit: number; total: number };
    }>();
    expect(countedTenantsBody.pagination.page).toBe(1);
    expect(countedTenantsBody.pagination.limit).toBe(1);
    expect(countedTenantsBody.pagination.total).toBeGreaterThanOrEqual(1);

    const allTenantsRes = await apiFetch("http://localhost/api/admin/tenants?limit=500");
    expect(allTenantsRes.status).toBe(200);
    const allTenantsBody = await allTenantsRes.json<{
      tenants: Array<{ id: string; config_count: number; agent_count: number }>;
    }>();
    const countedTenant = allTenantsBody.tenants.find((t) => t.id === createdTenant.id);
    expect(countedTenant?.config_count).toBe(1);
    expect(countedTenant?.agent_count).toBe(0);

    const doTablesRes = await apiFetch(
      `http://localhost/api/admin/configurations/${createdConfig.id}/do/tables`,
    );
    expect(doTablesRes.status).toBe(200);
    const doTablesBody = await doTablesRes.json<{ tables: string[] }>();
    expect(doTablesBody.tables).toContain("agents");

    const doQueryRes = await apiFetch(
      `http://localhost/api/admin/configurations/${createdConfig.id}/do/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sql: "SELECT instance_uid, status FROM agents LIMIT ?",
          params: [5],
        }),
      },
    );
    expect(doQueryRes.status).toBe(200);
    const doQueryBody = await doQueryRes.json<{ row_count: number; rows: unknown[] }>();
    expect(doQueryBody.row_count).toBeTypeOf("number");
    expect(Array.isArray(doQueryBody.rows)).toBe(true);

    const unsafeDoQueryRes = await apiFetch(
      `http://localhost/api/admin/configurations/${createdConfig.id}/do/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1; DELETE FROM agents", params: [] }),
      },
    );
    expect(unsafeDoQueryRes.status).toBe(400);

    const pragmaDoQueryRes = await apiFetch(
      `http://localhost/api/admin/configurations/${createdConfig.id}/do/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "PRAGMA table_list", params: [] }),
      },
    );
    expect(pragmaDoQueryRes.status).toBe(400);

    const tenantConfigsRes = await apiFetch(
      `http://localhost/api/admin/tenants/${createdTenant.id}/configurations`,
    );
    expect(tenantConfigsRes.status).toBe(200);
    const tenantConfigsBody = await tenantConfigsRes.json<{
      configurations: Array<{ id: string; tenant_id: string; name: string }>;
    }>();
    expect(tenantConfigsBody.configurations.some((c) => c.name === "admin-config-a")).toBe(true);

    const userId = crypto.randomUUID();
    await env.FP_DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, tenant_id) VALUES (?, ?, ?, ?, 'member', ?)`,
    )
      .bind(
        userId,
        `${userId}@tenant-users.example`,
        "test-only",
        "Tenant Member",
        createdTenant.id,
      )
      .run();

    const tenantUsersRes = await apiFetch(
      `http://localhost/api/admin/tenants/${createdTenant.id}/users`,
    );
    expect(tenantUsersRes.status).toBe(200);
    const tenantUsersBody = await tenantUsersRes.json<{
      users: Array<{ id: string; email: string; role: string }>;
    }>();
    expect(tenantUsersBody.users.some((u) => u.id === userId)).toBe(true);

    const impersonateRes = await apiFetch(
      `http://localhost/api/admin/tenants/${createdTenant.id}/impersonate`,
      { method: "POST" },
    );
    expect(impersonateRes.status).toBe(200);
    const impersonationCookie = impersonateRes.headers.get("Set-Cookie") ?? "";
    expect(impersonationCookie).toContain("fp_session=");
    expect(impersonationCookie).toContain("HttpOnly");
    expect(impersonationCookie).toContain("Path=/");
    expect(impersonationCookie).toContain("SameSite=Lax");
    expect(impersonationCookie).toContain("Max-Age=");
    expect(impersonationCookie).not.toContain("Secure");
    const impersonateBody = await impersonateRes.json<{
      user: { email: string; role: string; tenantId: string; isImpersonation: boolean };
    }>();
    expect(impersonateBody.user.email).toBe(`impersonation+${createdTenant.id}@o11yfleet.local`);
    expect(impersonateBody.user.role).toBe("member");
    expect(impersonateBody.user.tenantId).toBe(createdTenant.id);
    expect(impersonateBody.user.isImpersonation).toBe(true);

    const deleteBlockedRes = await apiFetch(
      `http://localhost/api/admin/tenants/${createdTenant.id}`,
      {
        method: "DELETE",
      },
    );
    expect(deleteBlockedRes.status).toBe(409);

    const emptyTenantRes = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Delete Me" }),
    });
    expect(emptyTenantRes.status).toBe(201);
    const emptyTenant = await emptyTenantRes.json<{ id: string }>();

    const deleteRes = await apiFetch(`http://localhost/api/admin/tenants/${emptyTenant.id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(204);
  });

  it("covers /api/admin/overview, /api/admin/health, /api/admin/usage, and /api/admin/plans", async () => {
    const overviewRes = await apiFetch("http://localhost/api/admin/overview");
    expect(overviewRes.status).toBe(200);
    const overviewBody = await overviewRes.json<{
      total_tenants: number;
      total_configurations: number;
      total_agents: number;
      total_active_tokens: number;
      total_users: number;
    }>();
    expect(overviewBody.total_tenants).toBeTypeOf("number");
    expect(overviewBody.total_configurations).toBeTypeOf("number");
    expect(overviewBody.total_agents).toBeTypeOf("number");
    expect(overviewBody.total_active_tokens).toBeTypeOf("number");
    expect(overviewBody.total_users).toBeTypeOf("number");

    const healthRes = await apiFetch("http://localhost/api/admin/health");
    expect(healthRes.status).toBe(200);
    const healthBody = await healthRes.json<{
      status: string;
      checks: Record<string, { status: string; latency_ms?: number; detail?: string }>;
      metrics: {
        total_tenants: number;
        total_configurations: number;
        tenants_without_configurations: number;
        configurations_without_agents: number;
        total_users: number;
        active_sessions: number;
        impersonation_sessions: number;
        active_tokens: number;
        total_agents: number;
        connected_agents: number;
        disconnected_agents: number;
        unknown_agents: number;
        healthy_agents: number;
        unhealthy_agents: number;
        stale_agents: number;
        last_agent_seen_at: string | null;
        latest_configuration_updated_at: string | null;
        plan_counts: Record<string, number>;
      };
      sources: Record<string, { status: string; detail: string }>;
      timestamp: string;
    }>();
    expect(healthBody.status === "healthy" || healthBody.status === "degraded").toBe(true);
    expect(healthBody.checks.worker?.status).toBe("healthy");
    expect(healthBody.checks.d1?.status).toBe("healthy");
    expect(healthBody.checks.r2?.status).toBe("healthy");
    expect(healthBody.checks.durable_objects?.status).toBe("healthy");
    expect(["healthy", "unavailable"].includes(healthBody.checks.queue?.status ?? "")).toBe(true);
    expect(healthBody.checks.d1?.detail).toContain("fleet counters");
    expect(healthBody.metrics.total_tenants).toBeTypeOf("number");
    expect(healthBody.metrics.total_configurations).toBeTypeOf("number");
    expect(healthBody.metrics.total_users).toBeTypeOf("number");
    expect(healthBody.metrics.active_sessions).toBeTypeOf("number");
    expect(healthBody.metrics.impersonation_sessions).toBeTypeOf("number");
    expect(healthBody.metrics.active_tokens).toBeTypeOf("number");
    expect(healthBody.metrics.total_agents).toBeTypeOf("number");
    expect(healthBody.metrics.connected_agents).toBeTypeOf("number");
    expect(healthBody.metrics.healthy_agents).toBeTypeOf("number");
    expect(healthBody.metrics.disconnected_agents).toBeTypeOf("number");
    expect(healthBody.metrics.unknown_agents).toBeTypeOf("number");
    expect(healthBody.metrics.unhealthy_agents).toBeTypeOf("number");
    expect(healthBody.metrics.stale_agents).toBeTypeOf("number");
    expect(healthBody.metrics.tenants_without_configurations).toBeTypeOf("number");
    expect(healthBody.metrics.configurations_without_agents).toBeTypeOf("number");
    expect(healthBody.metrics.plan_counts).toBeTypeOf("object");
    expect(healthBody.sources.app_database?.status).toBe("connected");
    expect(["connected", "degraded", "unavailable"]).toContain(
      healthBody.sources.binding_probes?.status,
    );
    expect(healthBody.sources.cloudflare_account_metrics?.status).toBe("not_configured");
    expect(healthBody.sources.cloudflare_account_metrics?.detail).toContain("No Cloudflare");

    const usageRes = await apiFetch("http://localhost/api/admin/usage");
    expect(usageRes.status).toBe(200);
    const usageBody = await usageRes.json<{
      configured: boolean;
      required_env: string[];
      services: Array<{
        id: string;
        status: string;
        month_to_date_estimated_spend_usd: number;
        projected_month_estimated_spend_usd: number;
      }>;
      month_to_date_estimated_spend_usd: number;
      projected_month_estimated_spend_usd: number;
    }>();
    expect(usageBody.configured).toBe(false);
    expect(usageBody.required_env).toContain("CLOUDFLARE_ACCOUNT_ANALYTICS_API_KEY");
    expect(usageBody.required_env).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(usageBody.required_env).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(usageBody.services.map((service) => service.id)).toEqual([
      "workers",
      "durable_objects",
      "d1",
      "r2",
      "queues",
    ]);
    expect(usageBody.services.every((service) => service.status === "not_configured")).toBe(true);
    expect(usageBody.month_to_date_estimated_spend_usd).toBe(0);
    expect(usageBody.projected_month_estimated_spend_usd).toBe(0);

    const plansRes = await apiFetch("http://localhost/api/admin/plans");
    expect(plansRes.status).toBe(200);
    const plansBody = await plansRes.json<{
      plans: Array<{
        id: string;
        name: string;
        max_configs: number;
        max_agents_per_config: number;
        tenant_count: number;
      }>;
    }>();
    const freePlan = plansBody.plans.find((p) => p.name === "free");
    const proPlan = plansBody.plans.find((p) => p.name === "pro");
    const enterprisePlan = plansBody.plans.find((p) => p.name === "enterprise");

    expect(freePlan).toBeDefined();
    expect(proPlan).toBeDefined();
    expect(enterprisePlan).toBeDefined();
    expect(freePlan?.id).toBe("free");
    expect(plansBody.plans.every((p) => typeof p.tenant_count === "number")).toBe(true);
  });
});
