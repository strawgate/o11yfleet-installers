/**
 * D1 schema bootstrap shared across GitHub-related test suites.
 *
 * Mirrors the production migration in
 * `packages/db/migrations/0003_normalize_installation_repos.sql`.
 * Both workerd-pool tests (github-webhook, github-workflow-kick) and the
 * plain-node `github-installations-repo` test use this so schema changes
 * need to be updated in one place.
 */

import type { D1Database } from "@cloudflare/workers-types";

export async function bootstrapSchema(db: D1Database): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY)`);
  await db.exec(
    `CREATE TABLE IF NOT EXISTS github_installations (` +
      `installation_id INTEGER PRIMARY KEY, ` +
      `account_login TEXT NOT NULL, ` +
      `account_type TEXT NOT NULL CHECK(account_type IN ('User', 'Organization')), ` +
      `tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL, ` +
      `config_path TEXT NOT NULL DEFAULT 'o11yfleet/config.yaml', ` +
      `created_at TEXT NOT NULL DEFAULT (datetime('now')), ` +
      `updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS installation_repositories (` +
      `installation_id INTEGER NOT NULL ` +
      `REFERENCES github_installations(installation_id) ON DELETE CASCADE, ` +
      `repo_id INTEGER NOT NULL, ` +
      `full_name TEXT NOT NULL, ` +
      `default_branch TEXT, ` +
      `PRIMARY KEY (installation_id, repo_id))`,
  );
  await db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_installation_repositories_full_name ` +
      `ON installation_repositories(full_name)`,
  );
}
