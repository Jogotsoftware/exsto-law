'use client'

// Demo-only auth. Sign-in goes through Google OAuth; the callback resolves
// the email to an actor row in the DB (the `actor` table is the allowlist
// and the source of identity). localStorage holds the resolved session.
//
// NOTE: this session is client-readable and forgeable. Acceptable for a
// demo; not production-grade. See ADR 0035.

const STORAGE_KEY = 'exsto_auth_session'

export interface DemoSession {
  email: string
  displayName: string
  actorId: string
  tenantId: string
  signedInAt: string
}

export function setSession(session: DemoSession): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function readSession(): DemoSession | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DemoSession>
    if (!parsed.email || !parsed.actorId || !parsed.tenantId) return null
    return parsed as DemoSession
  } catch {
    return null
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
