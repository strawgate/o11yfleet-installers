import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  O11YFLEET_API_BEARER_SECRET,
  adminSessionHeaders,
  apiFetch,
  authHeaders,
  setupD1,
} from "./helpers.js";

beforeAll(async () => {
  await setupD1();
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin')), tenant_id TEXT REFERENCES tenants(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
  await env.FP_DB.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  await env.FP_DB.exec(
    `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, is_impersonation INTEGER NOT NULL DEFAULT 0, impersonator_user_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
  await env.FP_DB.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
  await env.FP_DB.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`);
  await env.FP_DB.exec(
    `CREATE INDEX IF NOT EXISTS idx_sessions_impersonation_expires ON sessions(is_impersonation, expires_at)`,
  );
});

describe("admin API routes", () => {
  it("filters, sorts, and paginates tenant lists consistently", async () => {
    const names = [
      { name: "Alpha Search", plan: "starter" },
      { name: "Beta Search", plan: "pro" },
      { name: "Gamma Ops", plan: "pro" },
    ];
    for (const entry of names) {
      const res = await apiFetch("http://localhost/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      expect(res.status).toBe(201);
    }

    const searchRes = await apiFetch(
      "http://localhost/api/admin/tenants?q=search&plan=pro&limit=1&page=1",
    );
    expect(searchRes.status).toBe(200);
    const searchBody = await searchRes.json<{
      tenants: Array<{ name: string; plan: string }>;
      pagination: { total: number; limit: number; page: number; has_more: boolean };
      filters: { q: string; plan: string; sort: string };
    }>();
    expect(searchBody.tenants).toHaveLength(1);
    expect(searchBody.pagination.total).toBe(1);
    expect(searchBody.pagination.limit).toBe(1);
    expect(searchBody.pagination.page).toBe(1);
    expect(searchBody.pagination.has_more).toBe(false);
    expect(searchBody.filters.q).toBe("search");
    expect(searchBody.filters.plan).toBe("pro");
    expect(searchBody.filters.sort).toBe("newest");
    expect(searchBody.tenants[0]?.name).toBe("Beta Search");

    const sortRes = await apiFetch("http://localhost/api/admin/tenants?sort=name_asc&limit=2");
    const sortBody = await sortRes.json<{ tenants: Array<{ name: string }> }>();
    expect(sortBody.tenants.map((tenant) => tenant.name)).toEqual(["Alpha Search", "Beta Search"]);

    const invalidRes = await apiFetch(
      "http://localhost/api/admin/tenants?plan=invalid&sort=hack&page=-1&limit=9999",
    );
    const invalidBody = await invalidRes.json<{
      pagination: { page: number; limit: number };
      filters: { plan: string; sort: string };
    }>();
    expect(invalidBody.filters.plan).toBe("all");
    expect(invalidBody.filters.sort).toBe("newest");
    expect(invalidBody.pagination.page).toBe(1);
    expect(invalidBody.pagination.limit).toBe(500);
  });
  it("does not crash on inherited prototype keys in sort param", async () => {
    for (const protoKey of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      const res = await apiFetch(`http://localhost/api/admin/tenants?sort=${protoKey}`);
      expect(res.status).toBe(200);
      const body = await res.json<{ filters: { sort: string } }>();
      expect(body.filters.sort).toBe("newest");
    }
  });
  it("treats LIKE wildcards in q as literal characters", async () => {
    for (const entry of [
      { name: "Underscore_Tenant", plan: "starter" },
      { name: "Percent%Tenant", plan: "starter" },
      { name: "PlainTenantX", plan: "starter" },
    ]) {
      const res = await apiFetch("http://localhost/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      expect(res.status).toBe(201);
    }

    const underscoreRes = await apiFetch(
      "http://localhost/api/admin/tenants?q=Underscore_Tenant&limit=10",
    );
    const underscoreBody = await underscoreRes.json<{ tenants: Array<{ name: string }> }>();
    expect(underscoreBody.tenants.map((t) => t.name)).toEqual(["Underscore_Tenant"]);

    const percentRes = await apiFetch("http://localhost/api/admin/tenants?q=%25Tenant&limit=10");
    const percentBody = await percentRes.json<{ tenants: Array<{ name: string }> }>();
    expect(percentBody.tenants.map((t) => t.name)).toEqual(["Percent%Tenant"]);
  });
  it("sets secure cross-site cookies for HTTPS login even without an environment binding", async () => {
    await exports.default.fetch("https://api.o11yfleet.com/auth/seed", {
      method: "POST",
      headers: { Authorization: `Bearer ${O11YFLEET_API_BEARER_SECRET}` },
    });

    const response = await exports.default.fetch("https://api.o11yfleet.com/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://o11yfleet.com" },
      body: JSON.stringify({ email: "admin@o11yfleet.com", password: "admin-password" }),
    });

    expect(response.status).toBe(200);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=None");
  });

  it("keeps the default seed route idempotent when seed users already exist", async () => {
    const first = await exports.default.fetch("https://api.o11yfleet.com/auth/seed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${O11YFLEET_API_BEARER_SECRET}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json<{ tenantId: string }>();

    const second = await exports.default.fetch("https://api.o11yfleet.com/auth/seed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${O11YFLEET_API_BEARER_SECRET}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json<{ tenantId: string }>();

    expect(secondBody.tenantId).toBe(firstBody.tenantId);
  });

  it("reconciles the default seed tenant to the current seed config", async () => {
    const seeded = await exports.default.fetch("https://api.o11yfleet.com/auth/seed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${O11YFLEET_API_BEARER_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenant_name: "Seed Tenant" }),
    });
    expect(seeded.status).toBe(200);
    const seededBody = await seeded.json<{ tenantId: string }>();

    await env.FP_DB.prepare(
      "UPDATE tenants SET name = ?, plan = ?, max_configs = ?, max_agents_per_config = ? WHERE id = ?",
    )
      .bind("Stale Tenant", "starter", 1, 1, seededBody.tenantId)
      .run();

    const reseeded = await exports.default.fetch("https://api.o11yfleet.com/auth/seed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${O11YFLEET_API_BEARER_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenant_name: "Seed Tenant" }),
    });
    expect(reseeded.status).toBe(200);

    const tenant = await env.FP_DB.prepare(
      "SELECT name, plan, max_configs, max_agents_per_config FROM tenants WHERE id = ?",
    )
      .bind(seededBody.tenantId)
      .first<{
        name: string;
        plan: string;
        max_configs: number;
        max_agents_per_config: number;
      }>();
    expect(tenant).toEqual({
      name: "Seed Tenant",
      plan: "growth",
      max_configs: 10,
      max_agents_per_config: 1000,
    });
  });

  it("rejects implicit reseed when the seed user has no tenant binding", async () => {
    const seeded = await exports.default.fetch("https://api.o11yfleet.com/auth/seed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${O11YFLEET_API_BEARER_SECRET}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(seeded.status).toBe(200);
    const seededBody = await seeded.json<{ tenantId: string }>();

    await env.FP_DB.prepare("UPDATE users SET tenant_id = NULL WHERE email = ?")
      .bind("demo@o11yfleet.com")
      .run();
    try {
      const response = await exports.default.fetch("https://api.o11yfleet.com/auth/seed", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${O11YFLEET_API_BEARER_SECRET}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "TENANT_CONFLICT" });
    } finally {
      await env.FP_DB.prepare("UPDATE users SET tenant_id = ? WHERE email = ?")
        .bind(seededBody.tenantId, "demo@o11yfleet.com")
        .run();
    }
  });

  it("rejects login payload schema drift", async () => {
    const response = await exports.default.fetch("https://api.o11yfleet.com/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://o11yfleet.com" },
      body: JSON.stringify({
        email: "admin@o11yfleet.com",
        password: "admin-password",
        remember_me: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "validation_error",
      field: "remember_me",
    });
  });

  it("rejects malformed login bodies with stable validation details", async () => {
    const invalidJson = await exports.default.fetch("https://api.o11yfleet.com/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://o11yfleet.com" },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toMatchObject({
      code: "validation_error",
      field: "body",
      detail: "invalid_json",
    });

    const missingPassword = await exports.default.fetch("https://api.o11yfleet.com/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://o11yfleet.com" },
      body: JSON.stringify({ email: "admin@o11yfleet.com" }),
    });
    expect(missingPassword.status).toBe(400);
    expect(await missingPassword.json()).toMatchObject({
      code: "validation_error",
      field: "password",
      detail: "required",
    });
  });

  it("rejects admin route access without bearer token", async () => {
    const response = await exports.default.fetch("http://localhost/api/admin/health");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin access required", oidc_error: null });
  });

  it("rejects O11YFLEET_API_BEARER_SECRET bearer access to admin routes", async () => {
    const response = await exports.default.fetch("http://localhost/api/admin/health", {
      headers: authHeaders(),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Admin session required",
      code: "admin_session_required",
    });
  });

  it("allows admin route access with an admin session", async () => {
    const response = await exports.default.fetch("http://localhost/api/admin/health", {
      headers: await adminSessionHeaders(),
    });

    expect(response.status).toBe(200);
  });

  it("rejects admin route access for non-admin session", async () => {
    const tenantId = crypto.randomUUID();
    await env.FP_DB.prepare(
      `INSERT INTO tenants (id, name, plan, max_configs, max_agents_per_config) VALUES (?, ?, 'starter', 1, 1000)`,
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
    expect(await response.json()).toEqual({ error: "Admin access required", oidc_error: null });
  });

  it("rejects admin tenant schema drift with stable validation details", async () => {
    const response = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tenant", extra: true }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "validation_error",
      field: "extra",
    });
  });

  it("rejects invalid admin tenant create payloads before persistence", async () => {
    const missingName = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "growth" }),
    });
    expect(missingName.status).toBe(400);
    expect(await missingName.json()).toMatchObject({
      code: "validation_error",
      field: "name",
      detail: "required",
    });

    const overlongName = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(256), plan: "growth" }),
    });
    expect(overlongName.status).toBe(400);
    expect(await overlongName.json()).toMatchObject({
      code: "validation_error",
      field: "name",
      detail: "too_long",
    });

    const invalidPlan = await apiFetch("http://localhost/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad Plan", plan: "gold" }),
    });
    expect(invalidPlan.status).toBe(400);
    expect(await invalidPlan.json()).toMatchObject({
      error: expect.stringContaining("Invalid plan"),
    });
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

    const invalidShapeDoQueryRes = await apiFetch(
      `http://localhost/api/admin/configurations/${createdConfig.id}/do/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1", params: [{ nested: true }] }),
      },
    );
    expect(invalidShapeDoQueryRes.status).toBe(400);
    expect(await invalidShapeDoQueryRes.json()).toMatchObject({
      code: "validation_error",
      field: "params",
    });

    const missingSqlDoQueryRes = await apiFetch(
      `http://localhost/api/admin/configurations/${createdConfig.id}/do/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: [] }),
      },
    );
    expect(missingSqlDoQueryRes.status).toBe(400);
    expect(await missingSqlDoQueryRes.json()).toMatchObject({
      code: "validation_error",
      field: "sql",
      detail: "required",
    });

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
    expect(healthBody.checks.queue).toBeUndefined();
    expect(healthBody.checks.d1?.detail).toContain("Core admin entity tables");
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
    expect(["connected", "error", "write_only", "not_bound"]).toContain(
      healthBody.sources.analytics_engine?.status,
    );
    expect(healthBody.sources.analytics_engine?.detail).toContain("fleet metrics");
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
    // required_env should contain the missing env vars (some may be set via CLOUDFLARE_ prefixed variants)
    expect(usageBody.required_env.length).toBeGreaterThan(0);
    // Should mention the Cloudflare usage API token requirement
    const requiredStr = usageBody.required_env.join(" ");
    expect(requiredStr).toMatch(/CLOUDFLARE.*API.*TOKEN|CLOUDFLARE.*TOKEN.*API/);
    // Should mention the account ID requirement
    expect(requiredStr).toMatch(/CLOUDFLARE.*ACCOUNT.*ID|ACCOUNT.*ID.*CLOUDFLARE/);
    expect(usageBody.services.map((service) => service.id)).toEqual([
      "workers",
      "durable_objects",
      "d1",
      "r2",
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
        max_policies: number;
        max_agents_per_config: number;
        tenant_count: number;
      }>;
    }>();
    const hobbyPlan = plansBody.plans.find((p) => p.id === "hobby");
    const proPlan = plansBody.plans.find((p) => p.id === "pro");
    const starterPlan = plansBody.plans.find((p) => p.id === "starter");
    const growthPlan = plansBody.plans.find((p) => p.id === "growth");
    const enterprisePlan = plansBody.plans.find((p) => p.id === "enterprise");

    expect(hobbyPlan).toBeDefined();
    expect(proPlan).toBeDefined();
    expect(starterPlan).toBeDefined();
    expect(growthPlan).toBeDefined();
    expect(enterprisePlan).toBeDefined();
    expect(starterPlan?.name).toBe("Starter");
    expect(growthPlan?.max_configs).toBe(10);
    expect(growthPlan?.max_policies).toBe(10);
    expect(plansBody.plans.every((p) => typeof p.tenant_count === "number")).toBe(true);
  });
});
