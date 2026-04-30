// Tenant-scoped API routes — user portal operations
// All operations are scoped to a single tenant via X-Tenant-Id header (stub auth)

import type { Env } from "../../index.js";
import {
  deleteConfigContentIfUnreferenced,
  uploadConfigVersion,
  validateYaml,
} from "../../config-store.js";
import { generateEnrollmentToken, hashEnrollmentToken } from "@o11yfleet/core/auth";
import {
  AiApiError,
  handleTenantChatRequest,
  handleTenantGuidanceRequest,
} from "../../ai/guidance.js";
import { jsonError, parseJsonBody, ApiError } from "../../shared/errors.js";

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
    if (err instanceof ApiError) {
      return jsonError(err.message, err.status);
    }
    if (err instanceof AiApiError) {
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
  if (path === "/api/v1/tenant" && method === "DELETE") {
    return handleDeleteTenant(env, tenantId);
  }

  // ─── Team ───────────────────────────────────────────────────

  if (path === "/api/v1/team" && method === "GET") {
    return handleGetTeam(env, tenantId);
  }

  // ─── Overview (aggregate stats) ────────────────────────────

  if (path === "/api/v1/overview" && method === "GET") {
    return handleGetOverview(env, tenantId);
  }

  // ─── AI Guidance ───────────────────────────────────────────

  if (path === "/api/v1/ai/guidance" && method === "POST") {
    return handleTenantGuidanceRequest(request, env, tenantId);
  }
  if (path === "/api/v1/ai/chat" && method === "POST") {
    return handleTenantChatRequest(request, env, tenantId);
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

  // GET /api/v1/configurations/:id/version-diff-latest-previous
  const versionDiffMatch = path.match(
    /^\/api\/v1\/configurations\/([^/]+)\/version-diff-latest-previous$/,
  );
  if (versionDiffMatch && method === "GET") {
    return handleLatestVersionDiff(env, tenantId, versionDiffMatch[1]!);
  }

  // GET /api/v1/configurations/:id/yaml — current YAML content from R2
  const yamlMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/yaml$/);
  if (yamlMatch && method === "GET") {
    return handleGetConfigYaml(env, tenantId, yamlMatch[1]!);
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

  const rolloutSummaryMatch = path.match(
    /^\/api\/v1\/configurations\/([^/]+)\/rollout-cohort-summary$/,
  );
  if (rolloutSummaryMatch && method === "GET") {
    return handleRolloutCohortSummary(env, tenantId, rolloutSummaryMatch[1]!);
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

  await env.FP_DB.batch([
    env.FP_DB.prepare(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)`,
    ).bind(tenantId),
    env.FP_DB.prepare(`DELETE FROM users WHERE tenant_id = ?`).bind(tenantId),
    env.FP_DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(tenantId),
  ]);
  return new Response(null, { status: 204 });
}

// ─── Team Handler ───────────────────────────────────────────────────

async function handleGetTeam(env: Env, tenantId: string): Promise<Response> {
  const result = await env.FP_DB.prepare(
    `SELECT id, email, display_name, role, created_at FROM users WHERE tenant_id = ? ORDER BY created_at ASC`,
  )
    .bind(tenantId)
    .all();
  return Response.json({ members: result.results });
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
    .bind(id, body.name.trim(), body.description ?? null, tenantId)
    .run();

  if ((insertResult.meta.changes ?? 0) === 0) {
    const tenant = await env.FP_DB.prepare(`SELECT max_configs FROM tenants WHERE id = ?`)
      .bind(tenantId)
      .first<{ max_configs: number }>();
    if (!tenant) return jsonError("Tenant not found", 404);
    return jsonError(`Configuration limit reached (${tenant.max_configs})`, 429);
  }

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

  const versions = await env.FP_DB.prepare(
    `SELECT DISTINCT r2_key FROM config_versions WHERE config_id = ?`,
  )
    .bind(configId)
    .all<{ r2_key: string }>();

  await env.FP_DB.batch([
    env.FP_DB.prepare(`DELETE FROM enrollment_tokens WHERE config_id = ?`).bind(configId),
    env.FP_DB.prepare(`DELETE FROM config_versions WHERE config_id = ?`).bind(configId),
    env.FP_DB.prepare(`DELETE FROM configurations WHERE id = ? AND tenant_id = ?`).bind(
      configId,
      tenantId,
    ),
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

async function handleListVersions(env: Env, tenantId: string, configId: string): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const result = await env.FP_DB.prepare(
    `SELECT id, config_id, config_hash, r2_key, size_bytes, created_by, created_at
     FROM config_versions WHERE config_id = ? ORDER BY created_at DESC, rowid DESC`,
  )
    .bind(configId)
    .all<{
      id: string;
      config_id: string;
      config_hash: string;
      r2_key: string;
      size_bytes: number;
      created_by: string | null;
      created_at: string;
    }>();

  const versions = result.results.map((version, index) => ({
    ...version,
    version: result.results.length - index,
  }));

  return Response.json({
    versions,
    current_config_hash: config["current_config_hash"],
  });
}

async function handleLatestVersionDiff(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const result = await env.FP_DB.prepare(
    `SELECT id, config_hash, r2_key, size_bytes, created_at
     FROM config_versions WHERE config_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 2`,
  )
    .bind(configId)
    .all<{
      id: string;
      config_hash: string;
      r2_key: string;
      size_bytes: number;
      created_at: string;
    }>();

  const [latest, previous] = result.results;
  if (!latest || !previous) {
    return Response.json({
      available: false,
      reason: "At least two versions are required for a latest-vs-previous diff.",
      versions_seen: result.results.length,
    });
  }

  const [latestYaml, previousYaml] = await Promise.all([
    getR2Text(env, latest.r2_key),
    getR2Text(env, previous.r2_key),
  ]);
  if (latestYaml === null || previousYaml === null) {
    return Response.json({
      available: false,
      reason: "One or more version YAML blobs are missing from storage.",
      versions_seen: result.results.length,
    });
  }

  return Response.json({
    available: true,
    latest: versionSummary(latest),
    previous: versionSummary(previous),
    diff: summarizeTextDiff(previousYaml, latestYaml),
  });
}

// ─── YAML Content Handler ───────────────────────────────────────────

async function handleGetConfigYaml(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const hash = config["current_config_hash"] as string | null;
  if (!hash) {
    return jsonError("No config version uploaded yet", 404);
  }

  const r2Key = `configs/sha256/${hash}.yaml`;
  const r2Obj = await env.FP_CONFIGS.get(r2Key);
  if (!r2Obj) {
    return jsonError("Config content not found in storage", 404);
  }

  const yamlText = await r2Obj.text();
  return new Response(yamlText, {
    headers: { "Content-Type": "text/yaml; charset=utf-8" },
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

  await env.FP_DB.prepare(`UPDATE enrollment_tokens SET revoked_at = datetime('now') WHERE id = ?`)
    .bind(tokenId)
    .run();

  return Response.json({ id: tokenId, revoked: true });
}

// ─── Agent & Stats Handlers (from DO) ───────────────────────────────

async function handleListAgents(env: Env, tenantId: string, configId: string): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  return stub.fetch(new Request("http://internal/agents"));
}

async function handleGetStats(env: Env, tenantId: string, configId: string): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  return stub.fetch(new Request("http://internal/stats"));
}

async function handleRolloutCohortSummary(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  let agentsResponse: Response;
  let statsResponse: Response;
  try {
    [agentsResponse, statsResponse] = await Promise.all([
      stub.fetch(new Request("http://internal/agents")),
      stub.fetch(new Request("http://internal/stats")),
    ]);
  } catch (error) {
    console.error("rollout cohort summary DO fetch threw", error);
    return jsonError("Rollout cohort summary unavailable", 502);
  }
  const failedResponse = await failedDoResponse([
    ["agents", agentsResponse],
    ["stats", statsResponse],
  ]);
  if (failedResponse) {
    console.error("rollout cohort summary DO fetch failed", failedResponse);
    return jsonError("Rollout cohort summary unavailable", 502);
  }
  const agentsPayload = (await agentsResponse.json()) as unknown;
  const stats = (await statsResponse.json()) as Record<string, unknown>;
  const agents = Array.isArray(agentsPayload)
    ? agentsPayload
    : Array.isArray((agentsPayload as { agents?: unknown }).agents)
      ? ((agentsPayload as { agents: Array<Record<string, unknown>> }).agents ?? [])
      : [];
  const desiredHash =
    stringValue(stats["desired_config_hash"]) ?? stringValue(config["current_config_hash"]);
  const connected = agents.filter((agent) => stringValue(agent["status"]) === "connected").length;
  const healthy = agents.filter((agent) => booleanLike(agent["healthy"]) === true).length;
  const drifted = desiredHash
    ? agents.filter((agent) => {
        const current = stringValue(agent["current_config_hash"]);
        return current !== null && current !== desiredHash;
      }).length
    : 0;

  return Response.json({
    total_agents: agents.length,
    connected_agents: connected,
    healthy_agents: healthy,
    drifted_agents: drifted,
    desired_config_hash: desiredHash,
    status_counts: countByStringField(agents, "status"),
    current_hash_counts: topCounts(
      agents
        .map((agent) => stringValue(agent["current_config_hash"]))
        .filter((value): value is string => Boolean(value)),
      5,
    ),
  });
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

async function getR2Text(env: Env, r2Key: string): Promise<string | null> {
  const object = await env.FP_CONFIGS.get(r2Key);
  return object ? object.text() : null;
}

async function failedDoResponse(responses: Array<[string, Response]>) {
  for (const [name, response] of responses) {
    if (!response.ok) {
      return {
        name,
        status: response.status,
        body: await response.text().catch(() => "<unreadable>"),
      };
    }
  }
  return null;
}

function versionSummary(version: {
  id: string;
  config_hash: string;
  size_bytes: number;
  created_at: string;
}) {
  return {
    id: version.id,
    config_hash: version.config_hash,
    size_bytes: version.size_bytes,
    created_at: version.created_at,
  };
}

function summarizeTextDiff(previous: string, latest: string) {
  const previousLines = previous.split(/\r?\n/);
  const latestLines = latest.split(/\r?\n/);
  const { addedLines, removedLines } = orderedLineDiffCounts(previousLines, latestLines);

  return {
    previous_line_count: previousLines.length,
    latest_line_count: latestLines.length,
    line_count_delta: latestLines.length - previousLines.length,
    size_bytes_delta:
      new TextEncoder().encode(latest).byteLength - new TextEncoder().encode(previous).byteLength,
    added_lines: addedLines,
    removed_lines: removedLines,
  };
}

function orderedLineDiffCounts(previousLines: string[], latestLines: string[]) {
  const prefixLength = commonPrefixLength(previousLines, latestLines);
  const suffixLength = commonSuffixLength(previousLines, latestLines, prefixLength);
  const previousMiddle = previousLines.slice(prefixLength, previousLines.length - suffixLength);
  const latestMiddle = latestLines.slice(prefixLength, latestLines.length - suffixLength);
  const commonMiddleLines = longestCommonSubsequenceLength(previousMiddle, latestMiddle);
  return {
    addedLines: latestMiddle.length - commonMiddleLines,
    removedLines: previousMiddle.length - commonMiddleLines,
  };
}

function commonPrefixLength(left: string[], right: string[]) {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left: string[], right: string[], prefixLength: number) {
  const max = Math.min(left.length, right.length) - prefixLength;
  let count = 0;
  while (count < max && left[left.length - 1 - count] === right[right.length - 1 - count]) {
    count += 1;
  }
  return count;
}

function longestCommonSubsequenceLength(left: string[], right: string[]): number {
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  let previous = new Uint32Array(shorter.length + 1);
  let current = new Uint32Array(shorter.length + 1);

  for (let i = 1; i <= longer.length; i += 1) {
    const longerLine = longer[i - 1];
    for (let j = 1; j <= shorter.length; j += 1) {
      const shorterLine = shorter[j - 1];
      current[j] =
        longerLine === shorterLine
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, current[j - 1] ?? 0);
    }
    [previous, current] = [current, previous];
  }

  return previous[shorter.length] ?? 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function booleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  return null;
}

function countByStringField(rows: Array<Record<string, unknown>>, field: string) {
  return Object.fromEntries(
    [
      ...rows.reduce<Map<string, number>>((counts, row) => {
        const value = stringValue(row[field]) ?? "unknown";
        counts.set(value, (counts.get(value) ?? 0) + 1);
        return counts;
      }, new Map()),
    ].sort((a, b) => b[1] - a[1]),
  );
}

function topCounts(values: string[], limit: number) {
  return [
    ...values.reduce<Map<string, number>>((counts, value) => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    }, new Map()),
  ]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

// ─── Overview (aggregate stats) ─────────────────────────────────────

async function handleGetOverview(env: Env, tenantId: string): Promise<Response> {
  const tenant = await env.FP_DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);

  const configs = await env.FP_DB.prepare(
    "SELECT id, name, current_config_hash, created_at, updated_at FROM configurations WHERE tenant_id = ? ORDER BY created_at DESC",
  )
    .bind(tenantId)
    .all();

  const statsResults = await Promise.all(
    configs.results.map(async (config) => {
      const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, config["id"] as string));
      const stub = env.CONFIG_DO.get(doId);
      try {
        const resp = await stub.fetch(new Request("http://internal/stats"));
        return { config, stats: (await resp.json()) as Record<string, number> };
      } catch {
        return { config, stats: { total: 0, connected: 0, healthy: 0 } as Record<string, number> };
      }
    }),
  );

  let totalAgents = 0;
  let connectedAgents = 0;
  let healthyAgents = 0;
  const configStats: Array<Record<string, unknown>> = [];
  for (const { config, stats } of statsResults) {
    totalAgents += stats["total_agents"] ?? stats["total"] ?? 0;
    connectedAgents += stats["connected_agents"] ?? stats["connected"] ?? 0;
    healthyAgents += stats["healthy_agents"] ?? stats["healthy"] ?? 0;
    configStats.push({ ...config, stats });
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
  const tenant = await env.FP_DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first();
  if (!tenant) return jsonError("Tenant not found", 404);
  const body = await parseJsonBody<{ name?: string }>(request);
  if (body.name && typeof body.name === "string" && body.name.trim().length > 0) {
    await env.FP_DB.prepare(
      "UPDATE tenants SET name = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(body.name.trim(), tenantId)
      .run();
  }
  const updated = await env.FP_DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first();
  return Response.json(updated);
}

// ─── Agent Detail ───────────────────────────────────────────────────

async function handleGetAgent(
  env: Env,
  tenantId: string,
  configId: string,
  agentUid: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const agentsResp = await stub.fetch(new Request("http://internal/agents"));
  const data = (await agentsResp.json()) as { agents: Array<Record<string, unknown>> };
  const agent = data.agents.find((a) => a["instance_uid"] === agentUid);
  if (!agent) return jsonError("Agent not found", 404);
  return Response.json(agent);
}
