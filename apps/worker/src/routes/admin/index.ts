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

export async function handleAdminRequest(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
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

async function routeAdminRequest(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
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

  return jsonError("Not found", 404);
}

// ─── Tenant Handlers ────────────────────────────────────────────────

async function handleCreateTenant(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<{ name: string; plan?: string }>(request);
  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return jsonError("name is required", 400);
  }
  if (body.name.length > 255) {
    return jsonError("name must be 255 characters or fewer", 400);
  }

  const validPlans = ["free", "pro", "enterprise"];
  const plan = body.plan ?? "free";
  if (!validPlans.includes(plan)) {
    return jsonError(`Invalid plan. Must be one of: ${validPlans.join(", ")}`, 400);
  }

  const maxConfigs = plan === "enterprise" ? 1000 : plan === "pro" ? 50 : 5;
  const maxAgents = plan === "enterprise" ? 500000 : plan === "pro" ? 100000 : 50000;

  const id = crypto.randomUUID();
  await env.FP_DB.prepare(
    `INSERT INTO tenants (id, name, plan, max_configs, max_agents_per_config) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, body.name.trim(), plan, maxConfigs, maxAgents)
    .run();

  return Response.json({ id, name: body.name.trim(), plan }, { status: 201 });
}

async function handleListTenants(env: Env): Promise<Response> {
  const result = await env.FP_DB.prepare(
    `SELECT * FROM tenants ORDER BY created_at DESC`,
  ).all();
  return Response.json({ tenants: result.results });
}

async function handleGetTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);
  return Response.json(tenant);
}

async function handleUpdateTenant(
  request: Request,
  env: Env,
  tenantId: string,
): Promise<Response> {
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
    const validPlans = ["free", "pro", "enterprise"];
    if (!validPlans.includes(body.plan)) {
      return jsonError(`Invalid plan. Must be one of: ${validPlans.join(", ")}`, 400);
    }
    updates.push("plan = ?");
    values.push(body.plan);
  }

  if (updates.length === 0) {
    return jsonError("No fields to update", 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(tenantId);

  await env.FP_DB.prepare(
    `UPDATE tenants SET ${updates.join(", ")} WHERE id = ?`,
  )
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

// ─── Admin Overview ─────────────────────────────────────────────────

async function handleAdminOverview(env: Env): Promise<Response> {
  const tenants = await env.FP_DB.prepare("SELECT COUNT(*) as count FROM tenants").first<{ count: number }>();
  const configs = await env.FP_DB.prepare("SELECT COUNT(*) as count FROM configurations").first<{ count: number }>();
  const tokens = await env.FP_DB.prepare("SELECT COUNT(*) as count FROM enrollment_tokens WHERE revoked_at IS NULL").first<{ count: number }>();
  const users = await env.FP_DB.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>();

  return Response.json({
    total_tenants: tenants?.count ?? 0,
    total_configurations: configs?.count ?? 0,
    total_active_tokens: tokens?.count ?? 0,
    total_users: users?.count ?? 0,
  });
}
