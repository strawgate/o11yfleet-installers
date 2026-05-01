-- Pending enrollment tokens for devices that haven't been assigned to a configuration yet.
-- Route: fp_pending_<hash> → D1 lookup → tenant:__pending__ DO.

CREATE TABLE IF NOT EXISTS pending_tokens (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  label TEXT,
  target_config_id TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_pending_tokens_tenant ON pending_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pending_tokens_hash ON pending_tokens(token_hash);
