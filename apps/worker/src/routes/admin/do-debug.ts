// Durable Object inspection endpoints

import { Hono } from "hono";
import type { Env } from "../../index.js";
import type { AdminEnv } from "./shared.js";
import { withAdminAudit } from "./shared.js";
import type { ConfigDurableObject } from "../../durable-objects/config-do.js";
import { parseRpcError } from "../../durable-objects/rpc-types.js";
import { adminDoQueryRequestSchema } from "@o11yfleet/core/api";
import { jsonError, ApiError } from "../../shared/errors.js";
import { validateJsonBody } from "../../shared/validation.js";
import { getDb } from "../../db/client.js";

// ─── Helpers ────────────────────────────────────────────────────────

async function getConfigDoStub(
  env: Env,
  configId: string,
): Promise<DurableObjectStub<ConfigDurableObject>> {
  const config = await getDb(env.FP_DB)
    .selectFrom("configurations")
    .select(["id", "tenant_id"])
    .where("id", "=", configId)
    .executeTakeFirst();
  if (!config) throw new ApiError("Configuration not found", 404);

  return env.CONFIG_DO.get(env.CONFIG_DO.idFromName(`${config.tenant_id}:${config.id}`));
}

// ─── Handlers ───────────────────────────────────────────────────────

async function handleDoTables(env: Env, configId: string): Promise<Response> {
  const stub = await getConfigDoStub(env, configId);
  const result = await stub.rpcDebugTables();
  return Response.json(result);
}

async function handleDoQuery(request: Request, env: Env, configId: string): Promise<Response> {
  const body = await validateJsonBody(request, adminDoQueryRequestSchema);
  const stub = await getConfigDoStub(env, configId);
  try {
    const result = await stub.rpcDebugQuery({ sql: body.sql, params: body.params });
    return Response.json(result);
  } catch (err) {
    const rpcErr = parseRpcError(err);
    if (rpcErr) return jsonError(rpcErr.message, rpcErr.statusCode);
    throw err;
  }
}

// ─── Sub-router ─────────────────────────────────────────────────────

export const doDebugRoutes = new Hono<AdminEnv>();

doDebugRoutes.get("/configurations/:id/do/tables", async (c) => {
  return handleDoTables(c.env, c.req.param("id"));
});

doDebugRoutes.post("/configurations/:id/do/query", async (c) => {
  const audit = c.get("audit");
  const configId = c.req.param("id");
  const owner = await getDb(c.env.FP_DB)
    .selectFrom("configurations")
    .select("tenant_id")
    .where("id", "=", configId)
    .executeTakeFirst();
  return withAdminAudit(
    audit,
    { action: "admin.do.query", resource_type: "configuration", resource_id: configId },
    () => handleDoQuery(c.req.raw, c.env, configId),
    owner?.tenant_id,
  );
});
