-- o11yfleet D1 Schema — v001
-- Tenants, configurations, config versions, enrollment tokens, agent summaries

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'pro', 'enterprise')),
  max_configs INTEGER NOT NULL DEFAULT 5,
  max_agents_per_config INTEGER NOT NULL DEFAULT 50000,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS configurations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  current_config_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_configurations_tenant ON configurations(tenant_id);

CREATE TABLE IF NOT EXISTS config_versions (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL REFERENCES configurations(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  config_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(config_id, config_hash)
);

CREATE INDEX IF NOT EXISTS idx_config_versions_config ON config_versions(config_id);

CREATE TABLE IF NOT EXISTS enrollment_tokens (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL REFERENCES configurations(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_hash ON enrollment_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_config ON enrollment_tokens(config_id);

CREATE TABLE IF NOT EXISTS agent_summaries (
  instance_uid TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  config_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('connected', 'disconnected', 'unknown')),
  healthy INTEGER NOT NULL DEFAULT 1,
  current_config_hash TEXT,
  last_seen_at TEXT,
  connected_at TEXT,
  disconnected_at TEXT,
  agent_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_summaries_config ON agent_summaries(config_id);
CREATE INDEX IF NOT EXISTS idx_agent_summaries_tenant ON agent_summaries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_summaries_status ON agent_summaries(status);
