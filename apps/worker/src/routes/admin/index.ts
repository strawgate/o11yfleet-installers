// Admin API routes — full tenant management, system health, impersonation
// These endpoints require admin auth (currently: API_SECRET bearer token)

import type { Env } from "../../index.js";

// ─── Error helpers ──────────────────────────────────────────────────

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function parseJsonBody<T>(request: Request): Promise<T> {
  return request.json<T>().catch(() => {
    throw new AdminApiError("Invalid JSON in request body", 400);
  });
}

class AdminApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// ─── Router ─────────────────────────────────────────────────────────

export async function handleAdminRequest(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    return await routeAdminRequest(request, env, url);
  } catch (err) {
    if (err instanceof AdminApiError) {
      return jsonError(err.message, err.status);
    }
    console.error("Admin API error:", err);
    return jsonError("Internal server error", 500);
  }
}

async function routeAdminRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // ─── Overview ────────────────────────────────────────────────

  if (path === "/api/admin/overview" && method === "GET") {
    return handleAdminOverview(env);
  }

  // ─── Tenants ────────────────────────────────────────────────

  if (path === "/api/admin/tenants" && method === "POST") {
    return handleCreateTenant(request, env);
  }
  if (path === "/api/admin/tenants" && method === "GET") {
    return handleListTenants(env);
  }

  const tenantIdMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)$/);
  if (tenantIdMatch) {
    if (method === "GET") return handleGetTenant(env, tenantIdMatch[1]!);
    if (method === "PUT") return handleUpdateTenant(request, env, tenantIdMatch[1]!);
    if (method === "DELETE") return handleDeleteTenant(env, tenantIdMatch[1]!);
  }

  // GET /api/admin/tenants/:id/configurations — admin view of all configs
  const tenantConfigsMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)\/configurations$/);
  if (tenantConfigsMatch && method === "GET") {
    return handleListConfigurations(env, tenantConfigsMatch[1]!);
  }

  // GET /api/admin/tenants/:id/users — admin view of tenant users
  const tenantUsersMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)\/users$/);
  if (tenantUsersMatch && method === "GET") {
    return handleListTenantUsers(env, tenantUsersMatch[1]!);
  }

  // ─── Health ─────────────────────────────────────────────────

  if (path === "/api/admin/health" && method === "GET") {
    return handleHealthCheck(env);
  }

  // ─── Plans ──────────────────────────────────────────────────

  if (path === "/api/admin/plans" && method === "GET") {
    return handleListPlans(env);
  }

  return jsonError("Not found", 404);
}

// ─── Plan Limits ─────────────────────────────────────────────────────

const PLAN_LIMITS: Record<string, { max_configs: number; max_agents_per_config: number }> = {
  free: { max_configs: 5, max_agents_per_config: 50000 },
  pro: { max_configs: 50, max_agents_per_config: 100000 },
  enterprise: { max_configs: 1000, max_agents_per_config: 500000 },
};

const VALID_PLANS = Object.keys(PLAN_LIMITS);

// ─── Tenant Handlers ────────────────────────────────────────────────

async function handleCreateTenant(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<{ name: string; plan?: string }>(request);
  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return jsonError("name is required", 400);
  }
  if (body.name.length > 255) {
    return jsonError("name must be 255 characters or fewer", 400);
  }

  const plan = body.plan ?? "free";
  if (!VALID_PLANS.includes(plan)) {
    return jsonError(`Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}`, 400);
  }

  const limits = PLAN_LIMITS[plan]!;

  const id = crypto.randomUUID();
  await env.FP_DB.prepare(
    `INSERT INTO tenants (id, name, plan, max_configs, max_agents_per_config) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, body.name.trim(), plan, limits.max_configs, limits.max_agents_per_config)
    .run();

  return Response.json({ id, name: body.name.trim(), plan }, { status: 201 });
}

async function handleListTenants(env: Env): Promise<Response> {
  const result = await env.FP_DB.prepare(`SELECT * FROM tenants ORDER BY created_at DESC`).all();
  return Response.json({ tenants: result.results });
}

async function handleGetTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);
  return Response.json(tenant);
}

async function handleUpdateTenant(request: Request, env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);

  const body = await parseJsonBody<{ name?: string; plan?: string }>(request);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name && typeof body.name === "string" && body.name.trim().length > 0) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.plan) {
    if (!VALID_PLANS.includes(body.plan)) {
      return jsonError(`Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}`, 400);
    }
    updates.push("plan = ?");
    values.push(body.plan);
    const limits = PLAN_LIMITS[body.plan]!;
    updates.push("max_configs = ?");
    values.push(limits.max_configs);
    updates.push("max_agents_per_config = ?");
    values.push(limits.max_agents_per_config);
  }

  if (updates.length === 0) {
    return jsonError("No fields to update", 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(tenantId);

  await env.FP_DB.prepare(`UPDATE tenants SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  return Response.json(updated);
}

async function handleDeleteTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);

  const configs = await env.FP_DB.prepare(
    `SELECT COUNT(*) as count FROM configurations WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{ count: number }>();
  if (configs && configs.count > 0) {
    return jsonError(
      `Cannot delete tenant with ${configs.count} configuration(s). Delete configurations first.`,
      409,
    );
  }

  await env.FP_DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(tenantId).run();
  return new Response(null, { status: 204 });
}

async function handleListConfigurations(env: Env, tenantId: string): Promise<Response> {
  const result = await env.FP_DB.prepare(
    `SELECT * FROM configurations WHERE tenant_id = ? ORDER BY created_at DESC`,
  )
    .bind(tenantId)
    .all();
  return Response.json({ configurations: result.results });
}

// ─── Tenant Users ───────────────────────────────────────────────────

async function handleListTenantUsers(env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare(`SELECT id FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);

  const result = await env.FP_DB.prepare(
    `SELECT id, email, display_name, role, created_at FROM users WHERE tenant_id = ? ORDER BY created_at DESC`,
  )
    .bind(tenantId)
    .all();
  return Response.json({ users: result.results });
}

// ─── Health Check ───────────────────────────────────────────────────

async function handleHealthCheck(env: Env): Promise<Response> {
  const checks: Record<string, { status: string; latency_ms?: number; error?: string }> = {};

  // D1 health
  const d1Start = Date.now();
  try {
    await env.FP_DB.prepare("SELECT 1").first();
    checks["d1"] = { status: "healthy", latency_ms: Date.now() - d1Start };
  } catch (e) {
    checks["d1"] = {
      status: "unhealthy",
      latency_ms: Date.now() - d1Start,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  // R2 health
  const r2Start = Date.now();
  try {
    await env.FP_CONFIGS.list({ limit: 1 });
    checks["r2"] = { status: "healthy", latency_ms: Date.now() - r2Start };
  } catch (e) {
    checks["r2"] = {
      status: "unhealthy",
      latency_ms: Date.now() - r2Start,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  // Durable Objects — check namespace is bound
  try {
    if (env.CONFIG_DO) {
      checks["durable_objects"] = { status: "healthy" };
    } else {
      checks["durable_objects"] = { status: "unhealthy", error: "Namespace not bound" };
    }
  } catch (e) {
    checks["durable_objects"] = {
      status: "unhealthy",
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  // Queue — check binding exists
  try {
    if (env.FP_EVENTS) {
      checks["queue"] = { status: "healthy" };
    } else {
      checks["queue"] = { status: "unavailable", error: "Queue not bound" };
    }
  } catch (e) {
    checks["queue"] = {
      status: "unhealthy",
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  const overall = Object.values(checks).every((c) => c.status === "healthy")
    ? "healthy"
    : "degraded";
  return Response.json({ status: overall, checks, timestamp: new Date().toISOString() });
}

// ─── Plans ──────────────────────────────────────────────────────────

async function handleListPlans(env: Env): Promise<Response> {
  const planDefs = Object.entries(PLAN_LIMITS).map(([name, v]) => ({ name, ...v }));

  const counts = await env.FP_DB.prepare(
    `SELECT plan, COUNT(*) as count FROM tenants GROUP BY plan`,
  ).all<{ plan: string; count: number }>();

  const countMap: Record<string, number> = {};
  for (const row of counts.results) {
    countMap[row.plan] = row.count;
  }

  const plans = planDefs.map((p) => ({
    ...p,
    tenant_count: countMap[p.name] ?? 0,
  }));

  return Response.json({ plans });
}

// ─── Admin Overview ─────────────────────────────────────────────────

async function handleAdminOverview(env: Env): Promise<Response> {
  const results = await env.FP_DB.batch([
    env.FP_DB.prepare("SELECT COUNT(*) as count FROM tenants"),
    env.FP_DB.prepare("SELECT COUNT(*) as count FROM configurations"),
    env.FP_DB.prepare("SELECT COUNT(*) as count FROM enrollment_tokens WHERE revoked_at IS NULL"),
    env.FP_DB.prepare("SELECT COUNT(*) as count FROM users"),
  ]);

  function getCount(idx: number): number {
    const row = results[idx]?.results?.[0] as { count?: number } | undefined;
    return row?.count ?? 0;
  }

  return Response.json({
    total_tenants: getCount(0),
    total_configurations: getCount(1),
    total_active_tokens: getCount(2),
    total_users: getCount(3),
  });
}
