import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { requireModuleAccess, hasModulePermission } from './rbac'

type Vars = {
  user: Record<string, unknown>
  tenant: Record<string, unknown>
}

// Build an app that installs the gate and lets each test set the user/tenant
// context via a pre-middleware. This mirrors how tenantMiddleware populates
// c.get('user') / c.get('tenant') in production.
function buildApp(
  user: Record<string, unknown>,
  tenant: Record<string, unknown>,
  read = 'crm:read',
  write = 'crm:write',
) {
  const app = new Hono<{ Variables: Vars }>()
  app.use('*', async (c, next) => {
    c.set('user', user)
    c.set('tenant', tenant)
    await next()
  })
  app.use('*', requireModuleAccess(read, write))
  app.on(['GET', 'POST'], '/x', (c) => c.json({ ok: true }))
  return app
}

describe('requireModuleAccess', () => {
  it('returns 401 when no user in context', async () => {
    const app = new Hono<{ Variables: Vars }>()
    app.use('*', requireModuleAccess('crm:read', 'crm:write'))
    app.get('/x', (c) => c.json({ ok: true }))
    const res = await app.request('/x')
    expect(res.status).toBe(401)
  })

  it('returns 400 when no tenant context', async () => {
    const app = new Hono<{ Variables: Vars }>()
    app.use('*', async (c, next) => {
      c.set('user', { id: 'u1', permissions: [] })
      await next()
    })
    app.use('*', requireModuleAccess('crm:read', 'crm:write'))
    app.get('/x', (c) => c.json({ ok: true }))
    const res = await app.request('/x')
    expect(res.status).toBe(400)
  })

  it('GET requires read permission', async () => {
    const app = buildApp(
      { id: 'u1', permissions: ['crm:read'] },
      { tenantId: 't1', tenantRole: 'member' },
    )
    const ok = await app.request('/x', { method: 'GET' })
    expect(ok.status).toBe(200)
  })

  it('GET denied when only write permission is held', async () => {
    const app = buildApp(
      { id: 'u1', permissions: ['crm:write'] },
      { tenantId: 't1', tenantRole: 'member' },
    )
    const res = await app.request('/x', { method: 'GET' })
    expect(res.status).toBe(403)
  })

  it('POST requires write permission', async () => {
    const app = buildApp(
      { id: 'u1', permissions: ['crm:write'] },
      { tenantId: 't1', tenantRole: 'member' },
    )
    const ok = await app.request('/x', { method: 'POST' })
    expect(ok.status).toBe(200)
  })

  it('POST denied when only read permission is held', async () => {
    const app = buildApp(
      { id: 'u1', permissions: ['crm:read'] },
      { tenantId: 't1', tenantRole: 'member' },
    )
    const res = await app.request('/x', { method: 'POST' })
    expect(res.status).toBe(403)
  })

  it('hub-admin bypasses the gate entirely', async () => {
    const app = buildApp(
      { id: 'u1', platformRole: 'hub-admin', permissions: [] },
      { tenantId: 't1', tenantRole: 'hub-admin' },
    )
    expect((await app.request('/x', { method: 'GET' })).status).toBe(200)
    expect((await app.request('/x', { method: 'POST' })).status).toBe(200)
  })

  it('tenant owner/admin bypass the gate', async () => {
    for (const role of ['owner', 'admin']) {
      const app = buildApp(
        { id: 'u1', permissions: [] },
        { tenantId: 't1', tenantRole: role },
      )
      expect((await app.request('/x', { method: 'GET' })).status).toBe(200)
      expect((await app.request('/x', { method: 'POST' })).status).toBe(200)
    }
  })
})

describe('hasModulePermission', () => {
  // Minimal fake context: only `get` is used by the probe.
  const ctx = (user: Record<string, unknown>, tenant: Record<string, unknown>) =>
    ({
      get: (k: string) => (k === 'user' ? user : tenant),
    }) as unknown as Parameters<typeof hasModulePermission>[0]

  it('owner/admin/hub-admin always true', () => {
    expect(
      hasModulePermission(ctx({ permissions: [] }, { tenantRole: 'owner' }), 'x:read'),
    ).toBe(true)
    expect(
      hasModulePermission(ctx({ permissions: [] }, { tenantRole: 'admin' }), 'x:read'),
    ).toBe(true)
    expect(
      hasModulePermission(
        ctx({ platformRole: 'hub-admin', permissions: [] }, { tenantRole: 'member' }),
        'x:read',
      ),
    ).toBe(true)
  })

  it('member is true only when they hold the permission', () => {
    expect(
      hasModulePermission(ctx({ permissions: [] }, { tenantRole: 'member' }), 'x:read'),
    ).toBe(false)
    expect(
      hasModulePermission(ctx({ permissions: ['x:read'] }, { tenantRole: 'member' }), 'x:read'),
    ).toBe(true)
  })

  it('missing user/tenant context is false', () => {
    const empty = { get: () => undefined } as unknown as Parameters<typeof hasModulePermission>[0]
    expect(hasModulePermission(empty, 'x:read')).toBe(false)
  })
})
