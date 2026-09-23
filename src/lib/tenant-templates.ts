import { db } from '../db'
import { roles, permissions, rolePermissions, positions } from '../db/schema'
import { eq, and } from 'drizzle-orm'

// Fase 2: industry templates. Picked at tenant creation, copied as the
// tenant's own roles/positions (editable afterwards). Keep in sync with
// RBAC_RACI_DESIGN.md.

export const TENANT_CATEGORIES = ['jasa-lapangan', 'hotel', 'konsultan', 'umum'] as const
export type TenantCategory = (typeof TENANT_CATEGORIES)[number]

export interface TemplateRole {
  name: string
  description: string
  perms: string[]
}

export interface TemplatePosition {
  name: string
  level: number
  parentName?: string | null
  defaultRoleName?: string | null
}

interface TenantTemplate {
  roles: TemplateRole[]
  positions: TemplatePosition[]
}

const BASE_READ = ['users:read', 'roles:read']

export const TENANT_TEMPLATES: Record<TenantCategory, TenantTemplate> = {
  'jasa-lapangan': {
    roles: [
      {
        name: 'Teknisi',
        description: 'Staff lapangan: kunjungan, laporan, absensi',
        perms: [...BASE_READ, 'crm:read', 'hris:read', 'hris:write', 'projects:read', 'projects:write', 'procurement:read', 'compliance:read', 'compliance:write'],
      },
      {
        name: 'Admin Kantor',
        description: 'Operasional kantor: CRM, keuangan, katalog',
        perms: [...BASE_READ, 'crm:read', 'crm:write', 'finance:read', 'finance:write', 'hris:read', 'hris:write', 'projects:read', 'projects:write', 'procurement:read', 'procurement:write', 'catalog:read', 'catalog:write', 'compliance:read', 'compliance:write'],
      },
      {
        name: 'Manager Lapangan',
        description: 'SPV/koordinator: semua akses + persetujuan tim',
        perms: [...BASE_READ, 'roles:write', 'crm:read', 'crm:write', 'finance:read', 'finance:write', 'hris:read', 'hris:write', 'hris:approve', 'projects:read', 'projects:write', 'procurement:read', 'procurement:write', 'catalog:read', 'catalog:write', 'assets:read', 'assets:write', 'compliance:read', 'compliance:write'],
      },
    ],
    positions: [
      { name: 'Teknisi', level: 0, parentName: 'Koordinator', defaultRoleName: 'Teknisi' },
      { name: 'Koordinator', level: 50, parentName: 'Manager Operasional', defaultRoleName: 'Manager Lapangan' },
      { name: 'Manager Operasional', level: 80, parentName: null, defaultRoleName: 'Manager Lapangan' },
    ],
  },
  hotel: {
    roles: [
      {
        name: 'Resepsionis',
        description: 'Front office: booking, absensi, tiket',
        perms: [...BASE_READ, 'crm:read', 'crm:write', 'procurement:read', 'hris:read', 'hris:write', 'compliance:read', 'compliance:write'],
      },
      {
        name: 'Housekeeping',
        description: 'Room attendant: tugas dan aset',
        perms: [...BASE_READ, 'projects:read', 'projects:write', 'assets:read', 'hris:read', 'hris:write'],
      },
      {
        name: 'Finance Hotel',
        description: 'Kasir/akunting hotel',
        perms: [...BASE_READ, 'finance:read', 'finance:write', 'crm:read', 'procurement:read'],
      },
    ],
    positions: [
      { name: 'Resepsionis', level: 0, parentName: 'Supervisor', defaultRoleName: 'Resepsionis' },
      { name: 'Housekeeping', level: 0, parentName: 'Supervisor', defaultRoleName: 'Housekeeping' },
      { name: 'Supervisor', level: 50, parentName: 'General Manager', defaultRoleName: null },
      { name: 'General Manager', level: 90, parentName: null, defaultRoleName: null },
    ],
  },
  konsultan: {
    roles: [
      {
        name: 'Drafter',
        description: 'Tim produksi: proyek dan tugas',
        perms: [...BASE_READ, 'projects:read', 'projects:write', 'hris:read', 'hris:write', 'compliance:read', 'compliance:write'],
      },
      {
        name: 'Finance Konsultan',
        description: 'Keuangan: invoice dan expense',
        perms: [...BASE_READ, 'finance:read', 'finance:write', 'crm:read', 'projects:read'],
      },
      {
        name: 'Project Lead',
        description: 'Lead proyek: kelola CRM/procurement + persetujuan tim',
        perms: [...BASE_READ, 'crm:read', 'crm:write', 'projects:read', 'projects:write', 'procurement:read', 'procurement:write', 'hris:read', 'hris:write', 'hris:approve', 'compliance:read', 'compliance:write'],
      },
    ],
    positions: [
      { name: 'Drafter', level: 0, parentName: 'Project Lead', defaultRoleName: 'Drafter' },
      { name: 'Project Lead', level: 60, parentName: 'Principal', defaultRoleName: 'Project Lead' },
      { name: 'Principal', level: 90, parentName: null, defaultRoleName: null },
    ],
  },
  umum: {
    roles: [
      {
        name: 'Staff',
        description: 'Default role: read access plus self-service writes',
        perms: [...BASE_READ, 'crm:read', 'finance:read', 'hris:read', 'hris:write', 'projects:read', 'procurement:read', 'catalog:read', 'assets:read', 'compliance:read', 'compliance:write'],
      },
      {
        name: 'Manager',
        description: 'Default role: full write access plus approvals',
        perms: [...BASE_READ, 'roles:write', 'crm:read', 'crm:write', 'finance:read', 'finance:write', 'hris:read', 'hris:write', 'hris:approve', 'projects:read', 'projects:write', 'procurement:read', 'procurement:write', 'catalog:read', 'catalog:write', 'assets:read', 'assets:write', 'compliance:read', 'compliance:write'],
      },
    ],
    positions: [],
  },
}

export function normalizeCategory(input: unknown): TenantCategory {
  return (TENANT_CATEGORIES as readonly string[]).includes(input as string)
    ? (input as TenantCategory)
    : 'umum'
}

export interface SeedResult {
  category: TenantCategory
  rolesCreated: string[]
  positionsCreated: string[]
}

// Idempotent: existing roles/positions (matched by name) are skipped,
// missing refs (parent/role) resolve to whatever exists.
export async function seedTenantTemplate(tenantId: string, category: TenantCategory): Promise<SeedResult> {
  const template = TENANT_TEMPLATES[category]
  const result: SeedResult = { category, rolesCreated: [], positionsCreated: [] }

  const permRows = await db.query.permissions.findMany({
    columns: { id: true, name: true },
  })
  const permByName = new Map(permRows.map((p) => [p.name, p.id]))

  const roleIdByName = new Map<string, string>()
  const existingRoles = await db.query.roles.findMany({
    where: eq(roles.tenantId, tenantId),
    columns: { id: true, name: true },
  })
  for (const r of existingRoles) roleIdByName.set(r.name, r.id)

  for (const def of template.roles) {
    let roleId = roleIdByName.get(def.name)
    if (!roleId) {
      const [role] = await db.insert(roles).values({
        tenantId,
        name: def.name,
        description: def.description,
      }).returning({ id: roles.id })
      roleId = role.id
      roleIdByName.set(def.name, roleId)
      result.rolesCreated.push(def.name)

      const pairs = def.perms
        .map((n) => permByName.get(n))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: roleId as string, permissionId }))
      if (pairs.length > 0) {
        await db.insert(rolePermissions).values(pairs)
      }
    }
  }

  const positionIdByName = new Map<string, string>()
  const existingPositions = await db.query.positions.findMany({
    where: eq(positions.tenantId, tenantId),
    columns: { id: true, name: true },
  })
  for (const p of existingPositions) positionIdByName.set(p.name, p.id)

  // Two passes so parents can reference positions created in the same batch.
  const pending = template.positions.filter((p) => !positionIdByName.has(p.name))
  for (const def of pending) {
    const [pos] = await db.insert(positions).values({
      tenantId,
      name: def.name,
      level: def.level,
      parentId: null,
      defaultRoleId: null,
    }).returning({ id: positions.id })
    positionIdByName.set(def.name, pos.id)
    result.positionsCreated.push(def.name)
  }
  for (const def of pending) {
    const parentId = def.parentName ? positionIdByName.get(def.parentName) ?? null : null
    const defaultRoleId = def.defaultRoleName ? roleIdByName.get(def.defaultRoleName) ?? null : null
    if (parentId !== null || defaultRoleId !== null) {
      await db.update(positions)
        .set({ parentId, defaultRoleId, updatedAt: new Date() })
        .where(and(eq(positions.id, positionIdByName.get(def.name)!), eq(positions.tenantId, tenantId)))
    }
  }

  return result
}
