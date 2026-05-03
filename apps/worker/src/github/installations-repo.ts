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

interface RawInstallationRow {
  installation_id: number;
  account_login: string;
  account_type: "User" | "Organization";
  tenant_id: string | null;
  config_path: string;
  created_at: string;
  updated_at: string;
}

interface RawRepoRow {
  repo_id: number;
  full_name: string;
  default_branch: string | null;
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
  await env.FP_DB.prepare(
    `INSERT INTO github_installations (installation_id, account_login, account_type)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(installation_id) DO UPDATE SET
       account_login = excluded.account_login,
       account_type = excluded.account_type,
       updated_at = datetime('now')`,
  )
    .bind(row.installation_id, row.account_login, row.account_type)
    .run();
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
  const exists = await env.FP_DB.prepare(
    `SELECT 1 FROM github_installations WHERE installation_id = ?1`,
  )
    .bind(installationId)
    .first();
  if (!exists) return;

  if (repos.length === 0) {
    // Nothing to sync but the install exists — clear any stale rows.
    await env.FP_DB.prepare(`DELETE FROM installation_repositories WHERE installation_id = ?1`)
      .bind(installationId)
      .run();
    return;
  }

  // Batch: delete all existing repos for this install, then re-insert.
  // Uses a single D1 batch so both happen atomically — either both succeed
  // or neither does.
  const stmts = [
    env.FP_DB.prepare(`DELETE FROM installation_repositories WHERE installation_id = ?1`).bind(
      installationId,
    ),
    ...repos.map((r) =>
      env.FP_DB.prepare(
        // ON CONFLICT(full_name) handles the case where a repo was
        // transferred to a different installation — we move ownership
        // to the new one rather than silently dropping the insert,
        // which would let findInstallationByRepo keep resolving the
        // stale (wrong) installation.
        //
        // The WHERE EXISTS guard closes the TOCTOU window between the
        // SELECT-1 precheck above and this batch executing: if the parent
        // install is concurrently deleted, the row simply isn't inserted
        // and the late `installation_repositories` event becomes a no-op
        // instead of a 5xx from a violated FK.
        `INSERT INTO installation_repositories
           (installation_id, repo_id, full_name, default_branch)
         SELECT ?1, ?2, ?3, ?4
          WHERE EXISTS (
            SELECT 1 FROM github_installations WHERE installation_id = ?1
          )
         ON CONFLICT(full_name) DO UPDATE SET
           installation_id = excluded.installation_id,
           repo_id = excluded.repo_id,
           default_branch = excluded.default_branch`,
      ).bind(installationId, r.id, r.full_name, r.default_branch ?? null),
    ),
  ];
  await env.FP_DB.batch(stmts);
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
  const exists = await env.FP_DB.prepare(
    `SELECT 1 FROM github_installations WHERE installation_id = ?1`,
  )
    .bind(installationId)
    .first();
  if (!exists) return;

  const stmts = [
    // Remove dropped repos.
    ...removed.map((r) =>
      env.FP_DB.prepare(
        `DELETE FROM installation_repositories
         WHERE installation_id = ?1 AND full_name = ?2`,
      ).bind(installationId, r.full_name),
    ),
    // Add new repos. ON CONFLICT DO NOTHING makes re-delivery of the same
    // event idempotent — the repo is already there, so skip.
    ...added.map((r) =>
      env.FP_DB.prepare(
        // ON CONFLICT(full_name) handles the case where a repo was
        // transferred to a different installation — we move ownership
        // to the new one rather than silently dropping the insert,
        // which would let findInstallationByRepo keep resolving the
        // stale (wrong) installation.
        //
        // The WHERE EXISTS guard closes the TOCTOU window between the
        // SELECT-1 precheck above and this batch executing: if the parent
        // install is concurrently deleted, the row simply isn't inserted
        // and the late `installation_repositories` event becomes a no-op
        // instead of a 5xx from a violated FK.
        `INSERT INTO installation_repositories
           (installation_id, repo_id, full_name, default_branch)
         SELECT ?1, ?2, ?3, ?4
          WHERE EXISTS (
            SELECT 1 FROM github_installations WHERE installation_id = ?1
          )
         ON CONFLICT(full_name) DO UPDATE SET
           installation_id = excluded.installation_id,
           repo_id = excluded.repo_id,
           default_branch = excluded.default_branch`,
      ).bind(installationId, r.id, r.full_name, r.default_branch ?? null),
    ),
  ];
  if (stmts.length === 0) return;
  await env.FP_DB.batch(stmts);
}

/** Look up by primary key, including all repos. */
export async function findInstallationById(
  env: DbEnv,
  installationId: number,
): Promise<GithubInstallationRow | null> {
  const row = await env.FP_DB.prepare(
    `SELECT installation_id, account_login, account_type, tenant_id,
            config_path, created_at, updated_at
       FROM github_installations
      WHERE installation_id = ?1`,
  )
    .bind(installationId)
    .first<RawInstallationRow>();
  if (!row) return null;

  const repos = await env.FP_DB.prepare(
    `SELECT repo_id, full_name, default_branch
       FROM installation_repositories
      WHERE installation_id = ?1
      ORDER BY full_name`,
  )
    .bind(installationId)
    .all<RawRepoRow>();
  return {
    ...row,
    repos: repos.results.map((r) => ({
      id: r.repo_id,
      full_name: r.full_name,
      ...(r.default_branch ? { default_branch: r.default_branch } : {}),
    })),
  };
}

/**
 * Find the installation that grants access to a given (owner, repo).
 * Direct primary-key lookup — no json_each scan.
 */
export async function findInstallationByRepo(
  env: DbEnv,
  fullName: string,
): Promise<GithubInstallationRow | null> {
  const row = await env.FP_DB.prepare(
    `SELECT i.installation_id, i.account_login, i.account_type,
            i.tenant_id, i.config_path, i.created_at, i.updated_at
       FROM github_installations i
       JOIN installation_repositories r
         ON r.installation_id = i.installation_id
      WHERE r.full_name = ?
      LIMIT 1`,
  )
    .bind(fullName)
    .first<RawInstallationRow>();
  if (!row) return null;

  const repos = await env.FP_DB.prepare(
    `SELECT repo_id, full_name, default_branch
       FROM installation_repositories
      WHERE installation_id = ?1
      ORDER BY full_name`,
  )
    .bind(row.installation_id)
    .all<RawRepoRow>();
  return {
    ...row,
    repos: repos.results.map((r) => ({
      id: r.repo_id,
      full_name: r.full_name,
      ...(r.default_branch ? { default_branch: r.default_branch } : {}),
    })),
  };
}

/** Set or clear the tenant claim on an installation (UI flow). */
export async function setInstallationTenant(
  env: DbEnv,
  installationId: number,
  tenantId: string | null,
): Promise<void> {
  await env.FP_DB.prepare(
    `UPDATE github_installations
        SET tenant_id = ?2, updated_at = datetime('now')
      WHERE installation_id = ?1`,
  )
    .bind(installationId, tenantId)
    .run();
}

/** Delete on `installation` (action: deleted). Idempotent. */
export async function deleteInstallation(env: DbEnv, installationId: number): Promise<void> {
  await env.FP_DB.prepare(`DELETE FROM github_installations WHERE installation_id = ?`)
    .bind(installationId)
    .run();
}
