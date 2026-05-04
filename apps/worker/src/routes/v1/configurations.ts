// Configuration CRUD, versions, YAML content, and diff routes

import { Hono } from "hono";
import type { Env } from "../../index.js";
import type { V1Env } from "./shared.js";
import { withAudit, withAuditCreate, getOwnedConfig } from "./shared.js";
import {
  createConfigurationRequestSchema,
  updateConfigurationRequestSchema,
  createConfigurationResponseSchema,
  configurationSchema,
  type Configuration,
} from "@o11yfleet/core/api";
import {
  deleteConfigContentIfUnreferenced,
  uploadConfigVersion,
  validateYaml,
} from "../../config-store.js";
import type { AuditCreateResult } from "../../audit/recorder.js";
import { jsonError } from "../../shared/errors.js";
import { typedJsonResponse } from "../../shared/responses.js";
import { validateJsonBody } from "../../shared/validation.js";
import { sql, type RawBuilder } from "kysely";
import { diffLines } from "diff";
import { getDb } from "../../db/client.js";
import { compileForBatch } from "../../db/queries.js";
import { listConfigsForTenant } from "../../shared/db-helpers.js";

// ─── Handlers ───────────────────────────────────────────────────────

export async function handleListConfigurations(env: Env, tenantId: string): Promise<Response> {
  const configurations = await listConfigsForTenant(env, tenantId);
  return Response.json({ configurations });
}

export async function handleCreateConfiguration(
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

export async function handleGetConfiguration(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  return typedJsonResponse(configurationSchema, config as Configuration, env);
}

export async function handleUpdateConfiguration(
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

export async function handleDeleteConfiguration(
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

export async function handleUploadVersion(
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

export async function handleListVersions(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
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

export async function handleLatestVersionDiff(
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

export async function handleGetConfigYaml(
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

// ─── Diff Helpers ───────────────────────────────────────────────────

export async function getR2Text(env: Env, r2Key: string): Promise<string | null> {
  const object = await env.FP_CONFIGS.get(r2Key);
  return object ? object.text() : null;
}

export function versionSummary(version: {
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
export function summarizeTextDiff(previous: string, latest: string) {
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
export function utf8ByteLength(str: string): number {
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

// ─── Sub-router ─────────────────────────────────────────────────────

export const configRoutes = new Hono<V1Env>();

configRoutes.get("/configurations", async (c) => {
  return handleListConfigurations(c.env, c.get("tenantId"));
});

configRoutes.post("/configurations", async (c) => {
  const audit = c.get("audit");
  return withAuditCreate(
    audit,
    { action: "configuration.create", resource_type: "configuration" },
    () => handleCreateConfiguration(c.req.raw, c.env, c.get("tenantId")),
  );
});

configRoutes.get("/configurations/:id", async (c) => {
  return handleGetConfiguration(c.env, c.get("tenantId"), c.req.param("id"));
});

configRoutes.put("/configurations/:id", async (c) => {
  const configId = c.req.param("id");
  return withAudit(
    c.get("audit"),
    { action: "configuration.update", resource_type: "configuration", resource_id: configId },
    () => handleUpdateConfiguration(c.req.raw, c.env, c.get("tenantId"), configId),
  );
});

configRoutes.delete("/configurations/:id", async (c) => {
  const configId = c.req.param("id");
  return withAudit(
    c.get("audit"),
    { action: "configuration.delete", resource_type: "configuration", resource_id: configId },
    () => handleDeleteConfiguration(c.env, c.get("tenantId"), configId),
  );
});

configRoutes.post("/configurations/:id/versions", async (c) => {
  const configId = c.req.param("id");
  return withAuditCreate(
    c.get("audit"),
    {
      action: "config_version.publish",
      resource_type: "config_version",
      metadata: { config_id: configId },
    },
    () => handleUploadVersion(c.req.raw, c.env, c.get("tenantId"), configId),
  );
});

configRoutes.get("/configurations/:id/versions", async (c) => {
  return handleListVersions(c.env, c.get("tenantId"), c.req.param("id"));
});

configRoutes.get("/configurations/:id/version-diff-latest-previous", async (c) => {
  return handleLatestVersionDiff(c.env, c.get("tenantId"), c.req.param("id"));
});

configRoutes.get("/configurations/:id/yaml", async (c) => {
  return handleGetConfigYaml(c.env, c.get("tenantId"), c.req.param("id"));
});
