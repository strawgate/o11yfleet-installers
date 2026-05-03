-- ─── GitHub App installations ──────────────────────────────────────────────
--
-- One row per (account, install_of_o11yfleet_app). Created on
-- `installation` event (action: created), deleted on `installation`
-- (action: deleted). The `installation_repositories` table below holds
-- the repo grants — one row per (install, repo).
--
-- `tenant_id` is nullable: an install may exist before any tenant has
-- claimed it. The link happens in a separate UI step ("Connect this org
-- to tenant X"). On webhook arrival, we look up by repo via the indexed
-- JOIN below and reject if `tenant_id IS NULL` (unconnected install, no
-- authorization to do work).

CREATE TABLE IF NOT EXISTS github_installations (
  installation_id INTEGER PRIMARY KEY,
  account_login   TEXT NOT NULL,
  account_type    TEXT NOT NULL CHECK(account_type IN ('User', 'Organization')),
  tenant_id       TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  -- The single config file path within each repo we watch for GitOps.
  -- Defaults to o11yfleet/config.yaml on first connect; user-overridable
  -- via tenant settings UI.
  config_path     TEXT NOT NULL DEFAULT 'o11yfleet/config.yaml',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_github_installations_tenant_id
  ON github_installations(tenant_id);

CREATE INDEX IF NOT EXISTS idx_github_installations_account_login
  ON github_installations(account_login);

-- ─── Normalized installation repositories ─────────────────────────────────
--
-- One row per (install, repo) grant from GitHub. Per-repo INSERT/DELETE is
-- inherently atomic — no read-modify-write race on installation_repositories
-- events, and no json_each scans for repo-to-installation lookups. The
-- unique index on full_name ensures no two installations can claim the
-- same repo, and ON DELETE CASCADE keeps this clean when an install is
-- deleted.

CREATE TABLE IF NOT EXISTS installation_repositories (
  installation_id INTEGER NOT NULL
    REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  repo_id         INTEGER NOT NULL,
  full_name       TEXT NOT NULL,
  default_branch  TEXT,
  PRIMARY KEY (installation_id, repo_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_installation_repositories_full_name
  ON installation_repositories(full_name);
