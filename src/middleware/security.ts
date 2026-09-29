import { Context, Next } from 'hono'

/**
 * Baseline HTTP security headers.
 * API-only service (no HTML rendering), so we keep it minimal but safe.
 */
export async function securityHeadersMiddleware(c: Context, next: Next) {
  await next()

  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-DNS-Prefetch-Control', 'off')
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')

  // HSTS only makes sense behind TLS (Cloudflare Tunnel fronts prod).
  // Skip in dev to avoid pinning localhost.
  if (process.env.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}
