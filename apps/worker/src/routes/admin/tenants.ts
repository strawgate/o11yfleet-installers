// Tenant CRUD, impersonation, approval, and bulk operations

import { Hono } from "hono";
import type { z } from "zod";
import type { Env } from "../../index.js";
import type { AdminEnv } from "./shared.js";
import { withAdminAudit, withAdminAuditCreate } from "./shared.js";
import {
  actorUserId,
  recordEvent,
  type AuditContext,
  type AuditCreateResult,
} from "../../audit/recorder.js";
import {
  adminCreateTenantRequestSchema,
  adminUpdateTenantRequestSchema,
  adminApproveTenantRequestSchema,
  adminBulkApproveRequestSchema,
  adminBulkApproveResponseSchema,
  tenantSchema,
  type Tenant,
} from "@o11yfleet/core/api";
import { typedJsonResponse } from "../../shared/responses.js";
import { jsonError, ApiError } from "../../shared/errors.js";
import { DEFAULT_PLAN, PLAN_LIMITS, VALID_PLANS, normalizePlan } from "../../shared/plans.js";
import { sessionCookie } from "../../shared/cookies.js";
import { jsonValidator } from "../../shared/validation.js";
import { sql, type RawBuilder } from "kysely";
import { getDb } from "../../db/client.js";
import { deleteTenantById, findTenantById, tenantExists } from "../../shared/db-helpers.js";
import { sendTenantApprovalEmail } from "../../shared/email.js";
import { SESSION_TTL_MS, generateSessionId } from "../../shared/sessions.js";
import { readTenantFleetSummaries, numberMetric } from "./health.js";

// ─── Helpers ────────────────────────────────────────────────────────

export function boundedPositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export const TENANT_SORTS = {
  newest: "t.created_at DESC, t.id DESC",
  oldest: "t.created_at ASC, t.id ASC",
  name_asc: "t.name COLLATE NOCASE ASC, t.id ASC",
  name_desc: "t.name COLLATE NOCASE DESC, t.id DESC",
} as const;

type TenantSort = keyof typeof TENANT_SORTS;

export function normalizeTenantSort(value: string | null): TenantSort {
  if (!value) return "newest";
  if (Object.prototype.hasOwnProperty.call(TENANT_SORTS, value)) return value as TenantSort;
  return "newest";
}

// ─── Handlers ───────────────────────────────────────────────────────

async function handleCreateTenant(
  body: z.output<typeof adminCreateTenantRequestSchema>,
  env: Env,
): Promise<AuditCreateResult> {
  const plan = normalizePlan(body.plan ?? DEFAULT_PLAN);
  if (!plan) {
    return {
      response: jsonError(`Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}`, 400),
      resource_id: null,
    };
  }

  const limits = PLAN_LIMITS[plan];

  const id = crypto.randomUUID();
  const inserted = await getDb(env.FP_DB)
    .insertInto("tenants")
    .values({
      id,
      name: body.name,
      plan,
      max_configs: limits.max_configs,
      max_agents_per_config: limits.max_agents_per_config,
    })
    .returningAll()
    .executeTakeFirst();

  if (!inserted) {
    return {
      response: jsonError("Failed to create tenant", 500),
      resource_id: null,
    };
  }

  const tenant = {
    id: inserted.id,
    name: inserted.name,
    plan: inserted.plan,
    status: inserted.status ?? undefined,
    approved_at: inserted.approved_at ?? undefined,
    max_configs: inserted.max_configs ?? undefined,
    max_agents_per_config: inserted.max_agents_per_config ?? undefined,
    created_at: inserted.created_at ?? undefined,
    updated_at: inserted.updated_at ?? undefined,
  } satisfies Tenant;

  return {
    response: typedJsonResponse(tenantSchema, tenant, env, { status: 201 }),
    resource_id: tenant.id,
  };
}

async function handleListTenants(env: Env, url: URL): Promise<Response> {
  const qRaw = url.searchParams.get("q")?.trim() ?? "";
  const q = qRaw.slice(0, 200);
  const requestedPlan = url.searchParams.get("plan");
  const plan = requestedPlan ? (normalizePlan(requestedPlan) ?? "all") : "all";
  const requestedStatus = url.searchParams.get("status");
  const status: "pending" | "active" | "suspended" | null =
    requestedStatus === "pending" || requestedStatus === "active" || requestedStatus === "suspended"
      ? requestedStatus
      : null;
  const sort = normalizeTenantSort(url.searchParams.get("sort"));
  const limit = boundedPositiveInt(url.searchParams.get("limit"), 100, 500);
  const page = boundedPositiveInt(url.searchParams.get("page"), 1, 10_000);
  const offset = (page - 1) * limit;

  const db = getDb(env.FP_DB);

  const applyFilters = <T extends ReturnType<typeof db.selectFrom<"tenants as t">>>(qb: T): T => {
    let next = qb;
    if (q.length > 0) {
      const escaped = q.replace(/[\\%_]/g, "\\$&");
      const qLike = `%${escaped}%`;
      next = next.where((eb) =>
        eb.or([
          sql<boolean>`t.name LIKE ${qLike} ESCAPE '\\' COLLATE NOCASE`,
          sql<boolean>`t.id LIKE ${qLike} ESCAPE '\\' COLLATE NOCASE`,
        ]),
      ) as T;
    }
    if (plan !== "all") next = next.where("t.plan", "=", plan) as T;
    if (status) next = next.where("t.status", "=", status) as T;
    return next;
  };

  const totalRow = await applyFilters(db.selectFrom("tenants as t"))
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .executeTakeFirst();

  const rows = await applyFilters(db.selectFrom("tenants as t"))
    .selectAll("t")
    .select((eb) =>
      eb
        .selectFrom("configurations")
        .select((cb) => cb.fn.countAll<number>().as("c"))
        .whereRef("configurations.tenant_id", "=", "t.id")
        .as("config_count"),
    )
    .orderBy(sql.raw(TENANT_SORTS[sort]))
    .limit(limit)
    .offset(offset)
    .execute();

  const tenantMetrics = await readTenantFleetSummaries(env);
  const tenants = rows.map((tenant) => {
    const metrics = tenantMetrics.byTenant.get(tenant["id"]);
    return {
      ...tenant,
      agent_count: numberMetric(metrics?.agent_count),
      connected_agents: numberMetric(metrics?.connected_agents),
      healthy_agents: numberMetric(metrics?.healthy_agents),
      metrics_source: tenantMetrics.available ? "analytics_engine" : "unavailable",
    };
  });
  const total = totalRow?.count ?? 0;

  // Get counts by status for filter badges.
  const statusCounts = await db
    .selectFrom("tenants")
    .select(["status", (eb) => eb.fn.countAll<number>().as("count")])
    .groupBy("status")
    .execute();

  const statusCountsMap: Record<string, number> = {};
  for (const row of statusCounts) statusCountsMap[row.status] = row.count;

  return Response.json({
    tenants,
    pagination: { page, limit, total, has_more: offset + rows.length < total },
    filters: { q, plan, status, sort },
    status_counts: statusCountsMap,
    metrics_source: tenantMetrics.available ? "analytics_engine" : "unavailable",
    metrics_error: tenantMetrics.error,
  });
}

async function handleGetTenant(env: Env, tenantId: string): Promise<Response> {
  const row = await findTenantById(env, tenantId);
  if (!row) return jsonError("Tenant not found", 404);
  const tenant = {
    id: row.id,
    name: row.name,
    plan: row.plan,
    status: row.status ?? undefined,
    approved_at: row.approved_at ?? undefined,
    max_configs: row.max_configs ?? undefined,
    max_agents_per_config: row.max_agents_per_config ?? undefined,
    created_at: row.created_at ?? undefined,
    updated_at: row.updated_at ?? undefined,
  } satisfies Tenant;
  return typedJsonResponse(tenantSchema, tenant, env);
}

async function handleUpdateTenant(
  body: z.output<typeof adminUpdateTenantRequestSchema>,
  env: Env,
  tenantId: string,
  audit: AuditContext,
): Promise<Response> {
  const adminId = actorUserId(audit.actor);
  const set: {
    name?: string;
    plan?: NonNullable<ReturnType<typeof normalizePlan>>;
    max_configs?: number;
    max_agents_per_config?: number;
    geo_enabled?: 0 | 1;
    status?: "pending" | "active" | "suspended";
    approved_at?: RawBuilder<string>;
    approved_by?: RawBuilder<string>;
    updated_at: RawBuilder<string>;
  } = { updated_at: sql<string>`datetime('now')` };

  if (body.name) set.name = body.name;
  if (body.plan) {
    const plan = normalizePlan(body.plan);
    if (!plan) {
      return jsonError(`Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}`, 400);
    }
    set.plan = plan;
    const limits = PLAN_LIMITS[plan];
    set.max_configs = limits.max_configs;
    set.max_agents_per_config = limits.max_agents_per_config;
  }
  if (body.geo_enabled !== undefined) set.geo_enabled = body.geo_enabled ? 1 : 0;
  if (body.status) {
    if (!["pending", "active", "suspended"].includes(body.status)) {
      return jsonError("Invalid status. Must be one of: pending, active, suspended", 400);
    }
    set.status = body.status as "pending" | "active" | "suspended";
    if (body.status === "active") {
      // Preserve first-approval timestamp — re-activation should not overwrite.
      set.approved_at = sql<string>`COALESCE(approved_at, datetime('now'))`;
      set.approved_by = sql<string>`COALESCE(approved_by, ${adminId})`;
    }
  }

  if (Object.keys(set).length === 1) {
    return jsonError("No fields to update", 400);
  }

  const updated = await getDb(env.FP_DB)
    .updateTable("tenants")
    .set(set)
    .where("id", "=", tenantId)
    .returningAll()
    .executeTakeFirst();
  if (!updated) return jsonError("Tenant not found", 404);
  const tenant = {
    id: updated.id,
    name: updated.name,
    plan: updated.plan,
    status: updated.status ?? undefined,
    approved_at: updated.approved_at ?? undefined,
    max_configs: updated.max_configs ?? undefined,
    max_agents_per_config: updated.max_agents_per_config ?? undefined,
    created_at: updated.created_at ?? undefined,
    updated_at: updated.updated_at ?? undefined,
  } satisfies Tenant;
  return typedJsonResponse(tenantSchema, tenant, env);
}

async function handleDeleteTenant(env: Env, tenantId: string): Promise<Response> {
  if (!(await tenantExists(env, tenantId))) {
    return jsonError("Tenant not found", 404);
  }

  const configs = await getDb(env.FP_DB)
    .selectFrom("configurations")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();
  if (configs && configs.count > 0) {
    return jsonError(
      `Cannot delete tenant with ${configs.count} configuration(s). Delete configurations first.`,
      409,
    );
  }

  await deleteTenantById(env, tenantId);
  return new Response(null, { status: 204 });
}

async function handleListConfigurations(env: Env, tenantId: string): Promise<Response> {
  const configurations = await getDb(env.FP_DB)
    .selectFrom("configurations")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc")
    .execute();
  return Response.json({ configurations });
}

async function handleListTenantUsers(env: Env, tenantId: string): Promise<Response> {
  if (!(await tenantExists(env, tenantId))) {
    return jsonError("Tenant not found", 404);
  }

  const users = await getDb(env.FP_DB)
    .selectFrom("users")
    .select(["id", "email", "display_name", "role", "created_at"])
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc")
    .execute();
  return Response.json({ users });
}

// ─── Impersonation ──────────────────────────────────────────────────

async function handleImpersonateTenant(
  request: Request,
  env: Env,
  tenantId: string,
  adminUserId: string | null,
): Promise<Response> {
  const db = getDb(env.FP_DB);
  const tenant = await db
    .selectFrom("tenants")
    .select(["id", "name"])
    .where("id", "=", tenantId)
    .executeTakeFirst();
  if (!tenant) return jsonError("Tenant not found", 404);

  const email = `impersonation+${tenantId}@o11yfleet.local`;
  let user = await db
    .selectFrom("users")
    .select(["id", "email", "display_name", "role", "tenant_id"])
    .where("email", "=", email)
    .limit(1)
    .executeTakeFirst();

  if (!user) {
    await db
      .insertInto("users")
      .values({
        id: crypto.randomUUID(),
        email,
        password_hash: "impersonation:disabled",
        display_name: `Admin view: ${tenant.name}`,
        role: "member",
        tenant_id: tenantId,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    user = await db
      .selectFrom("users")
      .select(["id", "email", "display_name", "role", "tenant_id"])
      .where("email", "=", email)
      .limit(1)
      .executeTakeFirst();
    if (!user) throw new ApiError("Failed to provision impersonation user", 500);
  }

  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db
    .insertInto("sessions")
    .values({
      id: sessionId,
      user_id: user.id,
      expires_at: expiresAt,
      is_impersonation: 1,
      impersonator_user_id: adminUserId,
    })
    .execute();

  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return Response.json(
    {
      user: {
        userId: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        tenantId: user.tenant_id,
        isImpersonation: true,
      },
    },
    { headers: { "Set-Cookie": sessionCookie(sessionId, maxAge, env, request) } },
  );
}

// ─── Approval ───────────────────────────────────────────────────────

interface TenantWithUser {
  id: string;
  name: string;
  email: string;
  tenant_status: string | null;
}

export async function getTenantWithPrimaryUser(
  env: Env,
  tenantId: string,
): Promise<TenantWithUser | null> {
  const map = await getTenantsWithPrimaryUsers(env, [tenantId]);
  return map.get(tenantId) ?? null;
}

export async function getTenantsWithPrimaryUsers(
  env: Env,
  tenantIds: string[],
): Promise<Map<string, TenantWithUser>> {
  const result = new Map<string, TenantWithUser>();
  if (tenantIds.length === 0) return result;

  const db = getDb(env.FP_DB);
  const rows = await db
    .selectFrom("tenants as t")
    .leftJoin("users as u", "u.tenant_id", "t.id")
    .select(["t.id", "t.name", "t.status", "u.email"])
    .where("t.id", "in", tenantIds)
    .orderBy("u.created_at", "asc")
    .execute();

  for (const row of rows) {
    if (!result.has(row.id)) {
      result.set(row.id, {
        id: row.id,
        name: row.name,
        email: row.email ?? "",
        tenant_status: row.status ?? null,
      });
    }
  }

  return result;
}

async function handleApproveTenant(
  body: z.output<typeof adminApproveTenantRequestSchema>,
  env: Env,
  tenantId: string,
  audit: AuditContext,
): Promise<Response> {
  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return jsonError("Tenant not found", 404);

  const adminId = actorUserId(audit.actor);

  if (body.action === "approve") {
    if (tenant.status === "active") {
      return Response.json({ success: true, status: "active", tenantId });
    }

    await getDb(env.FP_DB)
      .updateTable("tenants")
      .set({
        status: "active",
        approved_at: sql<string>`COALESCE(approved_at, datetime('now'))`,
        approved_by: sql<string>`COALESCE(approved_by, ${adminId})`,
      })
      .where("id", "=", tenantId)
      .execute();

    const tenantWithUser = await getTenantWithPrimaryUser(env, tenantId);
    if (tenantWithUser?.email) {
      await sendTenantApprovalEmail(env, {
        tenantName: tenantWithUser.name,
        tenantEmail: tenantWithUser.email,
        action: "approved",
      });
    }

    return Response.json({ success: true, status: "active", tenantId });
  } else if (body.action === "reject") {
    await getDb(env.FP_DB)
      .updateTable("tenants")
      .set({ status: "suspended" })
      .where("id", "=", tenantId)
      .execute();

    const tenantWithUser = await getTenantWithPrimaryUser(env, tenantId);
    if (tenantWithUser?.email) {
      await sendTenantApprovalEmail(env, {
        tenantName: tenantWithUser.name,
        tenantEmail: tenantWithUser.email,
        action: "rejected",
        reason: body.reason,
      });
    }

    return Response.json({ success: true, status: "suspended", tenantId });
  }

  return jsonError("Invalid action", 400);
}

async function handleBulkApproveTenants(
  body: z.output<typeof adminBulkApproveRequestSchema>,
  env: Env,
  audit: AuditContext,
): Promise<Response> {
  const approved: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const adminId = actorUserId(audit.actor);

  for (const tenantId of body.tenant_ids) {
    try {
      const tenant = await findTenantById(env, tenantId);
      if (!tenant) {
        failed.push({ id: tenantId, error: "Tenant not found" });
        continue;
      }

      const tenantStatus = (tenant as Record<string, unknown>)["status"] as string | undefined;
      if (tenantStatus !== "pending") {
        failed.push({ id: tenantId, error: `Tenant is ${tenantStatus ?? "unknown"}, not pending` });
        continue;
      }

      const result = await getDb(env.FP_DB)
        .updateTable("tenants")
        .set({
          status: "active",
          approved_at: sql<string>`COALESCE(approved_at, datetime('now'))`,
          approved_by: sql<string>`COALESCE(approved_by, ${adminId})`,
        })
        .where("id", "=", tenantId)
        .where("status", "=", "pending")
        .execute();

      if ((result[0]?.numUpdatedRows ?? 0n) === 0n) {
        failed.push({ id: tenantId, error: "Concurrent state change; tenant no longer pending" });
        continue;
      }

      approved.push(tenantId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ id: tenantId, error });
    }
  }

  // Batch-fetch primary users for all approved tenants (single query),
  // then send emails in parallel. Failures don't roll back approval.
  const tenantUsers = await getTenantsWithPrimaryUsers(env, approved);
  const emailResults = await Promise.allSettled(
    approved
      .map((id) => tenantUsers.get(id))
      .filter((u): u is TenantWithUser => u !== undefined && u.email !== "")
      .map((u) =>
        sendTenantApprovalEmail(env, {
          tenantName: u.name,
          tenantEmail: u.email,
          action: "approved",
        }),
      ),
  );

  emailResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("Tenant approval email failed", {
        tenantId: approved[index],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return typedJsonResponse(adminBulkApproveResponseSchema, { approved, failed }, env);
}

// ─── Sub-router ─────────────────────────────────────────────────────

export const tenantRoutes = new Hono<AdminEnv>();

tenantRoutes.post("/tenants", jsonValidator(adminCreateTenantRequestSchema), async (c) => {
  const audit = c.get("audit");
  const body = c.req.valid("json");
  return withAdminAuditCreate(
    audit,
    { action: "admin.tenant.create", resource_type: "tenant" },
    () => handleCreateTenant(body, c.env),
  );
});

tenantRoutes.get("/tenants", async (c) => {
  return handleListTenants(c.env, new URL(c.req.url));
});

tenantRoutes.get("/tenants/:id", async (c) => {
  return handleGetTenant(c.env, c.req.param("id"));
});

tenantRoutes.put("/tenants/:id", jsonValidator(adminUpdateTenantRequestSchema), async (c) => {
  const audit = c.get("audit");
  const targetId = c.req.param("id");
  const body = c.req.valid("json");
  return withAdminAudit(
    audit,
    { action: "admin.tenant.update", resource_type: "tenant", resource_id: targetId },
    () => handleUpdateTenant(body, c.env, targetId, audit),
    targetId,
  );
});

tenantRoutes.delete("/tenants/:id", async (c) => {
  const audit = c.get("audit");
  const targetId = c.req.param("id");
  return withAdminAudit(
    audit,
    { action: "admin.tenant.delete", resource_type: "tenant", resource_id: targetId },
    () => handleDeleteTenant(c.env, targetId),
    targetId,
  );
});

tenantRoutes.get("/tenants/:id/configurations", async (c) => {
  return handleListConfigurations(c.env, c.req.param("id"));
});

tenantRoutes.get("/tenants/:id/users", async (c) => {
  return handleListTenantUsers(c.env, c.req.param("id"));
});

tenantRoutes.post("/tenants/:id/impersonate", async (c) => {
  const audit = c.get("audit");
  const targetId = c.req.param("id");
  const adminUserId = audit?.actor.kind === "user" ? audit.actor.user_id : null;
  return withAdminAudit(
    audit,
    {
      action: "admin.tenant.impersonate_start",
      resource_type: "tenant",
      resource_id: targetId,
    },
    () => handleImpersonateTenant(c.req.raw, c.env, targetId, adminUserId),
    targetId,
  );
});

tenantRoutes.post(
  "/tenants/:id/approve",
  jsonValidator(adminApproveTenantRequestSchema),
  async (c) => {
    const audit = c.get("audit");
    const targetId = c.req.param("id");
    const body = c.req.valid("json");
    return withAdminAudit(
      audit,
      { action: "admin.tenant.approve", resource_type: "tenant", resource_id: targetId },
      () => handleApproveTenant(body, c.env, targetId, audit),
      targetId,
    );
  },
);

tenantRoutes.post("/bulk-approve", jsonValidator(adminBulkApproveRequestSchema), async (c) => {
  const audit = c.get("audit");
  const body = c.req.valid("json");
  const resp = await withAdminAudit(
    audit,
    { action: "admin.tenant.bulk_approve", resource_type: "tenant", resource_id: null },
    () => handleBulkApproveTenants(body, c.env, audit),
  );
  // Mirror an `admin.tenant.approve` event into each approved tenant's
  // own audit log so customers see the action under their tenant.
  if (audit && resp.ok) {
    const cloned = resp.clone();
    try {
      const body = (await cloned.json()) as { approved?: unknown };
      const approvedIds: string[] = Array.isArray(body.approved)
        ? body.approved.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
      for (const customerTenantId of approvedIds) {
        const customerAudit: AuditContext = {
          ...audit,
          scope: { kind: "tenant", tenant_id: customerTenantId },
          actor:
            audit.actor.kind === "user"
              ? { ...audit.actor, impersonator_user_id: audit.actor.user_id }
              : audit.actor,
        };
        recordEvent(
          customerAudit,
          {
            action: "admin.tenant.approve",
            resource_type: "tenant",
            resource_id: customerTenantId,
          },
          "success",
          200,
        );
      }
    } catch {
      // Body wasn't JSON or didn't contain approved[]; skip per-tenant mirroring.
    }
  }
  return resp;
});
