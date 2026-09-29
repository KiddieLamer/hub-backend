import type { Context, Next } from 'hono'
import { ZodError } from 'zod'

/**
 * Shared error -> Response mapper.
 *
 * Used both by Hono's `app.onError()` (which is the ONLY reliable way to catch
 * errors thrown from route handlers in Hono — an async `use('*', mw)` with
 * try/catch does NOT see downstream throws) and by the legacy middleware form.
 *
 * ZodError (or anything with an `issues` array) becomes a 400 with a stable
 * `{ error, details }` shape. Everything else becomes a 500.
 */
export function handleError(err: unknown, c: Context) {
  if (
    err instanceof ZodError ||
    (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as any).issues))
  ) {
    const issues = ((err as any).issues ?? []) as Array<{
      path?: (string | number)[]
      message: string
    }>
    return c.json(
      {
        error: issues[0]?.message || 'Data tidak valid',
        details: issues.map((e) => ({
          field: e.path?.join('.') || '',
          message: e.message,
        })),
      },
      400,
    )
  }

  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
}

/**
 * Backward-compatible middleware form.
 *
 * Kept so existing tests / call sites that mount it via `app.use('*', ...)`
 * still work for the narrow case where the error is thrown *inside* this
 * middleware's own `next()` chain. New code should register `handleError`
 * with `app.onError(handleError)`.
 */
export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next()
  } catch (err) {
    return handleError(err, c)
  }
}
