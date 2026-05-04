// Enrollment token lifecycle routes

import { Hono } from "hono";
import type { z } from "zod";
import type { Env } from "../../index.js";
import type { V1Env } from "./shared.js";
import { withAudit, withAuditCreate, getOwnedConfig } from "./shared.js";
import {
  createEnrollmentTokenRequestSchema,
  createEnrollmentTokenResponseSchema,
} from "@o11yfleet/core/api";
import { generateEnrollmentToken, hashEnrollmentToken } from "@o11yfleet/core/auth";
import type { AuditCreateResult } from "../../audit/recorder.js";
import { jsonError } from "../../shared/errors.js";
import { typedJsonResponse } from "../../shared/responses.js";
import { jsonValidator } from "../../shared/validation.js";
import { sql } from "kysely";
import { getDb } from "../../db/client.js";
import { findTenantById } from "../../shared/db-helpers.js";
import { PLAN_DEFINITIONS, normalizePlan } from "../../shared/plans.js";

// ─── Handlers ───────────────────────────────────────────────────────

export async function handleCreateEnrollmentToken(
  body: z.output<typeof createEnrollmentTokenRequestSchema>,
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

export async function handleListEnrollmentTokens(
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

export async function handleRevokeEnrollmentToken(
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

// ─── Sub-router ─────────────────────────────────────────────────────

export const enrollmentTokenRoutes = new Hono<V1Env>();

enrollmentTokenRoutes.post(
  "/configurations/:id/enrollment-token",
  jsonValidator(createEnrollmentTokenRequestSchema),
  async (c) => {
    const configId = c.req.param("id");
    const body = c.req.valid("json");
    return withAuditCreate(
      c.get("audit"),
      {
        action: "enrollment_token.create",
        resource_type: "enrollment_token",
        metadata: { config_id: configId },
      },
      () => handleCreateEnrollmentToken(body, c.env, c.get("tenantId"), configId),
    );
  },
);

enrollmentTokenRoutes.get("/configurations/:id/enrollment-tokens", async (c) => {
  return handleListEnrollmentTokens(c.env, c.get("tenantId"), c.req.param("id"));
});

enrollmentTokenRoutes.delete("/configurations/:id/enrollment-tokens/:tokenId", async (c) => {
  const configId = c.req.param("id");
  const tokenId = c.req.param("tokenId");
  return withAudit(
    c.get("audit"),
    {
      action: "enrollment_token.revoke",
      resource_type: "enrollment_token",
      resource_id: tokenId,
      metadata: { config_id: configId },
    },
    () => handleRevokeEnrollmentToken(c.env, c.get("tenantId"), configId, tokenId),
  );
});
