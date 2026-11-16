// PII gating: No. KTP / tanggal lahir / alamat hanya boleh terlihat oleh
// manager (owner/admin/hub-admin) atau pada baris diri sendiri. Member
// biasa tetap bisa melihat directory (nama, email, jabatan) tapi bukan
// PII sesama — setara dengan GET /api/users yang memang tidak mengembalikan
// kolom PII untuk non-manager (lihat users.ts listColumns).
export type MemberRowWithPii = {
  userId: string
  userKtpNumber: string | null
  userDateOfBirth: Date | string | null
  userAddress: string | null
}

export function redactMemberPii<T extends MemberRowWithPii>(
  rows: T[],
  opts: { viewerId: string; isManager: boolean },
): T[] {
  if (opts.isManager) return rows
  return rows.map((row) =>
    row.userId === opts.viewerId
      ? row
      : { ...row, userKtpNumber: null, userDateOfBirth: null, userAddress: null },
  )
}
