import { Context, Next } from 'hono'
import { ZodError } from 'zod'

export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next()
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json(
        {
          error: 'Validation error',
          details: err.errors.map((e) => ({
            field: e.path.join('.'),
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
