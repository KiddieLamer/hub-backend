# Drizzle Migrations

Folder ini adalah **sumber kebenaran (source of truth)** untuk skema database
backend `hub-backend`. Semua perubahan skema **harus** didefinisikan di
`src/db/schema/*.ts` lalu di-generate ulang ke folder ini.

## Struktur

```
drizzle/
├── 0000_groovy_marvel_zombies.sql   # baseline (generated dari schema saat ini)
├── meta/
│   ├── 0000_snapshot.json           # snapshot skema (dipakai drizzle-kit untuk diff)
│   └── _journal.json                # journal migrasi
└── MIGRATIONS.md                    # dokumen ini
```

## Alur kerja

1. Ubah skema di `src/db/schema/*.ts`.
2. `npm run db:generate` — drizzle-kit membandingkan schema dengan snapshot
   terakhir dan menghasilkan file SQL baru di `drizzle/`.
3. Review SQL yang dihasilkan (jangan langsung apply ke production).
4. `npm run db:migrate` — apply migrasi ke database (HATI-HATI di production).

Script terkait ada di `package.json`:

| Script          | Perintah                | Kegunaan                                            |
| --------------- | ----------------------- | --------------------------------------------------- |
| `db:generate`   | `drizzle-kit generate`  | Generate file SQL dari diff schema vs snapshot      |
| `db:migrate`    | `drizzle-kit migrate`   | Apply migrasi ke DB yang ditunjuk `DATABASE_URL`    |
| `db:push`       | `drizzle-kit push`      | Push schema langsung tanpa file migrasi (dev only)  |
| `db:studio`     | `drizzle-kit studio`    | UI inspeksi DB                                      |

## Baseline saat ini

- File: `drizzle/0000_groovy_marvel_zombies.sql` (983 baris, ~57 KB)
- Berisi **58 tabel** lengkap: pembuatan `CREATE TABLE`, enum, PK, FK, unique
  constraint, dan index (mis. `login_attempts_email_idx`,
  `notifications_user_idx`, `notifications_read_idx`).
- Ini adalah baseline "dari nol" — artinya jika database masih kosong,
  cukup jalankan migrasi ini untuk membentuk seluruh skema.

## Migrasi manual lama (`src/migrations/*.sql`) — LEGACY

File-file SQL di `src/migrations/` adalah migrasi manual yang ditulis sebelum
drizzle-kit dipakai. **JANGAN dihapus** — sebagian mungkin masih dipakai
sebagai patch manual di environment tertentu. Daftar file:

| File                                            | Catatan                                                        |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `create-roles-tables.sql`                       | Sudah tercakup di baseline (tabel `roles`, `permissions`, dll). |
| `rbac-permissions-and-default-roles.sql`        | Seed/insert data; **tidak** di-generate drizzle — apply manual. |
| `positions-and-user-roles-tenant.sql`           | Sudah tercakup; sisanya seed data.                             |
| `tenant-category.sql`                           | Kolom `category` di `tenants` sudah ada di baseline.           |
| `tenant-approval-threshold.sql`                 | Kolom terkait sudah ada di baseline.                           |
| `user-identity-columns.sql`                     | Kolom identitas user sudah ada di baseline.                    |
| `remove-auto-owner.sql`                         | Data/perilaku lama; tidak relevan untuk DB baru.               |
| `drop-db-schema.sql`                            | Utilitas reset — **hanya untuk dev**, jangan di production.    |

Kesimpulan:

- **Skema DDL** (CREATE/ALTER tabel & kolom) dari migrasi manual tersebut
  **sudah tercakup** di baseline `0000_*.sql`.
- **Seed data / INSERT / UPDATE** (mis. default roles & permissions di
  `rbac-permissions-and-default-roles.sql`) **tidak** di-generate oleh drizzle
  dan harus diaplikasikan terpisah jika diperlukan (lihat `npm run db:seed`).
- `drop-db-schema.sql` hanya utilitas destructif untuk reset dev DB.

## Urutan eksekusi yang disarankan

### Database baru (fresh)

1. Pastikan `DATABASE_URL` di `.env` menunjuk DB target.
2. `npm run db:migrate` — apply `drizzle/0000_*.sql`.
3. `npm run db:seed` — isi data awal (roles, permissions, dsb).

### Database yang sudah ada (existing, sudah diisi via migrasi manual)

Jangan langsung `db:migrate` karena tabel sudah ada dan akan error
"relation already exists". Pilihan:

- Tandai baseline sebagai sudah teraplikasi secara manual (baseline marking),
  lalu gunakan `db:generate` + `db:migrate` untuk perubahan berikutnya; atau
- Gunakan `db:push` untuk sinkronisasi diff (khusus dev), dan review hati-hati.

## Peringatan

- **JANGAN** commit kredensial (`.env` tidak boleh masuk git).
- **JANGAN** jalankan `db:migrate` / `db:push` ke production tanpa review SQL.
- Selalu review file SQL hasil `db:generate` sebelum apply.
