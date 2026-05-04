// Pending tokens, pending devices, and API key routes

import { Hono } from "hono";
import type { Env } from "../../index.js";
import type { V1Env } from "./shared.js";
import { withAudit, withAuditCreate, getOwnedConfig } from "./shared.js";
import { createPendingTokenRequestSchema } from "@o11yfleet/core/api";
import { generateApiKey, hashEnrollmentToken } from "@o11yfleet/core/auth";
import type { AuditCreateResult } from "../../audit/recorder.js";
import { jsonError } from "../../shared/errors.js";
import { parseRpcError } from "../../durable-objects/rpc-types.js";
import { jsonValidator } from "../../shared/validation.js";
import { sql } from "kysely";
import { z } from "zod";
import { getDb } from "../../db/client.js";

// ─── Handlers ───────────────────────────────────────────────────────

const createApiKeyRequestSchema = z.object({
  label: z.string().max(128).optional(),
  expires_in_seconds: z.number().int().nonnegative().optional(),
});

export async function handleCreateApiKey(
  body: z.output<typeof createApiKeyRequestSchema>,
  env: Env,
  tenantId: string,
): Promise<AuditCreateResult> {
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

export async function handleListPendingTokens(env: Env, tenantId: string): Promise<Response> {
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

export async function handleCreatePendingToken(
  body: z.output<typeof createPendingTokenRequestSchema>,
  env: Env,
  tenantId: string,
): Promise<AuditCreateResult> {
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

export async function handleRevokePendingToken(
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

export async function handleListPendingDevices(env: Env, tenantId: string): Promise<Response> {
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

const assignPendingDeviceRequestSchema = z.object({
  config_id: z.string().min(1),
});

export async function handleAssignPendingDevice(
  body: z.output<typeof assignPendingDeviceRequestSchema>,
  env: Env,
  tenantId: string,
  deviceUid: string,
): Promise<Response> {
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

// ─── Sub-router ─────────────────────────────────────────────────────

export const pendingRoutes = new Hono<V1Env>();

pendingRoutes.post("/api-keys", jsonValidator(createApiKeyRequestSchema), async (c) => {
  const body = c.req.valid("json");
  return withAuditCreate(
    c.get("audit"),
    { action: "api_key.create", resource_type: "api_key" },
    () => handleCreateApiKey(body, c.env, c.get("tenantId")),
  );
});

pendingRoutes.get("/pending-tokens", async (c) => {
  return handleListPendingTokens(c.env, c.get("tenantId"));
});

pendingRoutes.post("/pending-tokens", jsonValidator(createPendingTokenRequestSchema), async (c) => {
  const body = c.req.valid("json");
  return withAuditCreate(
    c.get("audit"),
    { action: "pending_token.create", resource_type: "pending_token" },
    () => handleCreatePendingToken(body, c.env, c.get("tenantId")),
  );
});

pendingRoutes.delete("/pending-tokens/:tokenId", async (c) => {
  const tokenId = c.req.param("tokenId");
  return withAudit(
    c.get("audit"),
    { action: "pending_token.revoke", resource_type: "pending_token", resource_id: tokenId },
    () => handleRevokePendingToken(c.env, c.get("tenantId"), tokenId),
  );
});

pendingRoutes.get("/pending-devices", async (c) => {
  return handleListPendingDevices(c.env, c.get("tenantId"));
});

pendingRoutes.post(
  "/pending-devices/:deviceUid/assign",
  jsonValidator(assignPendingDeviceRequestSchema),
  async (c) => {
    const deviceUid = c.req.param("deviceUid");
    const body = c.req.valid("json");
    return withAudit(
      c.get("audit"),
      { action: "pending_device.assign", resource_type: "pending_device", resource_id: deviceUid },
      () => handleAssignPendingDevice(body, c.env, c.get("tenantId"), deviceUid),
    );
  },
);
