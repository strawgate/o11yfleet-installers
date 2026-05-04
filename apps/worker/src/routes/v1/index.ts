// Tenant-scoped API routes — user portal operations
// All operations are scoped to a single tenant via authenticated session or API key

import type { Env } from "../../index.js";
import {
  recordMutation,
  type AuditContext,
  type AuditCreateMeta,
  type AuditCreateResult,
  type AuditDescriptor,
} from "../../audit/recorder.js";
import { handleListAuditLogs } from "./audit-logs.js";
import {
  createConfigurationRequestSchema,
  createEnrollmentTokenRequestSchema,
  updateConfigurationRequestSchema,
  updateTenantRequestSchema,
  createConfigurationResponseSchema,
  createEnrollmentTokenResponseSchema,
  tenantSchema,
  configurationSchema,
  overviewResponseSchema,
  type Tenant,
  type Configuration,
  type ConfigurationWithStats,
  type ConfigStats,
  type OverviewResponse,
  createPendingTokenRequestSchema,
} from "@o11yfleet/core/api";
import {
  deleteConfigContentIfUnreferenced,
  uploadConfigVersion,
  validateYaml,
} from "../../config-store.js";
import { generateEnrollmentToken, hashEnrollmentToken, generateApiKey } from "@o11yfleet/core/auth";
import {
  AiApiError,
  handleTenantChatRequest,
  handleTenantGuidanceRequest,
} from "../../ai/guidance.js";
import { jsonApiError, jsonError, ApiError } from "../../shared/errors.js";
import { parseRpcError } from "../../durable-objects/rpc-types.js";
import type { ConfigStatsResult } from "../../durable-objects/rpc-types.js";
import { typedJsonResponse } from "../../shared/responses.js";
import { validateJsonBody } from "../../shared/validation.js";
import { sql, type RawBuilder } from "kysely";
import { z } from "zod";
import { diffLines } from "diff";
import { getDb } from "../../db/client.js";
import { compileForBatch } from "../../db/queries.js";
import {
  countConfigsForTenant,
  findOwnedConfig,
  findTenantById,
  listConfigsForTenant,
  type ConfigurationRow,
} from "../../shared/db-helpers.js";
import { PLAN_DEFINITIONS, normalizePlan } from "../../shared/plans.js";
import { isAnalyticsSqlConfigured, runAnalyticsSql } from "../../analytics-sql.js";
import { latestSnapshotForTenant } from "@o11yfleet/core/metrics";

// ─── Router ─────────────────────────────────────────────────────────

export async function handleV1Request(
  request: Request,
  env: Env,
  url: URL,
  tenantId: string,
  audit?: AuditContext,
): Promise<Response> {
  try {
    return await routeV1Request(request, env, url, tenantId, audit);
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonApiError(err);
    }
    if (err instanceof AiApiError) {
      return jsonError(err.message, err.status);
    }
    console.error("V1 API error:", url.pathname, err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * Wrap a mutating handler so the response is also written to the audit
 * log. Read-only routes don't need this. The wrapper is intentionally
 * thin so coverage is grep-able: each mutating route has exactly one
 * `withAudit(...)` (or `withAuditCreate(...)`) call adjacent to the
 * handler.
 */
export async function withAudit(
  audit: AuditContext | undefined,
  desc: AuditDescriptor,
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    const response = await fn();
    if (audit) recordMutation(audit, response, desc);
    return response;
  } catch (err) {
    if (audit) {
      const status =
        err instanceof ApiError ? err.status : err instanceof AiApiError ? err.status : 500;
      recordMutation(audit, new Response(null, { status }), desc);
    }
    throw err;
  }
}

/**
 * Variant of `withAudit` for create routes. The handler signature
 * forces it to surface the canonical id of the new resource alongside
 * the response, which becomes the audit `resource_id`. This makes
 * "forgot to wire the new id into audit" a compile-time error — the
 * old `resource_id_from_response: "id"` indirection was easy to miss
 * or get wrong (e.g. config_version.publish silently recorded the
 * configuration id instead of the version id).
 */
export async function withAuditCreate(
  audit: AuditContext | undefined,
  meta: AuditCreateMeta,
  fn: () => Promise<AuditCreateResult>,
): Promise<Response> {
  try {
    const { response, resource_id } = await fn();
    if (audit) recordMutation(audit, response, { ...meta, resource_id });
    return response;
  } catch (err) {
    if (audit) {
      const status =
        err instanceof ApiError ? err.status : err instanceof AiApiError ? err.status : 500;
      recordMutation(audit, new Response(null, { status }), { ...meta, resource_id: null });
    }
    throw err;
  }
}

async function routeV1Request(
  request: Request,
  env: Env,
  url: URL,
  tenantId: string,
  audit?: AuditContext,
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // ─── Tenant Info ────────────────────────────────────────────

  if (path === "/api/v1/tenant" && method === "GET") {
    return handleGetTenant(env, tenantId);
  }
  if (path === "/api/v1/tenant" && method === "PUT") {
    return withAudit(
      audit,
      { action: "tenant.update", resource_type: "tenant", resource_id: tenantId },
      () => handleUpdateTenant(request, env, tenantId),
    );
  }
  if (path === "/api/v1/tenant" && method === "DELETE") {
    return withAudit(
      audit,
      { action: "tenant.delete", resource_type: "tenant", resource_id: tenantId },
      () => handleDeleteTenant(env, tenantId),
    );
  }

  // ─── Audit Logs (enterprise-gated) ───────────────────────────
  if (path === "/api/v1/audit-logs" && method === "GET") {
    return handleListAuditLogs(env, url, tenantId);
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
    return withAuditCreate(
      audit,
      { action: "configuration.create", resource_type: "configuration" },
      () => handleCreateConfiguration(request, env, tenantId),
    );
  }

  const configMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)$/);
  if (configMatch) {
    const configId = configMatch[1]!;
    if (method === "GET") return handleGetConfiguration(env, tenantId, configId);
    if (method === "PUT") {
      return withAudit(
        audit,
        { action: "configuration.update", resource_type: "configuration", resource_id: configId },
        () => handleUpdateConfiguration(request, env, tenantId, configId),
      );
    }
    if (method === "DELETE") {
      return withAudit(
        audit,
        { action: "configuration.delete", resource_type: "configuration", resource_id: configId },
        () => handleDeleteConfiguration(env, tenantId, configId),
      );
    }
  }

  // POST /api/v1/configurations/:id/versions
  const versionsPostMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/versions$/);
  if (versionsPostMatch && method === "POST") {
    const configId = versionsPostMatch[1]!;
    return withAuditCreate(
      audit,
      {
        action: "config_version.publish",
        resource_type: "config_version",
        metadata: { config_id: configId },
      },
      () => handleUploadVersion(request, env, tenantId, configId),
    );
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
    const configId = enrollMatch[1]!;
    return withAuditCreate(
      audit,
      {
        action: "enrollment_token.create",
        resource_type: "enrollment_token",
        metadata: { config_id: configId },
      },
      () => handleCreateEnrollmentToken(request, env, tenantId, configId),
    );
  }

  const tokensListMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/enrollment-tokens$/);
  if (tokensListMatch && method === "GET") {
    return handleListEnrollmentTokens(env, tenantId, tokensListMatch[1]!);
  }

  const tokenDeleteMatch = path.match(
    /^\/api\/v1\/configurations\/([^/]+)\/enrollment-tokens\/([^/]+)$/,
  );
  if (tokenDeleteMatch && method === "DELETE") {
    const configId = tokenDeleteMatch[1]!;
    const tokenId = tokenDeleteMatch[2]!;
    return withAudit(
      audit,
      {
        action: "enrollment_token.revoke",
        resource_type: "enrollment_token",
        resource_id: tokenId,
        metadata: { config_id: configId },
      },
      () => handleRevokeEnrollmentToken(env, tenantId, configId, tokenId),
    );
  }

  // ─── Agents & Stats (from DO) ──────────────────────────────

  const agentsMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/agents$/);
  if (agentsMatch && method === "GET") {
    return handleListAgents(env, tenantId, agentsMatch[1]!, url);
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
    const configId = rolloutMatch[1]!;
    return withAudit(
      audit,
      { action: "rollout.start", resource_type: "rollout", resource_id: configId },
      () => handleRollout(request, env, tenantId, configId),
    );
  }

  // ─── Admin Commands ────────────────────────────────────────
  // TODO: These destructive commands currently only check tenant ownership.
  // Add admin-role authorization when RBAC is implemented.
  const disconnectMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/disconnect$/);
  if (disconnectMatch && method === "POST") {
    const configId = disconnectMatch[1]!;
    return withAudit(
      audit,
      { action: "agents.disconnect", resource_type: "configuration", resource_id: configId },
      () => handleDisconnect(env, tenantId, configId),
    );
  }

  const restartMatch = path.match(/^\/api\/v1\/configurations\/([^/]+)\/restart$/);
  if (restartMatch && method === "POST") {
    const configId = restartMatch[1]!;
    return withAudit(
      audit,
      { action: "agents.restart", resource_type: "configuration", resource_id: configId },
      () => handleRestart(env, tenantId, configId),
    );
  }

  const disconnectAgentMatch = path.match(
    /^\/api\/v1\/configurations\/([^/]+)\/agents\/([^/]+)\/disconnect$/,
  );
  if (disconnectAgentMatch && method === "POST") {
    const configId = disconnectAgentMatch[1]!;
    const instanceUid = disconnectAgentMatch[2]!;
    return withAudit(
      audit,
      {
        action: "agent.disconnect",
        resource_type: "agent",
        resource_id: instanceUid,
        metadata: { config_id: configId },
      },
      () => handleDisconnectAgentRoute(env, tenantId, configId, instanceUid),
    );
  }

  const restartAgentMatch = path.match(
    /^\/api\/v1\/configurations\/([^/]+)\/agents\/([^/]+)\/restart$/,
  );
  if (restartAgentMatch && method === "POST") {
    const configId = restartAgentMatch[1]!;
    const instanceUid = restartAgentMatch[2]!;
    return withAudit(
      audit,
      {
        action: "agent.restart",
        resource_type: "agent",
        resource_id: instanceUid,
        metadata: { config_id: configId },
      },
      () => handleRestartAgentRoute(env, tenantId, configId, instanceUid),
    );
  }

  // ─── API Keys ────────────────────────────────────────────

  if (path === "/api/v1/api-keys" && method === "POST") {
    return withAuditCreate(audit, { action: "api_key.create", resource_type: "api_key" }, () =>
      handleCreateApiKey(request, env, tenantId),
    );
  }

  // ─── Pending Tokens ───────────────────────────────────────

  if (path === "/api/v1/pending-tokens" && method === "GET") {
    return handleListPendingTokens(env, tenantId);
  }
  if (path === "/api/v1/pending-tokens" && method === "POST") {
    return withAuditCreate(
      audit,
      { action: "pending_token.create", resource_type: "pending_token" },
      () => handleCreatePendingToken(request, env, tenantId),
    );
  }

  const pendingTokenDeleteMatch = path.match(/^\/api\/v1\/pending-tokens\/([^/]+)$/);
  if (pendingTokenDeleteMatch && method === "DELETE") {
    const tokenId = pendingTokenDeleteMatch[1]!;
    return withAudit(
      audit,
      { action: "pending_token.revoke", resource_type: "pending_token", resource_id: tokenId },
      () => handleRevokePendingToken(env, tenantId, tokenId),
    );
  }

  // ─── Pending Devices ──────────────────────────────────────

  if (path === "/api/v1/pending-devices" && method === "GET") {
    return handleListPendingDevices(env, tenantId);
  }

  const pendingAssignMatch = path.match(/^\/api\/v1\/pending-devices\/([^/]+)\/assign$/);
  if (pendingAssignMatch && method === "POST") {
    const deviceUid = pendingAssignMatch[1]!;
    return withAudit(
      audit,
      { action: "pending_device.assign", resource_type: "pending_device", resource_id: deviceUid },
      () => handleAssignPendingDevice(request, env, tenantId, deviceUid),
    );
  }

  return jsonError("Not found", 404);
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Verify config belongs to tenant and return it */
/**
 * Look up a configuration row scoped to a tenant, returning `null` if
 * the config doesn't exist or belongs to another tenant. Wraps the
 * shared `findOwnedConfig` helper so existing handler code continues
 * to read naturally; new code should call the helper directly.
 */
async function getOwnedConfig(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<ConfigurationRow | null> {
  return findOwnedConfig(env, tenantId, configId);
}

function getDoName(tenantId: string, configId: string): string {
  return `${tenantId}:${configId}`;
}

// ─── Tenant Handler ─────────────────────────────────────────────────

async function handleGetTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return jsonError("Tenant not found", 404);
  return typedJsonResponse(tenantSchema, tenant as Tenant, env);
}

async function handleDeleteTenant(env: Env, tenantId: string): Promise<Response> {
  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return jsonError("Tenant not found", 404);

  const configCount = await countConfigsForTenant(env, tenantId);
  if (configCount > 0) {
    return jsonError(
      `Cannot delete tenant with ${configCount} configuration(s). Delete configurations first.`,
      409,
    );
  }

  // Atomic batch — sessions, users, tenant must all delete or none.
  // env.FP_DB.batch is the only way to commit multiple D1 statements
  // atomically (kysely-d1 doesn't support transactions); compileForBatch
  // lets us keep the type-safe builder.
  const db = getDb(env.FP_DB);
  await env.FP_DB.batch([
    compileForBatch(
      db
        .deleteFrom("sessions")
        .where((eb) =>
          eb(
            "user_id",
            "in",
            eb.selectFrom("users").select("id").where("tenant_id", "=", tenantId),
          ),
        ),
      env.FP_DB,
    ),
    compileForBatch(db.deleteFrom("users").where("tenant_id", "=", tenantId), env.FP_DB),
    compileForBatch(db.deleteFrom("tenants").where("id", "=", tenantId), env.FP_DB),
  ]);
  return new Response(null, { status: 204 });
}

// ─── Team Handler ───────────────────────────────────────────────────

async function handleGetTeam(env: Env, tenantId: string): Promise<Response> {
  const members = await getDb(env.FP_DB)
    .selectFrom("users")
    .select(["id", "email", "display_name", "role", "created_at"])
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "asc")
    .execute();
  return Response.json({ members });
}

// ─── Configuration Handlers ─────────────────────────────────────────

async function handleListConfigurations(env: Env, tenantId: string): Promise<Response> {
  const configurations = await listConfigsForTenant(env, tenantId);
  return Response.json({ configurations });
}

async function handleCreateConfiguration(
  request: Request,
  env: Env,
  tenantId: string,
): Promise<AuditCreateResult> {
  const body = await validateJsonBody(request, createConfigurationRequestSchema);

  const id = crypto.randomUUID();
  // Atomic create-with-quota check via INSERT ... SELECT. Splitting this
  // into a separate count + insert would be racy under concurrent creates;
  // doing it in one statement lets SQLite enforce the quota inside the
  // same row-locked operation that creates the row.
  const db = getDb(env.FP_DB);
  const insertResult = await db
    .insertInto("configurations")
    .columns(["id", "tenant_id", "name", "description"])
    .expression((eb) =>
      eb
        .selectFrom("tenants as t")
        .select([
          sql<string>`${id}`.as("id"),
          "t.id as tenant_id",
          sql<string>`${body.name}`.as("name"),
          sql<string | null>`${body.description ?? null}`.as("description"),
        ])
        .where("t.id", "=", tenantId)
        .where(({ eb: e, selectFrom, fn, ref }) =>
          e(
            selectFrom("configurations as c")
              .select(fn.countAll<number>().as("cnt"))
              .whereRef("c.tenant_id", "=", "t.id"),
            "<",
            ref("t.max_configs"),
          ),
        ),
    )
    .executeTakeFirst();

  if ((insertResult.numInsertedOrUpdatedRows ?? 0n) === 0n) {
    const tenant = await db
      .selectFrom("tenants")
      .select("max_configs")
      .where("id", "=", tenantId)
      .executeTakeFirst();
    if (!tenant) return { response: jsonError("Tenant not found", 404), resource_id: null };
    return {
      response: jsonError(`Configuration limit reached (${tenant.max_configs})`, 429),
      resource_id: null,
    };
  }

  return {
    response: typedJsonResponse(
      createConfigurationResponseSchema,
      { id, tenant_id: tenantId, name: body.name },
      env,
      { status: 201 },
    ),
    resource_id: id,
  };
}

async function handleGetConfiguration(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  return typedJsonResponse(configurationSchema, config as Configuration, env);
}

async function handleUpdateConfiguration(
  request: Request,
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const body = await validateJsonBody(request, updateConfigurationRequestSchema);
  const set: {
    name?: string;
    description?: string | null;
    updated_at: RawBuilder<string>;
  } = {
    updated_at: sql<string>`datetime('now')`,
  };
  if (body.name) set.name = body.name;
  if (body.description !== undefined) set.description = body.description;
  if (Object.keys(set).length === 1) return jsonError("No fields to update", 400);

  await getDb(env.FP_DB)
    .updateTable("configurations")
    .set(set)
    .where("id", "=", configId)
    .where("tenant_id", "=", tenantId)
    .execute();

  const updated = await getOwnedConfig(env, tenantId, configId);
  return typedJsonResponse(configurationSchema, updated as Configuration, env);
}

async function handleDeleteConfiguration(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const db = getDb(env.FP_DB);
  const versions = await db
    .selectFrom("config_versions")
    .select("r2_key")
    .distinct()
    .where("config_id", "=", configId)
    .execute();

  // env.FP_DB.batch is the only way to commit multiple D1 statements
  // atomically (kysely-d1 doesn't support transactions); compileForBatch
  // keeps the type-safe builder around each statement.
  await env.FP_DB.batch([
    compileForBatch(
      db.deleteFrom("enrollment_tokens").where("config_id", "=", configId),
      env.FP_DB,
    ),
    compileForBatch(db.deleteFrom("config_versions").where("config_id", "=", configId), env.FP_DB),
    compileForBatch(
      db.deleteFrom("configurations").where("id", "=", configId).where("tenant_id", "=", tenantId),
      env.FP_DB,
    ),
  ]);

  // Delete the unreferenced R2 objects in parallel — each call does its
  // own ownership check + delete and is independent. The previous
  // sequential `for await` made `DELETE /configurations/:id` linear in
  // the number of historical versions, which on a long-lived config
  // could mean dozens of round-trips before the response finalizes.
  await Promise.all(
    versions.map(({ r2_key: r2Key }) => deleteConfigContentIfUnreferenced(env, r2Key)),
  );

  return new Response(null, { status: 204 });
}

// ─── Config Version Handlers ────────────────────────────────────────

async function handleUploadVersion(
  request: Request,
  env: Env,
  tenantId: string,
  configId: string,
): Promise<AuditCreateResult> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return { response: jsonError("Configuration not found", 404), resource_id: null };

  const yaml = await request.text();
  if (!yaml || yaml.length === 0) {
    return { response: jsonError("Request body (YAML) is required", 400), resource_id: null };
  }
  if (yaml.length > 256 * 1024) {
    return { response: jsonError("Config too large (max 256KB)", 413), resource_id: null };
  }

  const yamlError = validateYaml(yaml);
  if (yamlError) {
    return { response: jsonError(`Invalid YAML: ${yamlError}`, 400), resource_id: null };
  }

  const result = await uploadConfigVersion(env, tenantId, configId, yaml);
  return {
    response: Response.json(
      {
        id: result.versionId,
        hash: result.hash,
        r2Key: result.r2Key,
        sizeBytes: result.sizeBytes,
        deduplicated: result.deduplicated,
      },
      { status: 201 },
    ),
    resource_id: result.versionId,
  };
}

async function handleListVersions(env: Env, tenantId: string, configId: string): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const rows = await getDb(env.FP_DB)
    .selectFrom("config_versions")
    .select(["id", "config_id", "config_hash", "r2_key", "size_bytes", "created_by", "created_at"])
    .where("config_id", "=", configId)
    .orderBy("created_at", "desc")
    .orderBy(sql`rowid`, "desc")
    .execute();

  const versions = rows.map((version, index) => ({
    ...version,
    version: rows.length - index,
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

  const rows = await getDb(env.FP_DB)
    .selectFrom("config_versions")
    .select(["id", "config_hash", "r2_key", "size_bytes", "created_at"])
    .where("config_id", "=", configId)
    .orderBy("created_at", "desc")
    .orderBy(sql`rowid`, "desc")
    .limit(2)
    .execute();

  const [latest, previous] = rows;
  if (!latest || !previous) {
    return Response.json({
      available: false,
      reason: "At least two versions are required for a latest-vs-previous diff.",
      versions_seen: rows.length,
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
      versions_seen: rows.length,
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
): Promise<AuditCreateResult> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return { response: jsonError("Configuration not found", 404), resource_id: null };

  // Plan gate: only plans with supports_direct_enrollment can issue enrollment tokens.
  // This is the enforcement point — the WebSocket connect path trusts HMAC + expiry only.
  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return { response: jsonError("Tenant not found", 404), resource_id: null };
  const plan = normalizePlan(tenant.plan);
  if (!plan || !PLAN_DEFINITIONS[plan].supports_direct_enrollment) {
    return {
      response: jsonError(
        "Your plan does not support direct enrollment. Use pending enrollment instead.",
        403,
      ),
      resource_id: null,
    };
  }

  const body = await validateJsonBody(request, createEnrollmentTokenRequestSchema);

  let expiresInSeconds: number | undefined;
  if (body.expires_in_hours !== null && body.expires_in_hours !== undefined) {
    if (typeof body.expires_in_hours !== "number" || body.expires_in_hours <= 0) {
      return {
        response: jsonError("expires_in_hours must be a positive number", 400),
        resource_id: null,
      };
    }
    if (body.expires_in_hours > 8760) {
      return {
        response: jsonError("expires_in_hours must be 8760 (1 year) or less", 400),
        resource_id: null,
      };
    }
    expiresInSeconds = body.expires_in_hours * 3600;
  }

  const id = crypto.randomUUID();
  const { token: rawToken, expires_at: expiresAt } = await generateEnrollmentToken({
    tenant_id: tenantId,
    config_id: configId,
    secret: env.O11YFLEET_CLAIM_HMAC_SECRET,
    expires_in_seconds: expiresInSeconds,
    jti: id,
  });

  const tokenHash = await hashEnrollmentToken(rawToken);

  // Store in D1 as admin registry (for listing/revocation UI — NOT used on connect path)
  await getDb(env.FP_DB)
    .insertInto("enrollment_tokens")
    .values({
      id,
      config_id: configId,
      tenant_id: tenantId,
      token_hash: tokenHash,
      label: body.label ?? null,
      expires_at: expiresAt,
    })
    .execute();

  return {
    response: typedJsonResponse(
      createEnrollmentTokenResponseSchema,
      {
        id,
        token: rawToken,
        config_id: configId,
        label: body.label ?? null,
        expires_at: expiresAt,
      },
      env,
      { status: 201 },
    ),
    resource_id: id,
  };
}

async function handleListEnrollmentTokens(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const tokens = await getDb(env.FP_DB)
    .selectFrom("enrollment_tokens")
    .select(["id", "config_id", "tenant_id", "label", "expires_at", "revoked_at", "created_at"])
    .where("config_id", "=", configId)
    .orderBy("created_at", "desc")
    .execute();

  return Response.json({ tokens });
}

async function handleRevokeEnrollmentToken(
  env: Env,
  tenantId: string,
  configId: string,
  tokenId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  const db = getDb(env.FP_DB);
  const token = await db
    .selectFrom("enrollment_tokens")
    .selectAll()
    .where("id", "=", tokenId)
    .where("config_id", "=", configId)
    .executeTakeFirst();
  if (!token) return jsonError("Enrollment token not found", 404);
  if (token.revoked_at) return jsonError("Token is already revoked", 409);

  await db
    .updateTable("enrollment_tokens")
    .set({ revoked_at: sql<string>`datetime('now')` })
    .where("id", "=", tokenId)
    .execute();

  return Response.json({ id: tokenId, revoked: true });
}

// ─── Agent & Stats Handlers (from DO) ───────────────────────────────

async function handleListAgents(
  env: Env,
  tenantId: string,
  configId: string,
  url: URL,
): Promise<Response> {
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const result = await stub.rpcListAgents({
    limit: Number(url.searchParams.get("limit") ?? 50) || 50,
    cursor: url.searchParams.get("cursor") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    health: url.searchParams.get("health") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
  });
  return Response.json(result);
}

async function handleGetStats(env: Env, tenantId: string, configId: string): Promise<Response> {
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const result = await stub.rpcGetStats();
  return Response.json(result);
}

async function handleDisconnect(env: Env, tenantId: string, configId: string): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const result = await stub.rpcDisconnectAll();
  return Response.json(result);
}

async function handleRestart(env: Env, tenantId: string, configId: string): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const result = await stub.rpcRestartAll();
  return Response.json(result);
}

async function handleDisconnectAgentRoute(
  env: Env,
  tenantId: string,
  configId: string,
  instanceUid: string,
): Promise<Response> {
  if (!isValidInstanceUid(instanceUid)) {
    return jsonError("Invalid instance_uid", 400);
  }
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  try {
    const result = await stub.rpcDisconnectAgent(instanceUid);
    return Response.json(result);
  } catch (err) {
    const rpcErr = parseRpcError(err);
    if (rpcErr) return jsonError(rpcErr.message, rpcErr.statusCode);
    throw err;
  }
}

async function handleRestartAgentRoute(
  env: Env,
  tenantId: string,
  configId: string,
  instanceUid: string,
): Promise<Response> {
  if (!isValidInstanceUid(instanceUid)) {
    return jsonError("Invalid instance_uid", 400);
  }
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  try {
    const result = await stub.rpcRestartAgent(instanceUid);
    return Response.json(result);
  } catch (err) {
    const rpcErr = parseRpcError(err);
    if (rpcErr) return jsonError(rpcErr.message, rpcErr.statusCode);
    throw err;
  }
}

function isValidInstanceUid(uid: string): boolean {
  // OpAMP instance_uid is a 16-byte ULID, hex-encoded → 32 hex chars
  return /^[0-9a-f]{32}$/i.test(uid);
}

async function handleRolloutCohortSummary(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  try {
    const stats = (await stub.rpcGetStats()) as ConfigStatsResult;
    return Response.json({
      total_agents: stats.total_agents,
      connected_agents: stats.connected_agents,
      healthy_agents: stats.healthy_agents,
      drifted_agents: stats.drifted_agents ?? 0,
      desired_config_hash: stats.desired_config_hash ?? null,
      status_counts: stats.status_counts ?? {},
      current_hash_counts: stats.current_hash_counts ?? [],
    });
  } catch (error) {
    console.error("rollout cohort summary RPC call failed", error);
    return jsonError("Rollout cohort summary unavailable", 502);
  }
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

  const result = await stub.rpcSetDesiredConfig({
    config_hash: config["current_config_hash"],
    config_content: configContent,
  });
  return Response.json(result);
}

async function getR2Text(env: Env, r2Key: string): Promise<string | null> {
  const object = await env.FP_CONFIGS.get(r2Key);
  return object ? object.text() : null;
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

/**
 * Computes a summary of text differences between two YAML strings.
 * Uses the `diff` package's Myers diff algorithm for accurate line-level changes.
 * Returns line counts, byte delta, and added/removed line counts.
 */
function summarizeTextDiff(previous: string, latest: string) {
  // Use the `diff` package for accurate line-level diffs
  // This replaces the hand-rolled LCS algorithm which had O(N×M) worst case
  const changes = diffLines(previous, latest);
  let addedLines = 0;
  let removedLines = 0;

  for (const part of changes) {
    // Split by newlines and filter empty trailing entries
    const lines = part.value
      .split(/\r?\n/)
      .filter((l: string, i: number, arr: string[]) => i < arr.length - 1 || l !== "");
    const count = lines.length || (part.value.length > 0 ? 1 : 0);
    if (part.added) {
      addedLines += count;
    } else if (part.removed) {
      removedLines += count;
    }
  }

  return {
    previous_line_count: previous.split(/\r?\n/).length,
    latest_line_count: latest.split(/\r?\n/).length,
    line_count_delta: latest.split(/\r?\n/).length - previous.split(/\r?\n/).length,
    size_bytes_delta: utf8ByteLength(latest) - utf8ByteLength(previous),
    added_lines: addedLines,
    removed_lines: removedLines,
  };
}

/**
 * Counts UTF-8 byte length without allocating a Uint8Array.
 * Avoids the heap allocation of `new TextEncoder().encode(str)` which copies
 * the full string into a Uint8Array just to read `.byteLength`.
 */
function utf8ByteLength(str: string): number {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      len += 1;
    } else if (code < 0x800) {
      len += 2;
    } else if (code < 0xd800 || code > 0xdfff) {
      len += 3;
    } else {
      // Surrogate pair: consume both code units
      i++;
      len += 4;
    }
  }
  return len;
}

// ─── Overview (aggregate stats) ─────────────────────────────────────

interface AeSnapshotRow {
  tenant_id: string;
  config_id: string;
  interval: string;
  timestamp: string | number;
  agent_count: number;
  connected_count: number;
  disconnected_count: number;
  healthy_count: number;
  unhealthy_count: number;
  connected_healthy_count: number;
  config_up_to_date: number;
  config_pending: number;
  agents_with_errors: number;
  agents_stale: number;
  websocket_count: number;
  // Index signature so the row matches the AnalyticsSqlRow base shape;
  // every named column above is one of these.
  [column: string]: string | number | null;
}

/**
 * Build the Overview payload from Analytics Engine fleet metrics snapshots.
 * Overview intentionally does not fan out across Config DOs as a fallback:
 * missing metrics should be visible as unavailable/stale data, not converted
 * into a very expensive page render.
 */
async function handleGetOverview(env: Env, tenantId: string): Promise<Response> {
  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return jsonError("Tenant not found", 404);

  const configs = await getDb(env.FP_DB)
    .selectFrom("configurations")
    .select(["id", "tenant_id", "name", "current_config_hash", "created_at", "updated_at"])
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc")
    .execute();

  let metricsSource: "analytics_engine" | "unavailable" = "unavailable";
  let metricsError: string | null = null;
  const totals = { totalAgents: 0, connectedAgents: 0, healthyAgents: 0 };
  const byConfig = new Map<string, AeSnapshotRow>();

  if (isAnalyticsSqlConfigured(env)) {
    try {
      const rows = await runAnalyticsSql<AeSnapshotRow>(env, latestSnapshotForTenant(tenantId));
      for (const row of rows) byConfig.set(row.config_id, row);
      metricsSource = "analytics_engine";
    } catch (err) {
      metricsError = err instanceof Error ? err.message : String(err);
      console.error(
        `handleGetOverview: AE snapshot read failed for tenant ${tenantId}:`,
        metricsError,
      );
    }
  }

  const configStats: ConfigurationWithStats[] = configs.map((config) => {
    const snapshot = byConfig.get(config.id);
    const stats: ConfigStats = snapshot
      ? {
          total_agents: snapshot.agent_count,
          connected_agents: snapshot.connected_count,
          healthy_agents: snapshot.healthy_count,
          active_websockets: snapshot.websocket_count,
        }
      : {
          total_agents: 0,
          connected_agents: 0,
          healthy_agents: 0,
          active_websockets: 0,
        };
    totals.totalAgents += stats.total_agents;
    totals.connectedAgents += stats.connected_agents;
    totals.healthyAgents += stats.healthy_agents;
    return { ...config, stats } as ConfigurationWithStats;
  });

  const payload: OverviewResponse = {
    tenant,
    total_agents: totals.totalAgents,
    connected_agents: totals.connectedAgents,
    healthy_agents: totals.healthyAgents,
    configs_count: configs.length,
    configurations: configStats,
    metrics_source: metricsSource,
    metrics_error: metricsError,
  };
  return typedJsonResponse(overviewResponseSchema, payload, env);
}

// ─── Update Tenant ──────────────────────────────────────────────────

async function handleUpdateTenant(request: Request, env: Env, tenantId: string): Promise<Response> {
  const body = await validateJsonBody(request, updateTenantRequestSchema);
  const set: {
    name?: string;
    geo_enabled?: 0 | 1;
    updated_at: RawBuilder<string>;
  } = { updated_at: sql<string>`datetime('now')` };
  if (body.name !== undefined) set.name = body.name;
  if (body.geo_enabled !== undefined) set.geo_enabled = body.geo_enabled ? 1 : 0;

  if (Object.keys(set).length === 1) {
    const tenant = await findTenantById(env, tenantId);
    if (!tenant) return jsonError("Tenant not found", 404);
    return typedJsonResponse(tenantSchema, tenant as Tenant, env);
  }

  const updated = await getDb(env.FP_DB)
    .updateTable("tenants")
    .set(set)
    .where("id", "=", tenantId)
    .returningAll()
    .executeTakeFirst();
  if (!updated) return jsonError("Tenant not found", 404);
  return typedJsonResponse(tenantSchema, updated as Tenant, env);
}

// ─── Agent Detail ───────────────────────────────────────────────────

async function handleGetAgent(
  env: Env,
  tenantId: string,
  configId: string,
  agentUid: string,
): Promise<Response> {
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const result = await stub.rpcGetAgent(agentUid);
  if (!result) return jsonError("Agent not found", 404);
  return Response.json(result);
}

// ─── Pending Token Handlers ────────────────────────────────────────

async function handleListPendingTokens(env: Env, tenantId: string): Promise<Response> {
  const tokens = await getDb(env.FP_DB)
    .selectFrom("pending_tokens")
    .select([
      "id",
      "tenant_id",
      "label",
      "target_config_id",
      "expires_at",
      "revoked_at",
      "created_at",
    ])
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc")
    .execute();
  return Response.json({ tokens });
}

// ─── API Key Handlers ─────────────────────────────────────────────

const createApiKeyRequestSchema = z.object({
  label: z.string().max(128).optional(),
  expires_in_seconds: z.number().int().nonnegative().optional(),
});

async function handleCreateApiKey(
  request: Request,
  env: Env,
  tenantId: string,
): Promise<AuditCreateResult> {
  const body = await validateJsonBody(request, createApiKeyRequestSchema);

  const result = await generateApiKey({
    tenant_id: tenantId,
    secret: env.O11YFLEET_CLAIM_HMAC_SECRET,
    expires_in_seconds: body.expires_in_seconds,
    label: body.label,
  });

  return {
    response: Response.json(
      {
        token: result.token,
        jti: result.jti,
        expires_at: result.expires_at,
        tenant_id: tenantId,
      },
      { status: 201 },
    ),
    resource_id: result.jti,
  };
}

async function handleCreatePendingToken(
  request: Request,
  env: Env,
  tenantId: string,
): Promise<AuditCreateResult> {
  const body = await validateJsonBody(request, createPendingTokenRequestSchema);
  const label = body.label ?? null;
  const targetConfigId = body.target_config_id ?? null;

  if (targetConfigId) {
    const config = await getOwnedConfig(env, tenantId, targetConfigId);
    if (!config) {
      return { response: jsonError("Target configuration not found", 404), resource_id: null };
    }
  }

  const id = crypto.randomUUID();
  const jti = id;
  const now = Math.floor(Date.now() / 1000);
  const PENDING_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours
  const claim = {
    v: 1,
    tenant_id: tenantId,
    jti,
    iat: now,
    exp: now + PENDING_TOKEN_TTL_SECONDS,
  };

  const payload = btoa(JSON.stringify(claim))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.O11YFLEET_CLAIM_HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const token = `fp_pending_${payload}.${sigB64}`;
  const tokenHash = await hashEnrollmentToken(token);

  await getDb(env.FP_DB)
    .insertInto("pending_tokens")
    .values({
      id,
      tenant_id: tenantId,
      token_hash: tokenHash,
      label,
      target_config_id: targetConfigId,
      expires_at: new Date((now + PENDING_TOKEN_TTL_SECONDS) * 1000).toISOString(),
    })
    .execute();

  return {
    response: Response.json(
      { id, token, label, target_config_id: targetConfigId },
      { status: 201 },
    ),
    resource_id: id,
  };
}

async function handleRevokePendingToken(
  env: Env,
  tenantId: string,
  tokenId: string,
): Promise<Response> {
  const db = getDb(env.FP_DB);
  const token = await db
    .selectFrom("pending_tokens")
    .selectAll()
    .where("id", "=", tokenId)
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();
  if (!token) return jsonError("Pending token not found", 404);
  if (token.revoked_at) return jsonError("Token is already revoked", 409);

  await db
    .updateTable("pending_tokens")
    .set({ revoked_at: sql<string>`datetime('now')` })
    .where("id", "=", tokenId)
    .execute();

  return Response.json({ id: tokenId, revoked: true });
}

// ─── Pending Device Handlers ────────────────────────────────────────

async function handleListPendingDevices(env: Env, tenantId: string): Promise<Response> {
  const doName = `${tenantId}:__pending__`;
  const doId = env.CONFIG_DO.idFromName(doName);
  const stub = env.CONFIG_DO.get(doId);
  try {
    const result = await stub.rpcListPendingDevices();
    return Response.json(result);
  } catch (err) {
    const rpcErr = parseRpcError(err);
    if (rpcErr) return jsonError(rpcErr.message, rpcErr.statusCode);
    console.error("Failed to fetch pending devices", err);
    return jsonError("Failed to fetch pending devices", 502);
  }
}

async function handleAssignPendingDevice(
  request: Request,
  env: Env,
  tenantId: string,
  deviceUid: string,
): Promise<Response> {
  const body = await validateJsonBody(
    request,
    z.object({
      config_id: z.string().min(1),
    }),
  );

  const config = await getOwnedConfig(env, tenantId, body.config_id);
  if (!config) return jsonError("Configuration not found", 404);

  const doName = `${tenantId}:__pending__`;
  const doId = env.CONFIG_DO.idFromName(doName);
  const stub = env.CONFIG_DO.get(doId);
  try {
    const result = await stub.rpcAssignPendingDevice(deviceUid, {
      config_id: body.config_id,
      assigned_by: "api",
    });
    return Response.json(result);
  } catch (err) {
    const rpcErr = parseRpcError(err);
    if (rpcErr) return jsonError(rpcErr.message, rpcErr.statusCode);
    console.error("Failed to assign device", err);
    return jsonError("Failed to assign device", 502);
  }
}
