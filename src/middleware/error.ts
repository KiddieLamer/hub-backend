import { Context, Next } from 'hono'
import { ZodError } from 'zod'

export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next()
  } catch (err) {
    if (err instanceof ZodError || (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as any).issues))) {
      const issues = (err as any).issues || []
      return c.json(
        {
          error: issues[0]?.message || 'Data tidak valid',
          details: issues.map((e: any) => ({
            field: e.path?.join('.') || '',
            message: e.message,
          })),
        },
        400
      )
    }

    console.error('Unhandled error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
}
