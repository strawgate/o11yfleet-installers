-- Audit log of user-initiated actions across v1 (tenant) and admin routes.
-- Records are always written for every tenant; visibility to the customer
-- (via API + UI) is plan-gated to enterprise.

CREATE TABLE IF NOT EXISTS audit_logs (
  id                    TEXT PRIMARY KEY,
  -- NULL means the event is admin-scoped (platform action not tied to a
  -- customer). The recorder maps an `AuditScope` discriminated union to
  -- this column at the storage boundary, so there's no sentinel string
  -- like "__admin__" floating through the code.
  tenant_id             TEXT,
  actor_user_id         TEXT,
  actor_api_key_id      TEXT,
  actor_email           TEXT,
  actor_ip              TEXT,
  actor_user_agent      TEXT,
  -- Set when an admin is impersonating the tenant; the customer audit log
  -- shows these so they can see when support touched their tenant.
  impersonator_user_id  TEXT,
  action                TEXT NOT NULL,
  resource_type         TEXT NOT NULL,
  resource_id           TEXT,
  status                TEXT NOT NULL CHECK(status IN ('success', 'failure')),
  -- HTTP-status-shaped: Zod validates on read; the CHECK keeps the
  -- storage layer honest in case a future call site bypasses the
  -- producer helpers and writes directly.
  status_code           INTEGER CHECK(status_code IS NULL
                                      OR (status_code >= 100 AND status_code <= 599)),
  metadata              TEXT,
  request_id            TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tie-breaker on id matches the read endpoint's ORDER BY (tenant_id,
-- created_at DESC, id DESC) so cursor pagination doesn't fall back to a
-- temp sort on tied timestamps.
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON audit_logs(tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON audit_logs(tenant_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs(tenant_id, actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs(tenant_id, action, created_at DESC);
-- Admin-scope rows have tenant_id NULL; partial index makes the
-- platform-wide admin audit query fast without bloating the main index.
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_created
  ON audit_logs(created_at DESC, id DESC) WHERE tenant_id IS NULL;
