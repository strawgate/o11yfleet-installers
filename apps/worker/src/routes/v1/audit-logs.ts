// GET /api/v1/audit-logs — enterprise-only customer-facing audit log.
//
// All tenants record events; visibility here is gated to plans with
// audit_log_access. Filters: action, resource_type, resource_id,
// actor_user_id, from, to. Pagination: opaque cursor (created_at|id),
// ordered by created_at DESC.

import type { Env } from "../../index.js";
import {
  auditLogListResponseSchema,
  type AuditLogEntry,
  type AuditLogListResponse,
} from "@o11yfleet/core/api";
import { jsonError } from "../../shared/errors.js";
import { typedJsonResponse } from "../../shared/responses.js";
import { findTenantById } from "../../shared/db-helpers.js";
import { getDb } from "../../db/client.js";
import { paginateByCursor, tenantScoped } from "../../db/queries.js";
import { PLAN_DEFINITIONS, normalizePlan } from "../../shared/plans.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function handleListAuditLogs(env: Env, url: URL, tenantId: string): Promise<Response> {
  const tenant = await findTenantById(env, tenantId);
  if (!tenant) return jsonError("Tenant not found", 404);

  const plan = normalizePlan(tenant.plan);
  if (!plan || !PLAN_DEFINITIONS[plan].audit_log_access) {
    return Response.json(
      {
        error: "Audit log access requires the Enterprise plan",
        code: "upgrade_required",
      },
      { status: 403 },
    );
  }

  const params = url.searchParams;
  const limitRaw = parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  // Validate optional from/to filters before they reach SQL — see
  // isIsoDateTime for why non-ISO values would silently misorder.
  const from = params.get("from");
  if (from && !isIsoDateTime(from)) return jsonError("from must be an ISO-8601 timestamp", 400);
  const to = params.get("to");
  if (to && !isIsoDateTime(to)) return jsonError("to must be an ISO-8601 timestamp", 400);

  // Decode cursor before any DB work so a malformed cursor 400s without
  // costing an unnecessary read.
  const cursorRaw = params.get("cursor");
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return jsonError("Invalid cursor", 400);

  const db = getDb(env.FP_DB);
  let query = tenantScoped(db, "audit_logs", tenantId);
  const actor = params.get("actor_user_id");
  if (actor) query = query.where("actor_user_id", "=", actor);
  const resourceType = params.get("resource_type");
  if (resourceType) query = query.where("resource_type", "=", resourceType);
  const resourceId = params.get("resource_id");
  if (resourceId) query = query.where("resource_id", "=", resourceId);
  const action = params.get("action");
  if (action) query = query.where("action", "=", action);
  if (from) query = query.where("created_at", ">=", from);
  if (to) query = query.where("created_at", "<=", to);

  const rows = await paginateByCursor(query, {
    cursor,
    limit,
    sortColumn: "created_at",
    idColumn: "id",
  })
    .select([
      "id",
      "tenant_id",
      "actor_user_id",
      "actor_api_key_id",
      "actor_email",
      "actor_ip",
      "actor_user_agent",
      "impersonator_user_id",
      "action",
      "resource_type",
      "resource_id",
      "status",
      "status_code",
      "metadata",
      "request_id",
      "created_at",
    ])
    .execute();

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

  const entries: AuditLogEntry[] = slice.map(rowToEntry);
  const payload: AuditLogListResponse = { entries, next_cursor: nextCursor };
  return typedJsonResponse(auditLogListResponseSchema, payload);
}

interface AuditRow {
  id: string;
  // Nullable in the storage schema (NULL = admin-scope row), but the
  // customer-facing query always filters `tenant_id = ?`, so rows
  // returned here will always have a non-null tenant_id in practice.
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_api_key_id: string | null;
  actor_email: string | null;
  actor_ip: string | null;
  actor_user_agent: string | null;
  impersonator_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  status: "success" | "failure";
  status_code: number | null;
  metadata: string | null;
  request_id: string | null;
  created_at: string;
}

function rowToEntry(row: AuditRow): AuditLogEntry {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }
  // The endpoint always queries `WHERE tenant_id = ?` so the result set
  // never includes admin-scope (NULL) rows. The `??` is just to satisfy
  // the non-null AuditLogEntry contract; the empty string is unreachable.
  return {
    id: row.id,
    tenant_id: row.tenant_id ?? "",
    actor: {
      user_id: row.actor_user_id,
      api_key_id: row.actor_api_key_id,
      email: row.actor_email,
      ip: row.actor_ip,
      user_agent: row.actor_user_agent,
      impersonator_user_id: row.impersonator_user_id,
    },
    action: row.action,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    status: row.status,
    status_code: row.status_code,
    metadata,
    request_id: row.request_id,
    created_at: row.created_at,
  };
}

/** Reject malformed `from`/`to` filters before they reach SQL.
 * audit_logs.created_at is TEXT and SQLite's lexicographic ordering only
 * matches chronological ordering when values are ISO-8601 strings —
 * non-ISO input would silently produce wrong results, not an error. */
function isIsoDateTime(value: string): boolean {
  // Full RFC3339: YYYY-MM-DDThh:mm:ss(.fff)?(Z|±hh:mm). Date-only or
  // timezone-less input would silently misorder against TEXT
  // lexicographic comparison (e.g., `to=2026-01-15` would exclude every
  // event later than midnight UTC on that day).
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`);
}

function decodeCursor(cursor: string): { created_at: string; id: string } | null {
  try {
    const decoded = atob(cursor);
    const sep = decoded.indexOf("|");
    if (sep === -1) return null;
    return { created_at: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}
