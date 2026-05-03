// Reusable query primitives composed from Kysely.
//
// These exist because the same WHERE shapes (`tenant_id = ?`, the audit-log
// INSERT shape, existence checks) repeat across 80+ call sites in the route
// handlers. Inlining them everywhere produces drift; wrapping them here
// keeps the SQL identical at every call site and makes a future change
// (e.g. adding a soft-delete filter on tenants) one edit instead of forty.
//
// Design rules:
//
// 1. **Return a Kysely chain, not an awaited result.** Helpers return a
//    builder you finish with `.selectAll()`/`.select([...])`/`.execute()`
//    so the type checker knows exactly which columns the caller picked.
//    No "blob" abstractions that hide the SELECT projection.
// 2. **One SQL statement per call.** Same write-sensitivity rule as
//    Kysely itself: every helper compiles to one statement. No relations
//    API, no eager-loading.
// 3. **No business logic.** These are SQL shape primitives. Business
//    rules (quota enforcement, plan gating, audit recording) live in
//    the route or domain modules above this layer.

import {
  sql,
  type Compilable,
  type Insertable,
  type Kysely,
  type SelectQueryBuilder,
} from "kysely";
import type { AuditLogTable, Database } from "./schema.js";

/** Tables that have a `tenant_id` column. */
export type TenantScopedTable =
  | "configurations"
  | "config_versions"
  | "enrollment_tokens"
  | "agent_summaries"
  | "audit_logs"
  | "users"
  | "pending_tokens";

/**
 * Start a SELECT against a tenant-scoped table, pre-filtered to a tenant.
 * Caller picks the projection and any extra WHERE/ORDER/LIMIT.
 *
 *     const configs = await tenantScoped(db, "configurations", tenantId)
 *       .select(["id", "name", "current_config_hash"])
 *       .orderBy("created_at", "desc")
 *       .execute();
 */
export function tenantScoped<T extends TenantScopedTable>(
  db: Kysely<Database>,
  table: T,
  tenantId: string,
): SelectQueryBuilder<Database, T, Record<string, never>> {
  // The double cast through `unknown` lets us bypass Kysely's overload
  // resolution on the column reference. Constraining `T` to the
  // `TenantScopedTable` union is what makes this safe at runtime — every
  // table named there has the `tenant_id` column.
  const builder = db.selectFrom(table) as unknown as SelectQueryBuilder<
    Database,
    T,
    Record<string, never>
  > & {
    where(
      col: "tenant_id",
      op: "=",
      value: string,
    ): SelectQueryBuilder<Database, T, Record<string, never>>;
  };
  return builder.where("tenant_id", "=", tenantId);
}

/**
 * Existence check. Runs the chain with `select 1` + `LIMIT 1` and returns
 * a boolean. Use this instead of `selectAll` when you only need to know
 * whether a row exists.
 *
 *     const exists = await existsBy(
 *       tenantScoped(db, "configurations", tenantId).where("id", "=", configId),
 *     );
 */
export async function existsBy<DB, TB extends keyof DB & string, O>(
  query: SelectQueryBuilder<DB, TB, O>,
): Promise<boolean> {
  const row = await query
    .select(sql<number>`1`.as("present"))
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Audit-log INSERT, idempotent on `id` so queue redelivery is safe. Returns
 * a Kysely insert chain so the caller can `.execute()` for a single write.
 *
 * Note: the queue consumer's batched path uses `env.FP_DB.batch([...])`
 * with raw `D1PreparedStatement`s — Kysely's batch behaviour on D1 isn't
 * equivalent to D1's atomic `batch()`, and the consumer needs the latter.
 */
export function insertAuditLog(db: Kysely<Database>, row: Insertable<AuditLogTable>) {
  return db
    .insertInto("audit_logs")
    .values(row)
    .onConflict((oc) => oc.column("id").doNothing());
}

/**
 * Compile a Kysely query into a `D1PreparedStatement` so it can be passed
 * to `env.FP_DB.batch([...])` for atomic execution.
 *
 * Why this exists: `kysely-d1@0.4.0` does NOT support transactions
 * (`beginTransaction()` literally throws "Transactions are not supported
 * yet."). The only way to commit multiple statements atomically on D1 is
 * its native `batch()` API, which takes `D1PreparedStatement`s. This
 * helper bridges the two: build statements with Kysely's type-safe
 * builder, then feed them into D1's atomic batch.
 *
 *     await env.FP_DB.batch([
 *       compileForBatch(db.insertInto("config_versions").values({...}), env.FP_DB),
 *       compileForBatch(db.updateTable("configurations").set({...}).where(...), env.FP_DB),
 *     ]);
 *
 * Compiled SQL has been spot-checked against the previous hand-rolled
 * forms and is semantically identical (Kysely emits `?` instead of `?1`
 * and parameterizes some literals that were inline, but the planner
 * receives the same query).
 */
export function compileForBatch(query: Compilable, d1: D1Database): D1PreparedStatement {
  const compiled = query.compile();
  return d1.prepare(compiled.sql).bind(...compiled.parameters);
}

/**
 * Composite-key cursor pagination on `(created_at, id)`. Appends
 * `(created_at < ? OR (created_at = ? AND id < ?))`, `ORDER BY
 * created_at DESC, id DESC`, and `LIMIT (limit + 1)` so the caller
 * answers "is there a next page?" from the over-fetch in the same
 * round-trip — no separate COUNT.
 *
 *     const rows = await paginateByCursor(
 *       tenantScoped(db, "audit_logs", tenantId),
 *       { cursor, limit },
 *     )
 *       .select([...])
 *       .execute();
 *     const hasMore = rows.length > limit;
 *     const slice = hasMore ? rows.slice(0, limit) : rows;
 *
 * Hardcoded to `(created_at, id)` because that's the only sort key
 * we paginate by today. The cursor carries the column values, so its
 * shape has to follow the column names — generalizing to arbitrary
 * columns would have to either thread a generic through the cursor
 * type or accept a silent shape/column mismatch. When a second caller
 * actually needs different columns, generalize then.
 */
export interface CursorOptions {
  /** Decoded cursor (`null`/`undefined` = first page). */
  cursor: { created_at: string; id: string } | null | undefined;
  /** Page size (caller bounds this). The query fetches `limit + 1` rows. */
  limit: number;
}

export function paginateByCursor<DB, TB extends keyof DB & string, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  opts: CursorOptions,
): SelectQueryBuilder<DB, TB, O> {
  let next = query;
  if (opts.cursor) {
    const { created_at, id } = opts.cursor;
    next = next.where(
      sql<boolean>`(${sql.ref("created_at")} < ${created_at} OR (${sql.ref("created_at")} = ${created_at} AND ${sql.ref("id")} < ${id}))`,
    ) as typeof next;
  }
  return next
    .orderBy(sql.ref("created_at"), "desc")
    .orderBy(sql.ref("id"), "desc")
    .limit(opts.limit + 1) as SelectQueryBuilder<DB, TB, O>;
}
