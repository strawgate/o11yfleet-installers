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

import { sql, type Insertable, type Kysely, type SelectQueryBuilder } from "kysely";
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
  // The `as any` cast on the column reference is unavoidable: TypeScript
  // can't carry "every table in TenantScopedTable has a tenant_id column"
  // through Kysely's deeply-generic where overloads, so the call site
  // becomes ambiguous. Constraining `T` to the union above is what makes
  // this safe at runtime — every table named there does have the column.
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
 * Composite-key cursor pagination. Adds the standard
 * `(<sort_col> < ? OR (<sort_col> = ? AND <id_col> < ?))` filter to a
 * Kysely select, plus the matching `ORDER BY <sort_col> DESC, <id_col> DESC`
 * and `LIMIT <limit + 1>`. Caller handles deciding `hasMore` from the
 * over-fetch and slicing the result.
 *
 *     const rows = await paginateByCursor(
 *       tenantScoped(db, "audit_logs", tenantId),
 *       { cursor, limit, sortColumn: "created_at", idColumn: "id" },
 *     )
 *       .select([...])
 *       .execute();
 *     const hasMore = rows.length > limit;
 *     const slice = hasMore ? rows.slice(0, limit) : rows;
 *
 * The over-fetch (`limit + 1`) lets the caller answer "is there a next
 * page?" in the same round-trip as the page itself, avoiding a separate
 * COUNT query.
 *
 * Cursor format is the caller's concern — typically `${createdAt}|${id}`
 * base64-encoded. Pass the decoded shape as `{ created_at, id }`.
 */
export interface CursorOptions<S extends string, I extends string> {
  /** Decoded cursor (`null`/`undefined` = first page). */
  cursor: { created_at: string; id: string } | null | undefined;
  /** Page size (caller bounds this). The query fetches `limit + 1` rows. */
  limit: number;
  /** Column carrying the sort timestamp. Almost always `"created_at"`. */
  sortColumn: S;
  /** Column carrying the tiebreaker id. Almost always `"id"`. */
  idColumn: I;
}

export function paginateByCursor<DB, TB extends keyof DB & string, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  opts: CursorOptions<string, string>,
): SelectQueryBuilder<DB, TB, O> {
  let next = query;
  if (opts.cursor) {
    const { created_at, id } = opts.cursor;
    // Bypass Kysely's where overload generics — the caller declares the
    // sort/id columns as plain strings, and we know the SQL we want
    // ((sort < ?) OR (sort = ? AND id < ?)). Use sql.raw with bound
    // identifiers instead of trying to thread column-name generics
    // through the type system.
    next = next.where(
      sql<boolean>`(${sql.ref(opts.sortColumn)} < ${created_at} OR (${sql.ref(opts.sortColumn)} = ${created_at} AND ${sql.ref(opts.idColumn)} < ${id}))`,
    ) as typeof next;
  }
  return next
    .orderBy(sql.ref(opts.sortColumn), "desc")
    .orderBy(sql.ref(opts.idColumn), "desc")
    .limit(opts.limit + 1) as SelectQueryBuilder<DB, TB, O>;
}
