import { Context, Next } from 'hono'
import { type Variables } from './auth'

export async function requireHubAdmin(c: Context<{ Variables: Variables }>, next: Next) {
  const user = c.get('user')
  if (user.platformRole !== 'hub-admin') {
    return c.json({ error: 'Forbidden: hub admin access required' }, 403)
  }
  await next()
}
