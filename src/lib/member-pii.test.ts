import { describe, it, expect } from 'vitest'
import { redactMemberPii, type MemberRowWithPii } from './member-pii'

type Row = MemberRowWithPii & { id: string }

const row = (id: string, userId: string): Row => ({
  id,
  userId,
  userKtpNumber: '3201010101900001',
  userDateOfBirth: '1990-01-01',
  userAddress: 'Jl. Mawar No. 1, Bandung',
})

describe('redactMemberPii', () => {
  it('member biasa: PII sesama di-null-kan, baris diri sendiri tetap utuh', () => {
    const rows: Row[] = [row('m1', 'u-self'), row('m2', 'u-other')]
    const result = redactMemberPii(rows, { viewerId: 'u-self', isManager: false })

    // Baris sendiri: utuh
    expect(result[0].userKtpNumber).toBe('3201010101900001')
    expect(result[0].userDateOfBirth).toBe('1990-01-01')
    expect(result[0].userAddress).toBe('Jl. Mawar No. 1, Bandung')

    // Baris sesama: PII hilang, kolom non-PII tetap ada
    expect(result[1].userKtpNumber).toBeNull()
    expect(result[1].userDateOfBirth).toBeNull()
    expect(result[1].userAddress).toBeNull()
    expect(result[1].id).toBe('m2')
  })

  it('owner/admin/hub-admin (isManager): semua PII utuh tanpa kecualian', () => {
    const rows: Row[] = [row('m1', 'u-a'), row('m2', 'u-b')]
    const result = redactMemberPii(rows, { viewerId: 'u-a', isManager: true })

    expect(result).toEqual(rows)
    expect(result[1].userKtpNumber).toBe('3201010101900001')
    expect(result[1].userAddress).toBe('Jl. Mawar No. 1, Bandung')
  })

  it('redact tidak memutasi array input asli', () => {
    const rows: Row[] = [row('m1', 'u-a'), row('m2', 'u-b')]
    const snapshot = JSON.parse(JSON.stringify(rows))

    redactMemberPii(rows, { viewerId: 'u-a', isManager: false })

    expect(rows).toEqual(snapshot)
  })

  it('member melihat beberapa sesama: semuanya ter-redact kecuali diri sendiri', () => {
    const rows: Row[] = [
      row('m1', 'u-self'),
      row('m2', 'u-x'),
      row('m3', 'u-y'),
    ]
    const result = redactMemberPii(rows, { viewerId: 'u-self', isManager: false })

    expect(result.filter((r) => r.userKtpNumber !== null).map((r) => r.userId)).toEqual([
      'u-self',
    ])
  })
})
