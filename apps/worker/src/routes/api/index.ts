// API route handlers for FleetPlane

import type { Env } from "../../index.js";
import { uploadConfigVersion, getConfigContent } from "../../config-store.js";
import { generateEnrollmentToken, hashEnrollmentToken } from "@o11yfleet/core/auth";

// Simple router
export async function handleApiRequest(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // POST /api/tenants
  if (path === "/api/tenants" && method === "POST") {
    return handleCreateTenant(request, env);
  }

  // GET /api/tenants/:id/configurations
  const tenantConfigsMatch = path.match(/^\/api\/tenants\/([^/]+)\/configurations$/);
  if (tenantConfigsMatch && method === "GET") {
    return handleListConfigurations(env, tenantConfigsMatch[1]);
  }

  // POST /api/configurations
  if (path === "/api/configurations" && method === "POST") {
    return handleCreateConfiguration(request, env);
  }

  // GET /api/configurations/:id
  const configMatch = path.match(/^\/api\/configurations\/([^/]+)$/);
  if (configMatch && method === "GET") {
    return handleGetConfiguration(env, configMatch[1]);
  }

  // POST /api/configurations/:id/versions
  const versionsMatch = path.match(/^\/api\/configurations\/([^/]+)\/versions$/);
  if (versionsMatch && method === "POST") {
    return handleUploadVersion(request, env, versionsMatch[1]);
  }

  // POST /api/configurations/:id/enrollment-token
  const enrollMatch = path.match(/^\/api\/configurations\/([^/]+)\/enrollment-token$/);
  if (enrollMatch && method === "POST") {
    return handleCreateEnrollmentToken(request, env, enrollMatch[1]);
  }

  // GET /api/configurations/:id/agents
  const agentsMatch = path.match(/^\/api\/configurations\/([^/]+)\/agents$/);
  if (agentsMatch && method === "GET") {
    return handleListAgents(env, agentsMatch[1]);
  }

  // GET /api/configurations/:id/stats
  const statsMatch = path.match(/^\/api\/configurations\/([^/]+)\/stats$/);
  if (statsMatch && method === "GET") {
    return handleGetStats(env, statsMatch[1]);
  }

  // POST /api/configurations/:id/rollout
  const rolloutMatch = path.match(/^\/api\/configurations\/([^/]+)\/rollout$/);
  if (rolloutMatch && method === "POST") {
    return handleRollout(request, env, rolloutMatch[1]);
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

// POST /api/tenants
async function handleCreateTenant(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ name: string; plan?: string }>();
  if (!body.name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const plan = body.plan ?? "free";
  const maxConfigs = plan === "enterprise" ? 1000 : plan === "pro" ? 50 : 5;
  const maxAgents = plan === "enterprise" ? 500000 : plan === "pro" ? 100000 : 50000;

  await env.FP_DB.prepare(
    `INSERT INTO tenants (id, name, plan, max_configs, max_agents_per_config) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, body.name, plan, maxConfigs, maxAgents)
    .run();

  return Response.json({ id, name: body.name, plan }, { status: 201 });
}

// GET /api/tenants/:id/configurations
async function handleListConfigurations(env: Env, tenantId: string): Promise<Response> {
  const result = await env.FP_DB.prepare(
    `SELECT * FROM configurations WHERE tenant_id = ? ORDER BY created_at DESC`,
  )
    .bind(tenantId)
    .all();

  return Response.json({ configurations: result.results });
}

// POST /api/configurations
async function handleCreateConfiguration(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{
    tenant_id: string;
    name: string;
    description?: string;
  }>();
  if (!body.tenant_id || !body.name) {
    return Response.json({ error: "tenant_id and name are required" }, { status: 400 });
  }

  // Check tenant exists
  const tenant = await env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(body.tenant_id)
    .first();
  if (!tenant) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  // Check config limit
  const countResult = await env.FP_DB.prepare(
    `SELECT COUNT(*) as count FROM configurations WHERE tenant_id = ?`,
  )
    .bind(body.tenant_id)
    .first<{ count: number }>();
  if (countResult && countResult.count >= (tenant.max_configs as number)) {
    return Response.json(
      { error: `Configuration limit reached (${tenant.max_configs})` },
      { status: 429 },
    );
  }

  const id = crypto.randomUUID();
  await env.FP_DB.prepare(
    `INSERT INTO configurations (id, tenant_id, name, description) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, body.tenant_id, body.name, body.description ?? null)
    .run();

  return Response.json({ id, tenant_id: body.tenant_id, name: body.name }, { status: 201 });
}

// GET /api/configurations/:id
async function handleGetConfiguration(env: Env, configId: string): Promise<Response> {
  const config = await env.FP_DB.prepare(`SELECT * FROM configurations WHERE id = ?`)
    .bind(configId)
    .first();
  if (!config) {
    return Response.json({ error: "Configuration not found" }, { status: 404 });
  }
  return Response.json(config);
}

// POST /api/configurations/:id/versions
async function handleUploadVersion(
  request: Request,
  env: Env,
  configId: string,
): Promise<Response> {
  const config = await env.FP_DB.prepare(
    `SELECT c.*, t.id as t_id FROM configurations c JOIN tenants t ON c.tenant_id = t.id WHERE c.id = ?`,
  )
    .bind(configId)
    .first();
  if (!config) {
    return Response.json({ error: "Configuration not found" }, { status: 404 });
  }

  const yaml = await request.text();
  if (!yaml || yaml.length === 0) {
    return Response.json({ error: "Request body (YAML) is required" }, { status: 400 });
  }

  // 256 KB limit
  if (yaml.length > 256 * 1024) {
    return Response.json({ error: "Config too large (max 256KB)" }, { status: 413 });
  }

  const result = await uploadConfigVersion(
    env,
    config.tenant_id as string,
    configId,
    yaml,
  );

  return Response.json(result, { status: 201 });
}

// POST /api/configurations/:id/enrollment-token
async function handleCreateEnrollmentToken(
  request: Request,
  env: Env,
  configId: string,
): Promise<Response> {
  const config = await env.FP_DB.prepare(`SELECT * FROM configurations WHERE id = ?`)
    .bind(configId)
    .first();
  if (!config) {
    return Response.json({ error: "Configuration not found" }, { status: 404 });
  }

  const body = await request.json<{ label?: string; expires_in_hours?: number }>().catch(
    () => ({} as { label?: string; expires_in_hours?: number }),
  );

  const rawToken = generateEnrollmentToken();
  const tokenHash = await hashEnrollmentToken(rawToken);
  const id = crypto.randomUUID();

  let expiresAt: string | null = null;
  if (body.expires_in_hours) {
    expiresAt = new Date(Date.now() + body.expires_in_hours * 3600 * 1000).toISOString();
  }

  await env.FP_DB.prepare(
    `INSERT INTO enrollment_tokens (id, config_id, tenant_id, token_hash, label, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      configId,
      config.tenant_id as string,
      tokenHash,
      body.label ?? null,
      expiresAt,
    )
    .run();

  // Return the raw token (only shown once)
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

// GET /api/configurations/:id/agents
async function handleListAgents(env: Env, configId: string): Promise<Response> {
  const result = await env.FP_DB.prepare(
    `SELECT * FROM agent_summaries WHERE config_id = ? ORDER BY last_seen_at DESC`,
  )
    .bind(configId)
    .all();

  return Response.json({ agents: result.results });
}

// GET /api/configurations/:id/stats
async function handleGetStats(env: Env, configId: string): Promise<Response> {
  const doName = await getDoNameForConfig(env, configId);
  if (!doName) {
    return Response.json({ error: "Configuration not found" }, { status: 404 });
  }

  const doId = env.CONFIG_DO.idFromName(doName);
  const stub = env.CONFIG_DO.get(doId);
  const response = await stub.fetch(new Request("http://internal/stats"));
  return response;
}

// POST /api/configurations/:id/rollout
async function handleRollout(
  request: Request,
  env: Env,
  configId: string,
): Promise<Response> {
  const config = await env.FP_DB.prepare(`SELECT * FROM configurations WHERE id = ?`)
    .bind(configId)
    .first();
  if (!config) {
    return Response.json({ error: "Configuration not found" }, { status: 404 });
  }

  if (!config.current_config_hash) {
    return Response.json({ error: "No config version uploaded yet" }, { status: 400 });
  }

  const doName = `${config.tenant_id}:${configId}`;
  const doId = env.CONFIG_DO.idFromName(doName);
  const stub = env.CONFIG_DO.get(doId);

  const body = JSON.stringify({ config_hash: config.current_config_hash });
  const response = await stub.fetch(
    new Request("http://internal/command/set-desired-config", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    }),
  );

  return response;
}

async function getDoNameForConfig(env: Env, configId: string): Promise<string | null> {
  const config = await env.FP_DB.prepare(`SELECT tenant_id FROM configurations WHERE id = ?`)
    .bind(configId)
    .first<{ tenant_id: string }>();
  if (!config) return null;
  return `${config.tenant_id}:${configId}`;
}
