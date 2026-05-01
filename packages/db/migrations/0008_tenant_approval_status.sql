-- Tenant approval status for soft launch gating
-- New sign-ups start as 'pending' until admin approves

ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending', 'active', 'suspended'));

ALTER TABLE tenants ADD COLUMN approved_at TEXT;
ALTER TABLE tenants ADD COLUMN approved_by TEXT REFERENCES users(id);

-- Grandfather existing tenants to active (they predate soft launch gating)
UPDATE tenants SET status = 'active' WHERE status = 'pending';

-- Backfill NULL for existing rows
UPDATE tenants SET approved_at = datetime('now') WHERE status = 'active' AND approved_at IS NULL;
