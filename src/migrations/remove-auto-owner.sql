-- Remove auto-added owner membership for hub-admin
-- Run this on the remote DB: psql -d hubdb -f remove-auto-owner.sql
DELETE FROM tenant_members
WHERE user_id = 'f6e982d9-364e-43c8-8328-f924923d0ed7'
AND role = 'owner';
