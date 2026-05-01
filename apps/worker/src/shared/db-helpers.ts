/**
 * D1 query helpers shared by v1, admin, and auth route handlers.
 *
 * Goals:
 * - Stop repeating the same SELECT * / DELETE / count queries inline
 *   across every handler that touches a tenant or configuration.
 * - Concentrate column projections in one place so a future change
 *   (e.g. a new tenant column or an index-friendly LIKE clause) only
 *   updates one site.
 * - No new query semantics — every helper here is a literal extraction
 *   of an existing inline SQL string.
 */

interface DbEnv {
  FP_DB: D1Database;
}

/** Full tenant row. Columns mirror the `tenants` table. */
export interface TenantRow {
  id: string;
  name: string;
  plan: string;
  max_configs: number;
  max_agents_per_config: number;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/** Configuration row trimmed to columns route handlers actually read. */
export interface ConfigurationRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  current_config_hash: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/**
 * Look up a tenant row by id. Returns `null` when the tenant doesn't
 * exist. Replaces the inline `SELECT * FROM tenants WHERE id = ?` that
 * appeared in 7+ handlers.
 */
export async function findTenantById(env: DbEnv, tenantId: string): Promise<TenantRow | null> {
  return env.FP_DB.prepare(`SELECT * FROM tenants WHERE id = ?`).bind(tenantId).first<TenantRow>();
}

/**
 * Cheap "does this tenant exist?" check that returns only the id.
 * For preflight checks where the row contents don't matter.
 */
export async function tenantExists(env: DbEnv, tenantId: string): Promise<boolean> {
  const row = await env.FP_DB.prepare(`SELECT id FROM tenants WHERE id = ? LIMIT 1`)
    .bind(tenantId)
    .first<{ id: string }>();
  return row !== null;
}

/**
 * Delete a tenant by id. The `D1Result` lets callers tell whether the
 * row existed (`meta.changes === 1`) without a prefetch SELECT.
 */
export async function deleteTenantById(env: DbEnv, tenantId: string): Promise<D1Result> {
  return env.FP_DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(tenantId).run();
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
  return env.FP_DB.prepare(
    `SELECT id, tenant_id, name, description, current_config_hash, created_at, updated_at
     FROM configurations WHERE id = ? AND tenant_id = ?`,
  )
    .bind(configId, tenantId)
    .first<ConfigurationRow>();
}

/**
 * Count configurations for a tenant. Used by quota enforcement before
 * creating a new configuration.
 */
export async function countConfigsForTenant(env: DbEnv, tenantId: string): Promise<number> {
  const row = await env.FP_DB.prepare(
    `SELECT COUNT(*) as count FROM configurations WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{ count: number }>();
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
  const result = await env.FP_DB.prepare(
    `SELECT id, name, description, current_config_hash, tenant_id, created_at, updated_at
     FROM configurations WHERE tenant_id = ? ORDER BY created_at DESC`,
  )
    .bind(tenantId)
    .all<ConfigurationRow>();
  return result.results;
}
