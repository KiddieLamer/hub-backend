-- Fase 3: approval threshold per tenant (nominal yang naik ke owner).
-- Safe to re-run.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS approval_threshold INTEGER DEFAULT 10000000 NOT NULL;
