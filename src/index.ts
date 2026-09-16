import { serve } from '@hono/node-server'
import app from './app'
import { env } from './config/env'

console.log(`🚀 Hub Backend running on http://localhost:${env.PORT}`)

serve({
  fetch: app.fetch,
  port: env.PORT,
})
