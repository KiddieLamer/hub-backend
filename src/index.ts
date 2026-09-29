import { serve } from '@hono/node-server'
import app from './app'
import { env } from './config/env'
import { closeDb } from './db'

const server = serve({
  fetch: app.fetch,
  port: env.PORT,
})

console.log(`🚀 Hub Backend running on http://localhost:${env.PORT} (env=${env.NODE_ENV})`)

/**
 * Graceful shutdown.
 *
 * Order matters: stop accepting new connections first, then let in-flight
 * requests settle, then close the DB pool. Without this, PM2 restarts can
 * cut queries mid-flight and leave the pool with dangling sockets.
 */
let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[shutdown] ${signal} received — draining…`)

  // Hard deadline so a stuck request can't keep the process alive forever.
  const forceTimer = setTimeout(() => {
    console.error('[shutdown] timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  forceTimer.unref()

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })

  await closeDb()

  clearTimeout(forceTimer)
  console.log('[shutdown] done')
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

// Never let an unhandled rejection silently kill a worker with open sockets.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
