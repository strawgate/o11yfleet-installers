// Tenant-scoped API routes — user portal operations
// All operations are scoped to a single tenant via X-Tenant-Id header (stub auth)

import type { Env } from "../../index.js";
import { uploadConfigVersion, validateYaml } from "../../config-store.js";
import { generateEnrollmentToken, hashEnrollmentToken } from "@o11yfleet/core/auth";

// ─── Error helpers ──────────────────────────────────────────────────

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function parseJsonBody<T>(request: Request): Promise<T> {
  return request.json<T>().catch(() => {
    throw new V1ApiError("Invalid JSON in request body", 400);
  });
}

class V1ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// ─── Router ─────────────────────────────────────────────────────────

export async function handleV1Request(
  request: Request,
  env: Env,
  url: URL,
  tenantId: string,
): Promise<Response> {
  try {
    return await routeV1Request(request, env, url, tenantId);
  } catch (err) {
    if (err instanceof V1ApiError) {
      return jsonError(err.message, err.status);
    }
    console.error("V1 API error:", err);
    return jsonError("Internal server error", 500);
  }
}

async function routeV1Request(
  request: Request,
  env: Env,
  url: URL,
  tenantId: string,
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // ─── Tenant Info ────────────────────────────────────────────

  if (path === "/api/v1/tenant" && method === "GET") {
    return handleGetTenant(env, tenantId);
  }
  if (path === "/api/v1/tenant" && method === "PUT") {
    return handleUpdateTenant(request, env, tenantId);
  }

  // ─── Overview (aggregate stats) ────────────────────────────

  if (path === "/api/v1/overview" && method === "GET") {
    return handleGetOverview(env, tenantId);
  }

  // ─── Configurations ────────────────────────────────────────

  if (path === "/api/v1/configurations" && method === "GET") {
    return handleListConfigurations(env, tenantId);
  }
  if (path === "/api/v1/configurations" && method === "POST") {
    return handleCreateConfiguration(request, env, tenantId);
  }

  const configMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)$/);
  if (configMatch) {
    const configId = configMatch[1]!;
    if (method === "GET") return handleGetConfiguration(env, tenantId, configId);
    if (method === "PUT") return handleUpdateConfiguration(request, env, tenantId, configId);
    if (method === "DELETE") return handleDeleteConfiguration(env, tenantId, configId);
  }

  // POST /api/v1/configurations/:id/versions
  const versionsPostMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/versions$/);
  if (versionsPostMatch && method === "POST") {
    return handleUploadVersion(request, env, tenantId, versionsPostMatch[1]!);
  }

  // GET /api/v1/configurations/:id/versions
  const versionsGetMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/versions$/);
  if (versionsGetMatch && method === "GET") {
    return handleListVersions(env, tenantId, versionsGetMatch[1]!);
  }

  // ─── Enrollment Tokens ─────────────────────────────────────

  const enrollMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/enrollment-token$/);
  if (enrollMatch && method === "POST") {
    return handleCreateEnrollmentToken(request, env, tenantId, enrollMatch[1]!);
  }

  const tokensListMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/enrollment-tokens$/);
  if (tokensListMatch && method === "GET") {
    return handleListEnrollmentTokens(env, tenantId, tokensListMatch[1]!);
  }

  const tokenDeleteMatch = path.match(
    /^\/api\/v1\/configurations\/([^/]+)\/enrollment-tokens\/([^/]+)$/,
  );
  if (tokenDeleteMatch && method === "DELETE") {
    return handleRevokeEnrollmentToken(env, tenantId, tokenDeleteMatch[1]!, tokenDeleteMatch[2]!);
  }

  // ─── Agents & Stats (from DO) ──────────────────────────────

  const agentsMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/agents$/);
  if (agentsMatch && method === "GET") {
    return handleListAgents(env, tenantId, agentsMatch[1]!);
  }

  const agentDetailMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/agents\/([^/]+)$/);
  if (agentDetailMatch && method === "GET") {
    return handleGetAgent(env, tenantId, agentDetailMatch[1]!, agentDetailMatch[2]!);
  }

  const statsMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/stats$/);
  if (statsMatch && method === "GET") {
    return handleGetStats(env, tenantId, statsMatch[1]!);
  }

  // ─── Rollout ───────────────────────────────────────────────

  const rolloutMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/rollout$/);
  if (rolloutMatch && method === "POST") {
    return handleRollout(request, env, tenantId, rolloutMatch[1]!);
  }

  return jsonError("Not found", 404);
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Verify config belongs to tenant and return it */
async function getOwnedConfig(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Record<string, unknown> | null> {
  const config = await env.FP_DB.prepare(
    `SELECT * FROM configurations WHERE id = ? AND tenant_id = ?`,
  )
    .bind(configId, tenantId)
    .first();
  return config;
}

function getDoName(tenantId: string, configId: string): string {
  return `${tenantId}:${configId}`;
}

// ─── Tenant Handler ─────────────────────────────────────────────────

async function handleGetTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);
  return Response.json(tenant);
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

async function handleCreateConfiguration(
  request: Request,
  env: Env,
  tenantId: string,
): Promise<Response> {
  const body = await parseJsonBody<{ name: string; description?: string }>(request);
  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return jsonError("name is required", 400);
  }
  if (body.name.length > 255) {
    return jsonError("name must be 255 characters or fewer", 400);
  }

  const tenant = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);

  const countResult = await env.FP_DB.prepare(
    `SELECT COUNT(*) as count FROM configurations WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{ count: number }>();
  if (countResult && countResult.count >= (tenant["max_configs"] as number)) {
    return jsonError(`Configuration limit reached (${tenant["max_configs"]})`, 429);
  }

  const id = crypto.randomUUID();
  await env.FP_DB.prepare(
    `INSERT INTO configurations (id, tenant_id, name, description) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, tenantId, body.name.trim(), body.description ?? null)
    .run();

  return Response.json({ id, tenant_id: tenantId, name: body.name.trim() }, { status: 201 });
}

async function handleGetConfiguration(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  return Response.json(config);
}

async function handleUpdateConfiguration(
  request: Request,
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
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
  if (updates.length === 0) return jsonError("No fields to update", 400);

  updates.push("updated_at = datetime('now')");
  values.push(configId);
  values.push(tenantId);

  await env.FP_DB.prepare(
    `UPDATE configurations SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`,
  )
    .bind(...values)
    .run();

  const updated = await getOwnedConfig(env, tenantId, configId);
  return Response.json(updated);
}

async function handleDeleteConfiguration(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  await env.FP_DB.prepare(`DELETE FROM enrollment_tokens WHERE config_id = ?`)
    .bind(configId)
    .run();
  await env.FP_DB.prepare(`DELETE FROM config_versions WHERE config_id = ?`)
    .bind(configId)
    .run();
  await env.FP_DB.prepare(`DELETE FROM configurations WHERE id = ?`)
    .bind(configId)
    .run();

  return new Response(null, { status: 204 });
}

// ─── Config Version Handlers ────────────────────────────────────────

async function handleUploadVersion(
  request: Request,
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const yaml = await request.text();
  if (!yaml || yaml.length === 0) {
    return jsonError("Request body (YAML) is required", 400);
  }
  if (yaml.length > 256 * 1024) {
    return jsonError("Config too large (max 256KB)", 413);
  }

  const yamlError = validateYaml(yaml);
  if (yamlError) return jsonError(`Invalid YAML: ${yamlError}`, 400);

  const result = await uploadConfigVersion(env, tenantId, configId, yaml);
  return Response.json(result, { status: 201 });
}

async function handleListVersions(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
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
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
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
    .bind(id, configId, tenantId, tokenHash, body.label ?? null, expiresAt)
    .run();

  return Response.json(
    { id, token: rawToken, config_id: configId, label: body.label ?? null, expires_at: expiresAt },
    { status: 201 },
  );
}

async function handleListEnrollmentTokens(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
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
  tenantId: string,
  configId: string,
  tokenId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const token = await env.FP_DB.prepare(
    `SELECT * FROM enrollment_tokens WHERE id = ? AND config_id = ?`,
  )
    .bind(tokenId, configId)
    .first();
  if (!token) return jsonError("Enrollment token not found", 404);
  if (token["revoked_at"]) return jsonError("Token is already revoked", 409);

  await env.FP_DB.prepare(
    `UPDATE enrollment_tokens SET revoked_at = datetime('now') WHERE id = ?`,
  )
    .bind(tokenId)
    .run();

  return Response.json({ id: tokenId, revoked: true });
}

// ─── Agent & Stats Handlers (from DO) ───────────────────────────────

async function handleListAgents(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  return stub.fetch(new Request("http://internal/agents"));
}

async function handleGetStats(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  return stub.fetch(new Request("http://internal/stats"));
}

// ─── Rollout Handler ────────────────────────────────────────────────

async function handleRollout(
  _request: Request,
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  if (!config["current_config_hash"]) {
    return jsonError("No config version uploaded yet", 400);
  }

  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);

  const r2Key = `configs/sha256/${config["current_config_hash"]}.yaml`;
  const r2Obj = await env.FP_CONFIGS.get(r2Key);
  const configContent = r2Obj ? await r2Obj.text() : null;

  return stub.fetch(
    new Request("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({
        config_hash: config["current_config_hash"],
        config_content: configContent,
      }),
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ─── Overview (aggregate stats) ─────────────────────────────────────

async function handleGetOverview(env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!tenant) return jsonError("Tenant not found", 404);

  const configs = await env.FP_DB.prepare(
    "SELECT id, name, current_config_hash, created_at, updated_at FROM configurations WHERE tenant_id = ? ORDER BY created_at DESC",
  ).bind(tenantId).all();

  let totalAgents = 0;
  let connectedAgents = 0;
  let healthyAgents = 0;

  const configStats: Array<Record<string, unknown>> = [];
  for (const config of configs.results) {
    try {
      const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, config['id'] as string));
      const stub = env.CONFIG_DO.get(doId);
      const statsResp = await stub.fetch(new Request("http://internal/stats"));
      const stats = await statsResp.json() as Record<string, number>;
      totalAgents += stats['total'] ?? 0;
      connectedAgents += stats['connected'] ?? 0;
      healthyAgents += stats['healthy'] ?? 0;
      configStats.push({ ...config, stats });
    } catch {
      configStats.push({ ...config, stats: { total: 0, connected: 0, healthy: 0 } });
    }
  }

  return Response.json({
    tenant,
    total_agents: totalAgents,
    connected_agents: connectedAgents,
    healthy_agents: healthyAgents,
    configs_count: configs.results.length,
    configurations: configStats,
  });
}

// ─── Update Tenant ──────────────────────────────────────────────────

async function handleUpdateTenant(request: Request, env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!tenant) return jsonError("Tenant not found", 404);
  const body = await parseJsonBody<{ name?: string }>(request);
  if (body.name && typeof body.name === "string" && body.name.trim().length > 0) {
    await env.FP_DB.prepare("UPDATE tenants SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(body.name.trim(), tenantId).run();
  }
  const updated = await env.FP_DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  return Response.json(updated);
}

// ─── Agent Detail ───────────────────────────────────────────────────

async function handleGetAgent(env: Env, tenantId: string, configId: string, agentUid: string): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const agentsResp = await stub.fetch(new Request("http://internal/agents"));
  const data = await agentsResp.json() as { agents: Array<Record<string, unknown>> };
  const agent = data.agents.find((a) => a['instance_uid'] === agentUid);
  if (!agent) return jsonError("Agent not found", 404);
  return Response.json(agent);
}
