-- Speed up active impersonation session counts in the admin health endpoint.

CREATE INDEX IF NOT EXISTS idx_sessions_impersonation_expires
  ON sessions(is_impersonation, expires_at);
