-- o11yfleet D1 schema (consolidated from migrations 0001-0008).
-- Pre-launch project; old migration files were squashed into this single
-- baseline. Existing D1 databases must be reset before applying — see
-- packages/db/README.md for the wipe-and-reapply procedure.

-- ─── Tenants ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  plan                  TEXT NOT NULL DEFAULT 'starter'
                        CHECK(plan IN ('hobby', 'pro', 'starter', 'growth', 'enterprise')),
  max_configs           INTEGER NOT NULL DEFAULT 1
                        CHECK(max_configs >= 0),
  max_agents_per_config INTEGER NOT NULL DEFAULT 1000
                        CHECK(max_agents_per_config >= 0),
  geo_enabled           INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending', 'active', 'suspended')),
  approved_at           TEXT,
  -- approved_by is a soft reference to users(id); we don't declare it as a
  -- TEXT REFERENCES users(id) here because users.tenant_id already references
  -- tenants(id), and SQLite cannot resolve a circular foreign key at CREATE
  -- time. Application code is the source of truth for this link.
  approved_by           TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Users + sessions + auth identities ────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member'
                CHECK(role IN ('member', 'admin')),
  tenant_id     TEXT REFERENCES tenants(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at       TEXT NOT NULL,
  is_impersonation INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user                  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires               ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_impersonation_expires ON sessions(is_impersonation, expires_at);

CREATE TABLE IF NOT EXISTS auth_identities (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_login   TEXT,
  provider_email   TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);

-- ─── Configurations + versions + agents ────────────────────────────────────

CREATE TABLE IF NOT EXISTS configurations (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  name                TEXT NOT NULL,
  description         TEXT,
  current_config_hash TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_configurations_tenant ON configurations(tenant_id);

CREATE TABLE IF NOT EXISTS config_versions (
  id          TEXT PRIMARY KEY,
  config_id   TEXT NOT NULL REFERENCES configurations(id),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  config_hash TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(config_id, config_hash)
);
CREATE INDEX IF NOT EXISTS idx_config_versions_config ON config_versions(config_id);

CREATE TABLE IF NOT EXISTS enrollment_tokens (
  id          TEXT PRIMARY KEY,
  config_id   TEXT NOT NULL REFERENCES configurations(id),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  token_hash  TEXT NOT NULL UNIQUE,
  label       TEXT,
  expires_at  TEXT,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_hash   ON enrollment_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_config ON enrollment_tokens(config_id);

-- Pending enrollment tokens for devices that haven't been assigned to a configuration yet.
-- Route: fp_pending_<hash> → D1 lookup → tenant:__pending__ DO.
CREATE TABLE IF NOT EXISTS pending_tokens (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id        TEXT NOT NULL,
  token_hash       TEXT NOT NULL,
  label            TEXT,
  target_config_id TEXT,
  expires_at       TEXT,
  revoked_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, token_hash)
);
CREATE INDEX IF NOT EXISTS idx_pending_tokens_tenant ON pending_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pending_tokens_hash   ON pending_tokens(token_hash);

CREATE TABLE IF NOT EXISTS agent_summaries (
  instance_uid        TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  config_id           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'unknown'
                      CHECK(status IN ('connected', 'disconnected', 'unknown')),
  healthy             INTEGER NOT NULL DEFAULT 1,
  current_config_hash TEXT,
  last_seen_at        TEXT,
  connected_at        TEXT,
  disconnected_at     TEXT,
  agent_description   TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_summaries_config ON agent_summaries(config_id);
CREATE INDEX IF NOT EXISTS idx_agent_summaries_tenant ON agent_summaries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_summaries_status ON agent_summaries(status);
