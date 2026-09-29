import { cors } from 'hono/cors'
import { env } from '../config/env'

export const corsMiddleware = cors({
  origin: env.CORS_ORIGIN,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
  credentials: true,
  // Cache the preflight response for 10 minutes. Cuts OPTIONS round-trips on
  // every non-simple request the SPA makes (Authorization header etc.).
  maxAge: 600,
})
