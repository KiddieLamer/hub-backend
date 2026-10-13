import { cors } from 'hono/cors'
import { env } from '../config/env'

// CORS_ORIGIN boleh satu origin atau daftar comma-separated:
// "https://hub.ranpo.my.id,https://hub-frontend-beta.vercel.app,http://localhost:5173"
const allowedOrigins = env.CORS_ORIGIN.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const corsMiddleware = cors({
  origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Platform-Scope'],
  credentials: true,
  // Cache the preflight response for 10 minutes. Cuts OPTIONS round-trips on
  // every non-simple request the SPA makes (Authorization header etc.).
  maxAge: 600,
})
