// Per-principal fixed-window rate limiter (in-memory).
//
// NOTE (flagged): in-memory => per-process. A multi-instance deployment needs a
// shared limiter (Redis / gateway). Sufficient for the single-process foundation
// server; documented as a follow-up.
const WINDOW_MS = Number(process.env.REST_RATE_WINDOW_MS ?? 60_000)
const MAX_PER_WINDOW = Number(process.env.REST_RATE_MAX ?? 120)

interface Window {
  windowStart: number
  count: number
}

const windows = new Map<string, Window>()

export interface RateDecision {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterSeconds: number
}

export function checkRateLimit(tenantId: string): RateDecision {
  const now = Date.now()
  let w = windows.get(tenantId)
  if (!w || now - w.windowStart >= WINDOW_MS) {
    w = { windowStart: now, count: 0 }
    windows.set(tenantId, w)
  }
  w.count += 1
  const remaining = Math.max(0, MAX_PER_WINDOW - w.count)
  const retryAfterSeconds = Math.ceil((w.windowStart + WINDOW_MS - now) / 1000)
  return { allowed: w.count <= MAX_PER_WINDOW, limit: MAX_PER_WINDOW, remaining, retryAfterSeconds }
}
