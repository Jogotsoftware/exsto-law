// Per-IP fixed-window rate limiter for the UNAUTHENTICATED public routes
// (booking/intake). The public client MCP route runs as a fixed firm actor with
// no caller identity, so without this an attacker can spam unbounded matter
// creation, notification emails, and calendar invites (DoS / DB bloat / cost).
//
// NOTE (flagged, same caveat as apps/rest-api/src/ratelimit.ts): in-memory ⇒
// per-process. A multi-instance / serverless deployment needs a shared store
// (Redis / edge KV) and, for a public form, a CAPTCHA (hCaptcha/Turnstile) as
// the real anti-automation layer. This is the first, best-effort line.
const WINDOW_MS = Number(process.env.PUBLIC_RATE_WINDOW_MS ?? 60_000)
const MAX_PER_WINDOW = Number(process.env.PUBLIC_RATE_MAX ?? 20)

interface Bucket {
  windowStart: number
  count: number
}

const buckets = new Map<string, Bucket>()

export interface RateDecision {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterSeconds: number
}

export function checkPublicRateLimit(key: string): RateDecision {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || now - b.windowStart >= WINDOW_MS) {
    b = { windowStart: now, count: 0 }
    buckets.set(key, b)
  }
  b.count += 1
  // Opportunistic cleanup so the map can't grow unbounded across many IPs.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.windowStart >= WINDOW_MS) buckets.delete(k)
  }
  const remaining = Math.max(0, MAX_PER_WINDOW - b.count)
  const retryAfterSeconds = Math.max(1, Math.ceil((b.windowStart + WINDOW_MS - now) / 1000))
  return { allowed: b.count <= MAX_PER_WINDOW, limit: MAX_PER_WINDOW, remaining, retryAfterSeconds }
}

// Best-effort client IP from the platform/proxy headers (Netlify, then standard
// forwarded headers). Falls back to a single shared bucket if none resolve, so
// the limit still applies (conservatively) when the IP is unknown.
export function clientIpFrom(request: Request): string {
  const h = request.headers
  const nf = h.get('x-nf-client-connection-ip')
  if (nf) return nf
  const xff = h.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return h.get('x-real-ip') ?? 'unknown'
}
