import { Context, Next } from 'hono'
import { type Variables } from './auth'

export async function requirePlatformOwner(c: Context<{ Variables: Variables }>, next: Next) {
  const user = c.get('user')
  if (user.platformRole !== 'owner') {
    return c.json({ error: 'Forbidden: platform owner access required' }, 403)
  }
  await next()
}
