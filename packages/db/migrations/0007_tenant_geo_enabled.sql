-- Add geo_enabled flag to tenants for geo-IP opt-in

ALTER TABLE tenants ADD COLUMN geo_enabled INTEGER NOT NULL DEFAULT 0;
