-- Tahap Roles-penuh: permission catalog + default Staff/Manager roles per tenant.
-- RUN AFTER positions-and-user-roles-tenant.sql (needs user_roles.tenant_id).
-- Safe to re-run (idempotent guards throughout).

-- 1. Permission catalog -----------------------------------------------------
INSERT INTO permissions (name, description) VALUES
  ('users:read', 'View the user directory and memberships of own tenant'),
  ('roles:read', 'View roles, positions and their permissions'),
  ('roles:write', 'Create/edit roles, positions and their permissions'),
  ('crm:read', 'View clients, bookings, quotations, warranties'),
  ('crm:write', 'Manage clients, bookings, quotations, warranties'),
  ('finance:read', 'View invoices, expenses, budgets'),
  ('finance:write', 'Manage invoices, expenses, budgets'),
  ('hris:read', 'View attendance, leaves, overtime, payroll, shifts'),
  ('hris:write', 'Check in/out, request leave and overtime'),
  ('hris:approve', 'Approve or reject leave and overtime requests'),
  ('projects:read', 'View projects, tasks and tags'),
  ('projects:write', 'Manage projects, tasks and tags'),
  ('procurement:read', 'View suppliers, purchase orders and stock'),
  ('procurement:write', 'Manage suppliers, purchase orders and stock'),
  ('catalog:read', 'View catalog categories, items and subscriptions'),
  ('catalog:write', 'Manage catalog categories, items and subscriptions'),
  ('assets:read', 'View assets'),
  ('assets:write', 'Manage assets'),
  ('compliance:read', 'View audit logs and support tickets'),
  ('compliance:write', 'Create and update support tickets')
ON CONFLICT (name) DO NOTHING;

-- One (role, permission) pair only once.
CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_pair_uniq
  ON role_permissions(role_id, permission_id);

-- 2. Default roles per tenant ------------------------------------------------
-- Staff: broad read + self-service writes (check-in, leave requests, tickets).
-- Manager: everything Staff has + full write + approvals.
INSERT INTO roles (tenant_id, name, description)
SELECT t.id, 'Staff', 'Default role: read access plus self-service writes'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.tenant_id = t.id AND r.name = 'Staff'
);

INSERT INTO roles (tenant_id, name, description)
SELECT t.id, 'Manager', 'Default role: full write access plus approvals'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.tenant_id = t.id AND r.name = 'Manager'
);

-- 3. Default grants -----------------------------------------------------------
-- Staff permissions.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'users:read', 'roles:read',
  'crm:read', 'finance:read', 'hris:read', 'hris:write',
  'projects:read', 'procurement:read', 'catalog:read',
  'assets:read', 'compliance:read', 'compliance:write'
)
WHERE r.name = 'Staff'
ON CONFLICT DO NOTHING;

-- Manager permissions (superset of Staff).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'users:read', 'roles:read', 'roles:write',
  'crm:read', 'crm:write', 'finance:read', 'finance:write',
  'hris:read', 'hris:write', 'hris:approve',
  'projects:read', 'projects:write',
  'procurement:read', 'procurement:write',
  'catalog:read', 'catalog:write',
  'assets:read', 'assets:write',
  'compliance:read', 'compliance:write'
)
WHERE r.name = 'Manager'
ON CONFLICT DO NOTHING;

-- 4. Backfill assignments ------------------------------------------------------
-- Existing plain members get Staff, existing admins get Manager.
-- Owners/hub-admin bypass permission checks, so they need no grant.
INSERT INTO user_roles (user_id, role_id, tenant_id)
SELECT tm.user_id, r.id, tm.tenant_id
FROM tenant_members tm
JOIN roles r ON r.tenant_id = tm.tenant_id AND r.name = 'Staff'
WHERE tm.role = 'member'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = tm.user_id AND ur.role_id = r.id AND ur.tenant_id = tm.tenant_id
  );

INSERT INTO user_roles (user_id, role_id, tenant_id)
SELECT tm.user_id, r.id, tm.tenant_id
FROM tenant_members tm
JOIN roles r ON r.tenant_id = tm.tenant_id AND r.name = 'Manager'
WHERE tm.role = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = tm.user_id AND ur.role_id = r.id AND ur.tenant_id = tm.tenant_id
  );
