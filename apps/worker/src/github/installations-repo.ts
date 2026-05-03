// D1-backed CRUD for the github_installations and installation_repositories
// tables.
//
// The install row holds account metadata and the tenant claim. Repos live
// in a normalized child table — INSERT and DELETE per-repo are inherently
// atomic and avoid the read-modify-write race that a JSON column invites.
//
// Schema:
//   github_installations      — one row per GitHub App install
//   installation_repositories — one row per (install, repo) grant
//
// The validation workflow looks up by (owner, repo) to find which
// installation token to mint and which tenant to attribute the rollout to.

import { sql } from "kysely";
import { getDb } from "../db/client.js";
import { compileForBatch } from "../db/queries.js";

/**
 * Build the TOCTOU-guarded INSERT used by both syncInstallationRepos and
 * updateInstallationRepos. Composes Kysely's INSERT framing + ON CONFLICT
 * upsert with a raw SELECT body that closes the TOCTOU window:
 *
 *   INSERT INTO installation_repositories (...)
 *   SELECT ?, ?, ?, ?
 *    WHERE EXISTS (
 *      SELECT 1 FROM github_installations WHERE installation_id = ?
 *    )
 *   ON CONFLICT(full_name) DO UPDATE SET ...
 *
 * If the parent installation row was deleted between the precheck above
 * and this batch executing, the SELECT yields zero rows and the INSERT
 * becomes a no-op rather than a 5xx from a violated FK.
 *
 * The SELECT body is a raw `sql` template because Kysely doesn't have a
 * clean "literal-values SELECT WHERE EXISTS" shape — using `sql` here is
 * the smallest deviation from the type-safe builder elsewhere.
 */
function insertRepoWithGuard(
  db: ReturnType<typeof getDb>,
  installationId: number,
  repo: InstallationRepo,
) {
  const branch = repo.default_branch ?? null;
  return db
    .insertInto("installation_repositories")
    .columns(["installation_id", "repo_id", "full_name", "default_branch"])
    .expression(
      sql<{
        installation_id: number;
        repo_id: number;
        full_name: string;
        default_branch: string | null;
      }>`SELECT ${installationId}, ${repo.id}, ${repo.full_name}, ${branch} WHERE EXISTS (SELECT 1 FROM github_installations WHERE installation_id = ${installationId})`,
    )
    .onConflict((oc) =>
      oc.column("full_name").doUpdateSet({
        installation_id: (eb) => eb.ref("excluded.installation_id"),
        repo_id: (eb) => eb.ref("excluded.repo_id"),
        default_branch: (eb) => eb.ref("excluded.default_branch"),
      }),
    );
}

interface DbEnv {
  FP_DB: D1Database;
}

export interface InstallationRepo {
  id: number;
  full_name: string;
  default_branch?: string;
}

export interface GithubInstallationRow {
  installation_id: number;
  account_login: string;
  account_type: "User" | "Organization";
  tenant_id: string | null;
  repos: InstallationRepo[];
  config_path: string;
  created_at: string;
  updated_at: string;
}

/**
 * Insert or update on the `installation` event (action: created or
 * unsuspend). Existing rows preserve their `tenant_id` and `config_path`
 * — the webhook only refreshes account metadata, not the user's claim.
 */
export async function upsertInstallation(
  env: DbEnv,
  row: {
    installation_id: number;
    account_login: string;
    account_type: "User" | "Organization";
  },
): Promise<void> {
  await getDb(env.FP_DB)
    .insertInto("github_installations")
    .values({
      installation_id: row.installation_id,
      account_login: row.account_login,
      account_type: row.account_type,
    })
    .onConflict((oc) =>
      oc.column("installation_id").doUpdateSet({
        account_login: (eb) => eb.ref("excluded.account_login"),
        account_type: (eb) => eb.ref("excluded.account_type"),
        updated_at: sql<string>`datetime('now')`,
      }),
    )
    .execute();
}

/**
 * Sync the full repo list for an installation. Called on the `installation`
 * event which carries the complete current set — we delete all and re-insert.
 * Idempotent per-repo via ON CONFLICT DO NOTHING.
 */
export async function syncInstallationRepos(
  env: DbEnv,
  installationId: number,
  repos: InstallationRepo[],
): Promise<void> {
  // Guard: if the installation row doesn't exist yet (GitHub can fire
  // installation_repositories before installation), there's nothing to sync.
  const exists = await getDb(env.FP_DB)
    .selectFrom("github_installations")
    .select("installation_id")
    .where("installation_id", "=", installationId)
    .executeTakeFirst();
  if (!exists) return;

  if (repos.length === 0) {
    // Nothing to sync but the install exists — clear any stale rows.
    await getDb(env.FP_DB)
      .deleteFrom("installation_repositories")
      .where("installation_id", "=", installationId)
      .execute();
    return;
  }

  // env.FP_DB.batch is the only way to commit multiple D1 statements
  // atomically (kysely-d1 doesn't support transactions); compileForBatch
  // keeps the type-safe builder. The WHERE EXISTS guard inside each
  // insert closes the TOCTOU window between the precheck above and this
  // batch executing.
  const db = getDb(env.FP_DB);
  await env.FP_DB.batch([
    compileForBatch(
      db.deleteFrom("installation_repositories").where("installation_id", "=", installationId),
      env.FP_DB,
    ),
    ...repos.map((r) => compileForBatch(insertRepoWithGuard(db, installationId, r), env.FP_DB)),
  ]);
}

/**
 * Apply an `installation_repositories` event. Add the new repos and
 * remove the dropped ones. Each INSERT/DELETE is inherently atomic —
 * no read-modify-write race, no optimistic retry loop needed.
 */
export async function updateInstallationRepos(
  env: DbEnv,
  installationId: number,
  added: InstallationRepo[],
  removed: InstallationRepo[],
): Promise<void> {
  // Check the installation exists — if not, the event arrived before the
  // installation row (GitHub can fire these in either order) or the
  // installation was deleted. Either way: nothing to update, and the FK
  // constraint would reject the inserts anyway.
  const exists = await getDb(env.FP_DB)
    .selectFrom("github_installations")
    .select("installation_id")
    .where("installation_id", "=", installationId)
    .executeTakeFirst();
  if (!exists) return;

  // Atomic batch — same rationale as syncInstallationRepos.
  const db = getDb(env.FP_DB);
  const stmts = [
    // Remove dropped repos.
    ...removed.map((r) =>
      compileForBatch(
        db
          .deleteFrom("installation_repositories")
          .where("installation_id", "=", installationId)
          .where("full_name", "=", r.full_name),
        env.FP_DB,
      ),
    ),
    // Add new repos. ON CONFLICT(full_name) handles repo transfer between
    // installations; WHERE EXISTS closes the TOCTOU window.
    ...added.map((r) => compileForBatch(insertRepoWithGuard(db, installationId, r), env.FP_DB)),
  ];
  if (stmts.length === 0) return;
  await env.FP_DB.batch(stmts);
}

async function reposForInstallation(
  env: DbEnv,
  installationId: number,
): Promise<InstallationRepo[]> {
  const rows = await getDb(env.FP_DB)
    .selectFrom("installation_repositories")
    .select(["repo_id", "full_name", "default_branch"])
    .where("installation_id", "=", installationId)
    .orderBy("full_name")
    .execute();
  return rows.map((r) => ({
    id: r.repo_id,
    full_name: r.full_name,
    ...(r.default_branch ? { default_branch: r.default_branch } : {}),
  }));
}

/** Look up by primary key, including all repos. */
export async function findInstallationById(
  env: DbEnv,
  installationId: number,
): Promise<GithubInstallationRow | null> {
  const row = await getDb(env.FP_DB)
    .selectFrom("github_installations")
    .select([
      "installation_id",
      "account_login",
      "account_type",
      "tenant_id",
      "config_path",
      "created_at",
      "updated_at",
    ])
    .where("installation_id", "=", installationId)
    .executeTakeFirst();
  if (!row) return null;
  return { ...row, repos: await reposForInstallation(env, installationId) };
}

/**
 * Find the installation that grants access to a given (owner, repo).
 * Direct primary-key lookup — no json_each scan.
 */
export async function findInstallationByRepo(
  env: DbEnv,
  fullName: string,
): Promise<GithubInstallationRow | null> {
  const row = await getDb(env.FP_DB)
    .selectFrom("github_installations as i")
    .innerJoin("installation_repositories as r", "r.installation_id", "i.installation_id")
    .select([
      "i.installation_id",
      "i.account_login",
      "i.account_type",
      "i.tenant_id",
      "i.config_path",
      "i.created_at",
      "i.updated_at",
    ])
    .where("r.full_name", "=", fullName)
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  return { ...row, repos: await reposForInstallation(env, row.installation_id) };
}

/** Set or clear the tenant claim on an installation (UI flow). */
export async function setInstallationTenant(
  env: DbEnv,
  installationId: number,
  tenantId: string | null,
): Promise<void> {
  await getDb(env.FP_DB)
    .updateTable("github_installations")
    .set({ tenant_id: tenantId, updated_at: sql<string>`datetime('now')` })
    .where("installation_id", "=", installationId)
    .execute();
}

/** Delete on `installation` (action: deleted). Idempotent. */
export async function deleteInstallation(env: DbEnv, installationId: number): Promise<void> {
  await getDb(env.FP_DB)
    .deleteFrom("github_installations")
    .where("installation_id", "=", installationId)
    .execute();
}
