// Real, server-verified attorney sessions (feat/real-auth). Replaces the old
// forgeable localStorage "session" + x-actor-id/x-tenant-id header trust with a
// signed, httpOnly cookie verified server-side.
//
// Three layers under test:
//   1. lib/session — HMAC sign/verify (round-trip, tamper, expiry, wrong-secret,
//      missing-secret fail-closed). Pure crypto, no DB.
//   2. /api/attorney/mcp resolveCtx — production must reject everything without a
//      valid cookie (forged headers included); a validly-signed cookie for a
//      seeded actor passes. DB-gated (hits the actor table).
//   3. /api/auth/me — valid cookie → 200 with email; none → 401. Pure (no DB).
//
// Lives under apps/legal-demo/tests so `next/server` resolves (root tests/ has no
// Next install). OAUTH_STATE_SECRET is set in-test (the lib fails closed without
// it).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  signSession,
  verifySession,
  buildSessionCookie,
  buildClearedSessionCookie,
  readSessionFromCookieHeader,
  SESSION_COOKIE_NAME,
} from '../lib/session'

const SECRET = 'test-session-secret-32-bytes-minimum!!'

// Seeded attorney actor / tenant (supabase/seed/0001_initial_data.sql).
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'
const TENANT = '00000000-0000-0000-0000-000000000001'

const IDENTITY = {
  actorId: ATTORNEY_ACTOR,
  tenantId: TENANT,
  email: 'attorney@pachecolaw.test',
  displayName: 'Test Attorney',
}

function withSecret() {
  const prior = process.env.OAUTH_STATE_SECRET
  process.env.OAUTH_STATE_SECRET = SECRET
  return () => {
    if (prior === undefined) delete process.env.OAUTH_STATE_SECRET
    else process.env.OAUTH_STATE_SECRET = prior
  }
}

describe('lib/session — HMAC sign/verify (no DB)', () => {
  let restore: () => void
  beforeAll(() => {
    restore = withSecret()
  })
  afterAll(() => restore())

  it('round-trips a signed session', () => {
    const token = signSession(IDENTITY)
    expect(token).toContain('.')
    const payload = verifySession(token)
    expect(payload).not.toBeNull()
    expect(payload!.actorId).toBe(ATTORNEY_ACTOR)
    expect(payload!.tenantId).toBe(TENANT)
    expect(payload!.email).toBe(IDENTITY.email)
    expect(payload!.displayName).toBe(IDENTITY.displayName)
    expect(payload!.exp).toBeGreaterThan(payload!.iat)
  })

  it('rejects a tampered payload (kept signature, swapped body)', () => {
    const token = signSession(IDENTITY)
    const sig = token.slice(token.indexOf('.') + 1)
    // Attacker rewrites the actor but keeps the original MAC.
    const forgedBody = Buffer.from(
      JSON.stringify({ ...IDENTITY, actorId: '00000000-0000-0000-0001-000000000099' }),
    ).toString('base64url')
    expect(verifySession(`${forgedBody}.${sig}`)).toBeNull()
  })

  it('rejects an expired session (exp in the past)', () => {
    // Negative TTL → exp before iat → already expired.
    const token = signSession(IDENTITY, -10)
    expect(verifySession(token)).toBeNull()
  })

  it('rejects a token signed with a different secret (key isolation)', () => {
    const token = signSession(IDENTITY)
    process.env.OAUTH_STATE_SECRET = 'a-totally-different-secret-32-bytes!!'
    expect(verifySession(token)).toBeNull()
    process.env.OAUTH_STATE_SECRET = SECRET
  })

  it('rejects malformed / missing tokens', () => {
    expect(verifySession(null)).toBeNull()
    expect(verifySession('')).toBeNull()
    expect(verifySession('no-dot')).toBeNull()
    expect(verifySession('.onlysig')).toBeNull()
  })

  // 30s timeout: the dynamic `import('@exsto/legal')` cold-loads the whole
  // vertical (primitives/handlers) and can exceed the 5s default under full-suite
  // parallel load — it's import cost, not logic.
  it('is domain-separated from OAuth state (a session MAC is not an OAuth-state MAC)', async () => {
    // Same secret, same payload bytes, but the session signer prefixes the MAC
    // with "session.v1:", so an OAuth-state verifier must reject a session token.
    const { verifyOAuthState } = await import('@exsto/legal')
    const token = signSession(IDENTITY)
    expect(() => verifyOAuthState(token)).toThrow()
  }, 30_000)

  it('fails closed when OAUTH_STATE_SECRET is missing', () => {
    delete process.env.OAUTH_STATE_SECRET
    expect(() => signSession(IDENTITY)).toThrow(/OAUTH_STATE_SECRET is required/i)
    // verify must also throw (not silently accept) when the secret is gone.
    expect(() => verifySession('x.y')).toThrow(/OAUTH_STATE_SECRET is required/i)
    process.env.OAUTH_STATE_SECRET = SECRET
  })

  it('builds httpOnly cookies (set + clear) and reads them back from a Cookie header', () => {
    const token = signSession(IDENTITY)
    const setCookie = buildSessionCookie(token)
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Max-Age=')

    // Reconstruct the Cookie request header from the Set-Cookie name=value pair.
    const nameValue = setCookie.split(';')[0]
    const parsed = readSessionFromCookieHeader(nameValue)
    expect(parsed).not.toBeNull()
    expect(parsed!.actorId).toBe(ATTORNEY_ACTOR)

    const cleared = buildClearedSessionCookie()
    expect(cleared).toContain('Max-Age=0')
    expect(cleared).toContain('HttpOnly')
  })
})

describe('/api/auth/me (no DB)', () => {
  let restore: () => void
  beforeAll(() => {
    restore = withSecret()
  })
  afterAll(() => restore())

  it('returns 401 with no cookie', async () => {
    const { GET } = await import('../app/api/auth/me/route')
    const res = await GET(new Request('https://app.test/api/auth/me'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with email for a valid cookie', async () => {
    const { GET } = await import('../app/api/auth/me/route')
    const token = signSession(IDENTITY)
    const res = await GET(
      new Request('https://app.test/api/auth/me', {
        headers: { cookie: buildSessionCookie(token).split(';')[0] },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { email: string; actorId: string; tenantId: string }
    expect(body.email).toBe(IDENTITY.email)
    expect(body.actorId).toBe(ATTORNEY_ACTOR)
    expect(body.tenantId).toBe(TENANT)
  })

  it('returns 401 for a tampered cookie', async () => {
    const { GET } = await import('../app/api/auth/me/route')
    const token = signSession(IDENTITY)
    const tampered = token.slice(0, token.indexOf('.')) + '.deadbeef'
    const res = await GET(
      new Request('https://app.test/api/auth/me', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(tampered)}` },
      }),
    )
    expect(res.status).toBe(401)
  })
})

// DB-gated: the attorney MCP route re-checks the actor against the live table, so
// the success case needs a real DB. Skip (not fail) when no DB URL is wired —
// matches tests/invariants and tests/vertical conventions.
const dbUrl = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const dbRun = describe.skipIf(!dbUrl)

describe('/api/attorney/mcp resolveCtx — production cookie gating', () => {
  const priorNodeEnv = process.env.NODE_ENV
  let restoreSecret: () => void

  beforeAll(() => {
    restoreSecret = withSecret()
    // Force production semantics: no header fallback, cookie required.
    process.env.NODE_ENV = 'production'
  })
  afterAll(async () => {
    restoreSecret()
    process.env.NODE_ENV = priorNodeEnv
    if (dbUrl) {
      const { closeDbPool } = await import('@exsto/shared')
      await closeDbPool()
    }
  })

  // A real, registered read tool the attorney route can dispatch on the success
  // path. Using a list/status tool avoids writing to the substrate.
  const TOOL = 'legal.settings.get'

  function mcpRequest(headers: Record<string, string>): Request {
    return new Request('https://app.test/api/attorney/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ toolName: TOOL }),
    })
  }

  it('rejects with 401 when there is no cookie (production)', async () => {
    const { POST } = await import('../app/api/attorney/mcp/route')
    const res = await POST(mcpRequest({}))
    expect(res.status).toBe(401)
  })

  it('rejects with 401 when only forged x-actor-id/x-tenant-id headers are sent (production)', async () => {
    const { POST } = await import('../app/api/attorney/mcp/route')
    const res = await POST(mcpRequest({ 'x-actor-id': ATTORNEY_ACTOR, 'x-tenant-id': TENANT }))
    // In production the headers are NOT trusted — the old hole is closed.
    expect(res.status).toBe(401)
  })

  dbRun('accepts a validly-signed cookie for a seeded, active actor (DB)', async () => {
    it('passes resolveCtx and dispatches the tool', { timeout: 60_000 }, async () => {
      const { POST } = await import('../app/api/attorney/mcp/route')
      const token = signSession(IDENTITY)
      const res = await POST(
        mcpRequest({ cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` }),
      )
      // resolveCtx accepted the cookie (not 401/400) and the tool ran (200).
      expect(res.status).toBe(200)
      const body = (await res.json()) as { result?: unknown; error?: string }
      expect(body.error).toBeUndefined()
      expect(body.result).toBeDefined()
    })
  })
})
