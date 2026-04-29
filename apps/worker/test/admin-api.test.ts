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

  it("covers /api/admin/overview, /api/admin/health, and /api/admin/plans", async () => {
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
      checks: Record<string, { status: string; latency_ms?: number }>;
      timestamp: string;
    }>();
    expect(healthBody.status === "healthy" || healthBody.status === "degraded").toBe(true);
    expect(healthBody.checks.worker?.status).toBe("healthy");
    expect(healthBody.checks.d1?.status).toBe("healthy");
    expect(healthBody.checks.r2?.status).toBe("healthy");
    expect(healthBody.checks.durable_objects?.status).toBe("healthy");
    expect(["healthy", "unavailable"].includes(healthBody.checks.queue?.status ?? "")).toBe(true);

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
