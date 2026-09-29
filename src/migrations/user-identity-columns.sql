-- User identity columns (employee ID, KTP, tanggal lahir, alamat).
-- The API and app code already read/write these; older databases may lack them.
-- Safe to re-run.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS date_of_birth TIMESTAMP,
  ADD COLUMN IF NOT EXISTS ktp_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS address TEXT;
