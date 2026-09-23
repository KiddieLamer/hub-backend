-- Fase 2: industry category per tenant (for role/position templates).
-- Safe to re-run.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'umum' NOT NULL;

-- The app connects as a non-superuser role; keep the pattern of granting
-- explicit rights when this file runs as postgres. Adjust role name to yours.
-- (No new tables here, so nothing to grant. Kept for checklist consistency.)
