import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../config/env'
import * as schema from './schema'

const client = postgres(env.DATABASE_URL, {
  // Keep pool small; PM2 (or its cluster) already fans out processes.
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idle_timeout: 20,
  connect_timeout: 10,
})

export const db = drizzle(client, { schema })

/**
 * Close the underlying postgres pool. Call during graceful shutdown
 * (SIGTERM/SIGINT) so in-flight queries finish and the process can exit
 * without the OS yanking connections mid-statement.
 */
export async function closeDb(): Promise<void> {
  try {
    await client.end({ timeout: 5 })
  } catch {
    // Best-effort: never block shutdown on a stuck socket.
  }
}

export { client as pgClient }
