import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { validate, getValidated } from './validate'
import { handleError } from './error'

// Build a tiny app that uses validate() the same way real routes do. We wire
// handleError via app.onError() — that's the only reliable catch point for
// throws coming out of route/middleware chains in Hono.
function buildApp(schema: z.ZodTypeAny, source: 'json' | 'query' | 'param' = 'json') {
  const app = new Hono()
  app.onError(handleError)
  app.post('/x', validate(schema, source), (c) => {
    const data = getValidated<typeof schema>(c, source)
    return c.json({ ok: true, data })
  })
  return app
}

const schema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
})

describe('validate middleware', () => {
  it('passes through valid JSON and stores parsed value', async () => {
    const app = buildApp(schema)
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ada', age: 30 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, data: { name: 'Ada', age: 30 } })
  })

  it('returns 400 with details on invalid JSON body', async () => {
    const app = buildApp(schema)
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', age: -5 }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
    expect(Array.isArray(body.details)).toBe(true)
  })

  it('handles empty/non-JSON body gracefully (Zod decides)', async () => {
    const app = buildApp(schema)
    const res = await app.request('/x', { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('validates query source', async () => {
    const qSchema = z.object({ page: z.coerce.number().int().positive() })
    const app = buildApp(qSchema, 'query')
    const ok = await app.request('/x?page=2', { method: 'POST' })
    expect(ok.status).toBe(200)
    expect((await ok.json()).data).toEqual({ page: 2 })

    const bad = await app.request('/x?page=abc', { method: 'POST' })
    expect(bad.status).toBe(400)
  })

  it('getValidated returns undefined when not validated', async () => {
    const app = new Hono()
    app.get('/y', (c) => {
      const v = getValidated(c, 'json')
      return c.json({ v: v ?? null })
    })
    const res = await app.request('/y')
    expect(await res.json()).toEqual({ v: null })
  })
})
