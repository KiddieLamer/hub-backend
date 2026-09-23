-- Tahap 2: structured positions (jabatan) per tenant + scope user_roles per tenant
-- Run on the hub database (e.g. hubdb). Safe to re-run (IF NOT EXISTS guards).

-- 1. Positions table: organizational structure per company.
--    level: higher number = higher rank (0 = staff, 50 = manager, 100 = director).
--    default_role_id: RBAC role auto-granted to members holding this position.
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  level INTEGER DEFAULT 0 NOT NULL,
  parent_id UUID REFERENCES positions(id) ON DELETE SET NULL,
  default_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT positions_tenant_name_uniq UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS positions_tenant_idx ON positions(tenant_id);

-- 2. Link tenant members to a position.
ALTER TABLE tenant_members
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id) ON DELETE SET NULL;

-- 3. Scope RBAC assignments per tenant so the same user can hold
--    different roles in different companies.
ALTER TABLE user_roles
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Backfill: every existing assignment belongs to its role's tenant.
UPDATE user_roles ur
SET tenant_id = r.tenant_id
FROM roles r
WHERE ur.role_id = r.id AND ur.tenant_id IS NULL;

-- Drop assignments that still have no tenant (defensive; should be zero rows).
DELETE FROM user_roles WHERE tenant_id IS NULL;

ALTER TABLE user_roles ALTER COLUMN tenant_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_tenant_uniq
  ON user_roles(user_id, role_id, tenant_id);

-- The app connects as a non-superuser role (e.g. hubadmin) while migrations
-- typically run as postgres. Without this, every new table 500s with
-- "permission denied" (Postgres 42501). Adjust the role name to yours.
GRANT ALL PRIVILEGES ON TABLE positions TO hubadmin;
