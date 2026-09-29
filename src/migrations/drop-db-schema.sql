-- Multi-tenant: pindah dari model schema-per-tenant (tidak pernah dipakai)
-- ke shared-schema (isolasi via kolom tenant_id di tiap tabel tenant-scoped).
--
-- Kolom `tenants.db_schema` dulu NOT NULL UNIQUE tapi tidak pernah dipakai
-- untuk isolasi nyata (tidak ada CREATE SCHEMA / SET search_path). Setelah
-- kode berhenti mengisinya, kolom ini harus di-drop agar INSERT tenant baru
-- tidak gagal karena NOT NULL.
--
-- Pengaman: cek dulu tidak ada schema PostgreSQL nyata yang mengikuti pola
-- tenant_% (jika ada, berarti ada data yang harus dipindah lebih dulu).

DO $$
DECLARE
  real_schemas int;
BEGIN
  SELECT count(*) INTO real_schemas
  FROM information_schema.schemata
  WHERE schema_name LIKE 'tenant\_%';
  IF real_schemas > 0 THEN
    RAISE EXCEPTION 'Ditemukan % schema PostgreSQL dengan prefix tenant_ — batalkan drop. Migrasikan data dulu.', real_schemas;
  END IF;
END $$;

-- Drop kolom lama (data nilainya hanya string turunan slug, tidak ada nilai bisnis).
ALTER TABLE tenants DROP COLUMN IF EXISTS db_schema;
