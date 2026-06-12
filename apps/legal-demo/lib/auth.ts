'use client'

// Attorney session, client side.
//
// PRODUCTION: the session is a SIGNED, httpOnly cookie (`exsto_session`) set by
// the Google OAuth callback and verified server-side. The browser CANNOT read
// it. So the client learns "who am I" by asking the server: fetchSession() hits
// /api/auth/me, which verifies the cookie and returns the display fields. There
// is no client-writable session anymore — the old forgeable localStorage path
// is gone (ADR 0035 superseded).
//
// LOCAL DEV ONLY (NODE_ENV !== 'production'): to keep the `?demo_user=` flow and
// curl testing working without standing up Google OAuth, we keep a tiny
// localStorage shim. It maps a known demo user to the seeded attorney actor and
// lets mcpAttorney send dev-only x-actor-id / x-tenant-id headers (the attorney
// MCP route only trusts those headers when NODE_ENV !== 'production'). This shim
// is inert in production: /api/auth/me ignores it and the route rejects headers.

const DEV_STORAGE_KEY = 'exsto_auth_session'

export interface DemoSession {
  email: string
  displayName: string
  actorId: string
  tenantId: string
  signedInAt: string
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// Seeded attorney identity used by the dev `?demo_user=` shim.
const DEV_ATTORNEY: DemoSession = {
  email: 'juancarlos@pachecolaw.com',
  displayName: 'Juan Carlos Pacheco',
  actorId: '00000000-0000-0000-0001-000000000002',
  tenantId: '00000000-0000-0000-0000-000000000001',
  signedInAt: new Date(0).toISOString(),
}

const KNOWN_DEMO_USERS: Record<string, DemoSession> = {
  'juan-carlos': DEV_ATTORNEY,
}

// Tiny in-memory cache so repeated reads in one page don't all hit the network.
// `null` means "checked, not signed in"; `undefined` means "not yet checked".
let cache: DemoSession | null | undefined

// DEV-ONLY: read the localStorage shim used by the `?demo_user=` flow.
export function readDevSession(): DemoSession | null {
  if (!IS_DEV || typeof window === 'undefined') return null
  const raw = localStorage.getItem(DEV_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DemoSession>
    if (!parsed.email || !parsed.actorId || !parsed.tenantId) return null
    return parsed as DemoSession
  } catch {
    return null
  }
}

// DEV-ONLY: activate a demo user (called from the `?demo_user=` handler). Writes
// the localStorage shim so mcpAttorney can send dev headers. No-op in prod.
export function setDevDemoUser(key: string): DemoSession | null {
  if (!IS_DEV || typeof window === 'undefined') return null
  const session = KNOWN_DEMO_USERS[key]
  if (!session) return null
  const withTime = { ...session, signedInAt: new Date().toISOString() }
  localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(withTime))
  cache = withTime
  return withTime
}

// Resolve the current session. Production: asks /api/auth/me (verifies the
// httpOnly cookie). Dev: also accepts the localStorage demo shim, and seeds it
// from a `?demo_user=` query param on first load. Returns null when not signed
// in. Result is cached in memory; call clearSessionCache() to force a refetch.
export async function fetchSession(): Promise<DemoSession | null> {
  if (cache !== undefined) return cache

  // Dev: a fresh `?demo_user=` param wins and seeds the shim.
  if (IS_DEV && typeof window !== 'undefined') {
    const param = new URLSearchParams(window.location.search).get('demo_user')
    if (param) {
      const seeded = setDevDemoUser(param)
      if (seeded) return (cache = seeded)
    }
  }

  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
    if (res.ok) {
      const data = (await res.json()) as Omit<DemoSession, 'signedInAt'>
      return (cache = { ...data, signedInAt: new Date().toISOString() })
    }
  } catch {
    // network error → treat as not signed in
  }

  // Dev fallback: an existing localStorage demo shim.
  const dev = readDevSession()
  return (cache = dev)
}

// Drop the in-memory cache (after sign-out, or to force a re-check).
export function clearSessionCache(): void {
  cache = undefined
}

// Sign out the dev shim. Production sign-out clears the httpOnly cookie via
// /api/auth/logout (the server is the only party that can).
export function clearDevSession(): void {
  cache = undefined
  if (IS_DEV && typeof window !== 'undefined') localStorage.removeItem(DEV_STORAGE_KEY)
}
