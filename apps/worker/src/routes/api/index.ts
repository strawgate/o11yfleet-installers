// Legacy API route handlers for FleetPlane — DEPRECATED, prefer /api/v1/* routes.
// These routes pre-date tenant-scoped auth. Config-by-ID endpoints now validate
// tenant ownership when a tenantId is available (session auth). Bearer-only callers
// (API_SECRET) bypass tenant checks — treat as admin-level access.
// Consistent error contract: { error: string } with appropriate HTTP status

import type { Env } from "../../index.js";
import {
  deleteConfigContentIfUnreferenced,
  uploadConfigVersion,
  validateYaml,
} from "../../config-store.js";
import { generateEnrollmentToken, hashEnrollmentToken } from "@o11yfleet/core/auth";
import { VALID_PLANS, getPlanLimits } from "../../shared/plans.js";

// ─── Error helpers ──────────────────────────────────────────────────

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function parseJsonBody<T>(request: Request): Promise<T> {
  return request.json<T>().catch(() => {
    throw new ApiError("Invalid JSON in request body", 400);
  });
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// ─── Router ─────────────────────────────────────────────────────────

/**
 * @deprecated Use /api/v1/* tenant-scoped routes instead.
 * tenantId is passed from session auth when available to prevent IDOR on config endpoints.
 */
export async function handleApiRequest(
  request: Request,
  env: Env,
  url: URL,
  tenantId?: string | null,
): Promise<Response> {
  try {
    return await routeRequest(request, env, url, tenantId ?? null);
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonError(err.message, err.status);
    }
    // Unexpected error — don't leak internals
    console.error("API error:", err);
    return jsonError("Internal server error", 500);
  }
}

async function routeRequest(
  request: Request,
  env: Env,
  url: URL,
  tenantId: string | null,
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // ─── Tenants ────────────────────────────────────────────────

  // POST /api/tenants
  if (path === "/api/tenants" && method === "POST") {
    return handleCreateTenant(request, env);
  }

  // GET /api/tenants
  if (path === "/api/tenants" && method === "GET") {
    return handleListTenants(env);
  }

  // Tenant by ID routes
  const tenantIdMatch = path.match(/^\/api\/tenants\/([^/]+)$/);
  if (tenantIdMatch) {
    if (method === "GET") return handleGetTenant(env, tenantIdMatch[1]!);
    if (method === "PUT") return handleUpdateTenant(request, env, tenantIdMatch[1]!);
    if (method === "DELETE") return handleDeleteTenant(env, tenantIdMatch[1]!);
  }

  // GET /api/tenants/:id/configurations
  const tenantConfigsMatch = path.match(/^\/api\/tenants\/([^/]+)\/configurations$/);
  if (tenantConfigsMatch && method === "GET") {
    return handleListConfigurations(env, tenantConfigsMatch[1]!);
  }

  // ─── Configurations ────────────────────────────────────────

  // POST /api/configurations
  if (path === "/api/configurations" && method === "POST") {
    return handleCreateConfiguration(request, env);
  }

  // Configuration by ID routes — tenant ownership validated when tenantId is available
  const configMatch = path.match(/^\/api\/configurations\/([^/]+)$/);
  if (configMatch) {
    if (method === "GET") return handleGetConfiguration(env, configMatch[1]!, tenantId);
    if (method === "PUT") return handleUpdateConfiguration(request, env, configMatch[1]!, tenantId);
    if (method === "DELETE") return handleDeleteConfiguration(env, configMatch[1]!, tenantId);
  }

  // POST /api/configurations/:id/versions
  const versionsPostMatch = path.match(/^\/api\/configurations\/([^/]+)\/versions$/);
  if (versionsPostMatch && method === "POST") {
    return handleUploadVersion(request, env, versionsPostMatch[1]!, tenantId);
  }

  // GET /api/configurations/:id/versions
  const versionsGetMatch = path.match(/^\/api\/configurations\/([^/]+)\/versions$/);
  if (versionsGetMatch && method === "GET") {
    return handleListVersions(env, versionsGetMatch[1]!, tenantId);
  }

  // ─── Enrollment Tokens ─────────────────────────────────────

  // POST /api/configurations/:id/enrollment-token
  const enrollMatch = path.match(/^\/api\/configurations\/([^/]+)\/enrollment-token$/);
  if (enrollMatch && method === "POST") {
    return handleCreateEnrollmentToken(request, env, enrollMatch[1]!, tenantId);
  }

  // GET /api/configurations/:id/enrollment-tokens
  const tokensListMatch = path.match(/^\/api\/configurations\/([^/]+)\/enrollment-tokens$/);
  if (tokensListMatch && method === "GET") {
    return handleListEnrollmentTokens(env, tokensListMatch[1]!, tenantId);
  }

  // DELETE /api/configurations/:id/enrollment-tokens/:tokenId
  const tokenDeleteMatch = path.match(
    /^\/api\/configurations\/([^/]+)\/enrollment-tokens\/([^/]+)$/,
  );
  if (tokenDeleteMatch && method === "DELETE") {
    return handleRevokeEnrollmentToken(env, tokenDeleteMatch[1]!, tokenDeleteMatch[2]!, tenantId);
  }

  // ─── Agents & Stats ────────────────────────────────────────

  // GET /api/configurations/:id/agents
  const agentsMatch = path.match(/^\/api\/configurations\/([^/]+)\/agents$/);
  if (agentsMatch && method === "GET") {
    return handleListAgents(env, agentsMatch[1]!, tenantId);
  }

  // GET /api/configurations/:id/stats
  const statsMatch = path.match(/^\/api\/configurations\/([^/]+)\/stats$/);
  if (statsMatch && method === "GET") {
    return handleGetStats(env, statsMatch[1]!, tenantId);
  }

  // ─── Rollout ───────────────────────────────────────────────

  // POST /api/configurations/:id/rollout
  const rolloutMatch = path.match(/^\/api\/configurations\/([^/]+)\/rollout$/);
  if (rolloutMatch && method === "POST") {
    return handleRollout(request, env, rolloutMatch[1]!, tenantId);
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

  const plan = body.plan ?? "free";
  if (!VALID_PLANS.includes(plan)) {
    return jsonError(`Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}`, 400);
  }

  const { max_configs, max_agents_per_config } = getPlanLimits(plan);

  const id = crypto.randomUUID();
  await env.FP_DB.prepare(
    `INSERT INTO tenants (id, name, plan, max_configs, max_agents_per_config) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, body.name.trim(), plan, max_configs, max_agents_per_config)
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

  const body = await parseJsonBody<{ name?: string }>(request);
  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return jsonError("name is required", 400);
  }

  await env.FP_DB.prepare(`UPDATE tenants SET name = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(body.name.trim(), tenantId)
    .run();

  return Response.json({ id: tenantId, name: body.name.trim(), plan: tenant["plan"] });
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

// ─── Configuration Handlers ─────────────────────────────────────────

async function handleListConfigurations(env: Env, tenantId: string): Promise<Response> {
  const result = await env.FP_DB.prepare(
    `SELECT * FROM configurations WHERE tenant_id = ? ORDER BY created_at DESC`,
  )
    .bind(tenantId)
    .all();
  return Response.json({ configurations: result.results });
}

async function handleCreateConfiguration(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<{
    tenant_id: string;
    name: string;
    description?: string;
  }>(request);
  const trimmedName = body.name?.trim();
  if (!body.tenant_id || !trimmedName) {
    return jsonError("tenant_id and name are required", 400);
  }
  if (trimmedName.length > 255) {
    return jsonError("name must be 255 characters or fewer", 400);
  }
  if (body.description && body.description.length > 1024) {
    return jsonError("description must be 1024 characters or fewer", 400);
  }

  const id = crypto.randomUUID();
  const insertResult = await env.FP_DB.prepare(
    `INSERT INTO configurations (id, tenant_id, name, description)
     SELECT ?, t.id, ?, ?
     FROM tenants t
     WHERE t.id = ?
       AND (
         SELECT COUNT(*) FROM configurations c WHERE c.tenant_id = t.id
       ) < t.max_configs`,
  )
    .bind(id, trimmedName, body.description ?? null, body.tenant_id)
    .run();

  if ((insertResult.meta.changes ?? 0) === 0) {
    const tenant = await env.FP_DB.prepare(`SELECT max_configs FROM tenants WHERE id = ?`)
      .bind(body.tenant_id)
      .first<{ max_configs: number }>();
    if (!tenant) return jsonError("Tenant not found", 404);
    return jsonError(`Configuration limit reached (${tenant.max_configs})`, 429);
  }

  return Response.json({ id, tenant_id: body.tenant_id, name: trimmedName }, { status: 201 });
}

async function handleGetConfiguration(
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Response> {
  const config = await getConfigWithOwnershipCheck(env, configId, tenantId);
  if (!config) return jsonError("Configuration not found", 404);
  return Response.json(config);
}

async function handleUpdateConfiguration(
  request: Request,
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Response> {
  const config = await getConfigWithOwnershipCheck(env, configId, tenantId);
  if (!config) return jsonError("Configuration not found", 404);

  const body = await parseJsonBody<{ name?: string; description?: string }>(request);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name && typeof body.name === "string") {
    updates.push("name = ?");
    values.push(body.name);
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    values.push(body.description);
  }

  if (updates.length === 0) {
    return jsonError("No fields to update", 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(configId);

  await env.FP_DB.prepare(`UPDATE configurations SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await env.FP_DB.prepare(`SELECT * FROM configurations WHERE id = ?`)
    .bind(configId)
    .first();
  return Response.json(updated);
}

async function handleDeleteConfiguration(
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Response> {
  const config = await getConfigWithOwnershipCheck(env, configId, tenantId);
  if (!config) return jsonError("Configuration not found", 404);

  const versions = await env.FP_DB.prepare(
    `SELECT DISTINCT r2_key FROM config_versions WHERE config_id = ?`,
  )
    .bind(configId)
    .all<{ r2_key: string }>();

  await env.FP_DB.batch([
    env.FP_DB.prepare(`DELETE FROM enrollment_tokens WHERE config_id = ?`).bind(configId),
    env.FP_DB.prepare(`DELETE FROM config_versions WHERE config_id = ?`).bind(configId),
    env.FP_DB.prepare(`DELETE FROM configurations WHERE id = ?`).bind(configId),
  ]);

  for (const { r2_key: r2Key } of versions.results) {
    await deleteConfigContentIfUnreferenced(env, r2Key);
  }

  return new Response(null, { status: 204 });
}

// ─── Config Version Handlers ────────────────────────────────────────

async function handleUploadVersion(
  request: Request,
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Response> {
  const config = tenantId
    ? await env.FP_DB.prepare(
        `SELECT c.*, t.id as t_id FROM configurations c JOIN tenants t ON c.tenant_id = t.id WHERE c.id = ? AND c.tenant_id = ?`,
      )
        .bind(configId, tenantId)
        .first()
    : await env.FP_DB.prepare(
        `SELECT c.*, t.id as t_id FROM configurations c JOIN tenants t ON c.tenant_id = t.id WHERE c.id = ?`,
      )
        .bind(configId)
        .first();
  if (!config) return jsonError("Configuration not found", 404);

  const yaml = await request.text();
  if (!yaml || yaml.length === 0) {
    return jsonError("Request body (YAML) is required", 400);
  }

  if (yaml.length > 256 * 1024) {
    return jsonError("Config too large (max 256KB)", 413);
  }

  // Validate YAML syntax
  const yamlError = validateYaml(yaml);
  if (yamlError) {
    return jsonError(`Invalid YAML: ${yamlError}`, 400);
  }

  const result = await uploadConfigVersion(env, config["tenant_id"] as string, configId, yaml);

  return Response.json(result, { status: 201 });
}

async function handleListVersions(
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Response> {
  const config = await getConfigWithOwnershipCheck(env, configId, tenantId);
  if (!config) return jsonError("Configuration not found", 404);

  const result = await env.FP_DB.prepare(
    `SELECT id, config_id, config_hash, r2_key, size_bytes, created_by, created_at
     FROM config_versions WHERE config_id = ? ORDER BY created_at DESC`,
  )
    .bind(configId)
    .all();

  return Response.json({
    versions: result.results,
    current_config_hash: config["current_config_hash"],
  });
}

// ─── Enrollment Token Handlers ──────────────────────────────────────

async function handleCreateEnrollmentToken(
  request: Request,
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Response> {
  const config = await getConfigWithOwnershipCheck(env, configId, tenantId);
  if (!config) return jsonError("Configuration not found", 404);

  const body = await parseJsonBody<{ label?: string; expires_in_hours?: number }>(request);

  if (body.label && body.label.length > 255) {
    return jsonError("Label must be 255 characters or fewer", 400);
  }

  const rawToken = generateEnrollmentToken();
  const tokenHash = await hashEnrollmentToken(rawToken);
  const id = crypto.randomUUID();

  let expiresAt: string | null = null;
  if (body.expires_in_hours) {
    if (typeof body.expires_in_hours !== "number" || body.expires_in_hours <= 0) {
      return jsonError("expires_in_hours must be a positive number", 400);
    }
    if (body.expires_in_hours > 8760) {
      return jsonError("expires_in_hours must be 8760 (1 year) or less", 400);
    }
    expiresAt = new Date(Date.now() + body.expires_in_hours * 3600 * 1000).toISOString();
  }

  await env.FP_DB.prepare(
    `INSERT INTO enrollment_tokens (id, config_id, tenant_id, token_hash, label, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, configId, config["tenant_id"] as string, tokenHash, body.label ?? null, expiresAt)
    .run();

  return Response.json(
    {
      id,
      token: rawToken,
      config_id: configId,
      label: body.label ?? null,
      expires_at: expiresAt,
    },
    { status: 201 },
  );
}

async function handleListEnrollmentTokens(
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Response> {
  const config = await getConfigWithOwnershipCheck(env, configId, tenantId);
  if (!config) return jsonError("Configuration not found", 404);

  const result = await env.FP_DB.prepare(
    `SELECT id, config_id, tenant_id, label, expires_at, revoked_at, created_at
     FROM enrollment_tokens WHERE config_id = ? ORDER BY created_at DESC`,
  )
    .bind(configId)
    .all();

  return Response.json({ tokens: result.results });
}

async function handleRevokeEnrollmentToken(
  env: Env,
  configId: string,
  tokenId: string,
  tenantId: string | null,
): Promise<Response> {
  // Verify config ownership before operating on its tokens
  const config = await getConfigWithOwnershipCheck(env, configId, tenantId);
  if (!config) return jsonError("Configuration not found", 404);

  const token = await env.FP_DB.prepare(
    `SELECT * FROM enrollment_tokens WHERE id = ? AND config_id = ?`,
  )
    .bind(tokenId, configId)
    .first();
  if (!token) return jsonError("Enrollment token not found", 404);

  if (token["revoked_at"]) {
    return jsonError("Token is already revoked", 409);
  }

  await env.FP_DB.prepare(`UPDATE enrollment_tokens SET revoked_at = datetime('now') WHERE id = ?`)
    .bind(tokenId)
    .run();

  return Response.json({ id: tokenId, revoked: true });
}

// ─── Agent & Stats Handlers ─────────────────────────────────────────

async function handleListAgents(
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Response> {
  const doName = await getDoNameForConfig(env, configId, tenantId);
  if (!doName) return jsonError("Configuration not found", 404);

  const doId = env.CONFIG_DO.idFromName(doName);
  const stub = env.CONFIG_DO.get(doId);
  const response = await stub.fetch(new Request("http://internal/agents"));
  return response;
}

async function handleGetStats(
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Response> {
  const doName = await getDoNameForConfig(env, configId, tenantId);
  if (!doName) return jsonError("Configuration not found", 404);

  const doId = env.CONFIG_DO.idFromName(doName);
  const stub = env.CONFIG_DO.get(doId);
  const response = await stub.fetch(new Request("http://internal/stats"));
  return response;
}

// ─── Rollout Handler ────────────────────────────────────────────────

async function handleRollout(
  request: Request,
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Response> {
  const config = await getConfigWithOwnershipCheck(env, configId, tenantId);
  if (!config) return jsonError("Configuration not found", 404);

  if (!config["current_config_hash"]) {
    return jsonError("No config version uploaded yet", 400);
  }

  const doName = `${config["tenant_id"]}:${configId}`;
  const doId = env.CONFIG_DO.idFromName(doName);
  const stub = env.CONFIG_DO.get(doId);

  const r2Key = `configs/sha256/${config["current_config_hash"]}.yaml`;
  const r2Obj = await env.FP_CONFIGS.get(r2Key);
  const configContent = r2Obj ? await r2Obj.text() : null;

  const body = JSON.stringify({
    config_hash: config["current_config_hash"],
    config_content: configContent,
  });
  const response = await stub.fetch(
    new Request("http://internal/command/set-desired-config", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    }),
  );

  return response;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Fetch a config by ID, optionally validating tenant ownership (IDOR prevention). */
async function getConfigWithOwnershipCheck(
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<Record<string, unknown> | null> {
  if (tenantId) {
    return env.FP_DB.prepare(`SELECT * FROM configurations WHERE id = ? AND tenant_id = ?`)
      .bind(configId, tenantId)
      .first();
  }
  // IDOR risk: no tenant scoping when called via Bearer-only auth (admin-level)
  return env.FP_DB.prepare(`SELECT * FROM configurations WHERE id = ?`).bind(configId).first();
}

async function getDoNameForConfig(
  env: Env,
  configId: string,
  tenantId: string | null,
): Promise<string | null> {
  if (tenantId) {
    const config = await env.FP_DB.prepare(
      `SELECT tenant_id FROM configurations WHERE id = ? AND tenant_id = ?`,
    )
      .bind(configId, tenantId)
      .first<{ tenant_id: string }>();
    if (!config) return null;
    return `${config.tenant_id}:${configId}`;
  }
  const config = await env.FP_DB.prepare(`SELECT tenant_id FROM configurations WHERE id = ?`)
    .bind(configId)
    .first<{ tenant_id: string }>();
  if (!config) return null;
  return `${config.tenant_id}:${configId}`;
}
