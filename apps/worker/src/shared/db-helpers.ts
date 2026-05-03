/**
 * D1 query helpers shared by v1, admin, and auth route handlers.
 *
 * Goals:
 * - Stop repeating the same SELECT * / DELETE / count queries inline
 *   across every handler that touches a tenant or configuration.
 * - Concentrate column projections in one place so a future change
 *   (e.g. a new tenant column or an index-friendly LIKE clause) only
 *   updates one site.
 *
 * As of the Kysely migration, every helper here is built with the type-safe
 * query builder, composed from primitives in `../db/queries.ts` where the
 * shape repeats. The compiled SQL is a 1:1 mapping with the previous inline
 * strings — no new query semantics. New helpers should follow the same
 * pattern. Existing call sites that still use `env.FP_DB.prepare(...)` keep
 * working; they migrate one route file at a time.
 */

import { getDb } from "../db/client.js";
import { compileForBatch, existsBy, tenantScoped } from "../db/queries.js";
import type { Configuration, Tenant } from "../db/schema.js";

interface DbEnv {
  FP_DB: D1Database;
}

/**
 * @deprecated Prefer the precise `Tenant` type from `db/schema.ts`. Kept
 * to avoid breaking call sites that imported `TenantRow` directly.
 */
export type TenantRow = Tenant & { [key: string]: unknown };

/**
 * @deprecated Prefer `Configuration` from `db/schema.ts`. Kept for the same
 * reason as `TenantRow`.
 */
export type ConfigurationRow = Configuration & { [key: string]: unknown };

/**
 * Look up a tenant row by id. Returns `null` when the tenant doesn't
 * exist. Replaces the inline `SELECT * FROM tenants WHERE id = ?` that
 * appeared in 7+ handlers.
 */
export async function findTenantById(env: DbEnv, tenantId: string): Promise<TenantRow | null> {
  const row = await getDb(env.FP_DB)
    .selectFrom("tenants")
    .selectAll()
    .where("id", "=", tenantId)
    .executeTakeFirst();
  return (row as TenantRow | undefined) ?? null;
}

/**
 * Cheap "does this tenant exist?" check. For preflight checks where the
 * row contents don't matter.
 */
export async function tenantExists(env: DbEnv, tenantId: string): Promise<boolean> {
  return existsBy(getDb(env.FP_DB).selectFrom("tenants").where("id", "=", tenantId));
}

/**
 * Delete a tenant by id. Returns the underlying D1 result so callers can
 * read `meta.changes` to tell whether the row existed without a prefetch
 * SELECT. Built via Kysely + compileForBatch so the column reference is
 * type-checked, then executed against D1 directly to expose `D1Result.meta`
 * (which Kysely's executors don't surface).
 */
export async function deleteTenantById(env: DbEnv, tenantId: string): Promise<D1Result> {
  return compileForBatch(
    getDb(env.FP_DB).deleteFrom("tenants").where("id", "=", tenantId),
    env.FP_DB,
  ).run();
}

/**
 * Look up a configuration scoped to a tenant. Returns `null` when the
 * configuration doesn't exist or belongs to another tenant.
 *
 * Projection trimmed to the fields handlers post-existence-check
 * actually use; full `SELECT *` was unnecessary for write paths
 * (PERF-CRIT-15 / #333).
 */
export async function findOwnedConfig(
  env: DbEnv,
  tenantId: string,
  configId: string,
): Promise<ConfigurationRow | null> {
  const row = await tenantScoped(getDb(env.FP_DB), "configurations", tenantId)
    .where("id", "=", configId)
    .select([
      "id",
      "tenant_id",
      "name",
      "description",
      "current_config_hash",
      "created_at",
      "updated_at",
    ])
    .executeTakeFirst();
  return (row as ConfigurationRow | undefined) ?? null;
}

/**
 * Count configurations for a tenant. Used by quota enforcement before
 * creating a new configuration.
 */
export async function countConfigsForTenant(env: DbEnv, tenantId: string): Promise<number> {
  const row = await tenantScoped(getDb(env.FP_DB), "configurations", tenantId)
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .executeTakeFirst();
  return row?.count ?? 0;
}

/**
 * List configurations for a tenant, newest first. Returns the columns
 * the portal/list views need.
 */
export async function listConfigsForTenant(
  env: DbEnv,
  tenantId: string,
): Promise<ConfigurationRow[]> {
  const rows = await tenantScoped(getDb(env.FP_DB), "configurations", tenantId)
    .select([
      "id",
      "name",
      "description",
      "current_config_hash",
      "tenant_id",
      "created_at",
      "updated_at",
    ])
    .orderBy("created_at", "desc")
    .execute();
  return rows as ConfigurationRow[];
}
