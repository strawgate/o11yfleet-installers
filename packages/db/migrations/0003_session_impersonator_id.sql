-- Track the real admin who initiated an impersonation session.
-- Without this column, audit logs can only see the synthetic
-- `impersonation+<tenantId>@o11yfleet.local` user; we cannot attribute
-- the action back to the actual support operator. The audit middleware
-- reads this column when building the v1 actor for impersonated
-- requests so customer audit logs surface the real admin.

ALTER TABLE sessions ADD COLUMN impersonator_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_impersonator
  ON sessions(impersonator_user_id) WHERE impersonator_user_id IS NOT NULL;
