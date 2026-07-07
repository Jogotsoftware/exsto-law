// Client-portal session crypto + cookie + domain separation (feat/client-portal-pr1).
//
// Three layers under test here:
//   1. lib/clientSession — HMAC sign/verify for the long-lived session cookie
//      (round-trip, tamper, expiry, wrong-secret, missing-secret fail-closed).
//      Pure crypto, no DB.
//   2. DOMAIN SEPARATION — the client session, the attorney session, and OAuth
//      state are mutually unverifiable even though they share OAUTH_STATE_SECRET,
//      because each MACs over a distinct prefix.
//   3. /api/client/auth/me — valid cookie → 200 display fields; none → 401.
//
// Lives under apps/legal-demo/tests so `next/server` resolves. OAUTH_STATE_SECRET
// is set in-test (the lib fails closed without it).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  signClientSession,
  verifyClientSession,
  buildClientSessionCookie,
  buildClearedClientSessionCookie,
  readClientSessionFromCookieHeader,
  CLIENT_SESSION_COOKIE_NAME,
} from '../lib/clientSession'

const SECRET = 'test-session-secret-32-bytes-minimum!!'

// Seeded identity (vertical seed UUID scheme). A client_contact is a regular
// entity; these ids only need to be well-formed UUIDs for the pure-crypto tests.
const CLIENT_CONTACT = '00000000-0000-0000-2222-000000000001'
const TENANT = '00000000-0000-0000-0000-000000000001'
const MATTER_A = '00000000-0000-0000-3333-00000000000a'
const MATTER_B = '00000000-0000-0000-3333-00000000000b'

const IDENTITY = {
  clientContactId: CLIENT_CONTACT,
  tenantId: TENANT,
  matterIds: [MATTER_A, MATTER_B],
  email: 'marcus@pinehollow.test',
  displayName: 'Marcus Pine',
}

function withSecret() {
  const prior = process.env.OAUTH_STATE_SECRET
  process.env.OAUTH_STATE_SECRET = SECRET
  return () => {
    if (prior === undefined) delete process.env.OAUTH_STATE_SECRET
    else process.env.OAUTH_STATE_SECRET = prior
  }
}

describe('lib/clientSession — session HMAC sign/verify (no DB)', () => {
  let restore: () => void
  beforeAll(() => {
    restore = withSecret()
  })
  afterAll(() => restore())

  it('round-trips a signed client session including matterIds', () => {
    const token = signClientSession(IDENTITY)
    expect(token).toContain('.')
    const payload = verifyClientSession(token)
    expect(payload).not.toBeNull()
    expect(payload!.clientContactId).toBe(CLIENT_CONTACT)
    expect(payload!.tenantId).toBe(TENANT)
    expect(payload!.matterIds).toEqual([MATTER_A, MATTER_B])
    expect(payload!.email).toBe(IDENTITY.email)
    expect(payload!.displayName).toBe(IDENTITY.displayName)
    expect(payload!.exp).toBeGreaterThan(payload!.iat)
  })

  it('rejects a tampered payload (kept signature, swapped matterIds)', () => {
    const token = signClientSession(IDENTITY)
    const sig = token.slice(token.indexOf('.') + 1)
    // Attacker grants themselves an extra matter but keeps the original MAC.
    const forgedBody = Buffer.from(
      JSON.stringify({
        ...IDENTITY,
        matterIds: [MATTER_A, MATTER_B, MATTER_A],
        iat: 1,
        exp: 9_999_999_999,
      }),
    ).toString('base64url')
    expect(verifyClientSession(`${forgedBody}.${sig}`)).toBeNull()
  })

  it('rejects an expired client session (exp in the past)', () => {
    const token = signClientSession(IDENTITY, -10)
    expect(verifyClientSession(token)).toBeNull()
  })

  it('rejects a session signed with a different secret (key isolation)', () => {
    const token = signClientSession(IDENTITY)
    process.env.OAUTH_STATE_SECRET = 'a-totally-different-secret-32-bytes!!'
    expect(verifyClientSession(token)).toBeNull()
    process.env.OAUTH_STATE_SECRET = SECRET
  })

  it('rejects malformed / missing tokens', () => {
    expect(verifyClientSession(null)).toBeNull()
    expect(verifyClientSession('')).toBeNull()
    expect(verifyClientSession('no-dot')).toBeNull()
    expect(verifyClientSession('.onlysig')).toBeNull()
  })

  it('fails closed when OAUTH_STATE_SECRET is missing', () => {
    delete process.env.OAUTH_STATE_SECRET
    expect(() => signClientSession(IDENTITY)).toThrow(/OAUTH_STATE_SECRET is required/i)
    expect(() => verifyClientSession('x.y')).toThrow(/OAUTH_STATE_SECRET is required/i)
    process.env.OAUTH_STATE_SECRET = SECRET
  })

  it('builds httpOnly cookies (set + clear) and reads them back from a Cookie header', () => {
    const token = signClientSession(IDENTITY)
    const setCookie = buildClientSessionCookie(token)
    expect(setCookie).toContain(`${CLIENT_SESSION_COOKIE_NAME}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Max-Age=')

    const nameValue = setCookie.split(';')[0]
    const parsed = readClientSessionFromCookieHeader(nameValue)
    expect(parsed).not.toBeNull()
    expect(parsed!.clientContactId).toBe(CLIENT_CONTACT)
    expect(parsed!.matterIds).toEqual([MATTER_A, MATTER_B])

    const cleared = buildClearedClientSessionCookie()
    expect(cleared).toContain('Max-Age=0')
    expect(cleared).toContain('HttpOnly')
  })
})

describe('DOMAIN SEPARATION — tokens are mutually unverifiable', () => {
  let restore: () => void
  beforeAll(() => {
    restore = withSecret()
  })
  afterAll(() => restore())

  it('a client session token fails the attorney verifySession', async () => {
    const { verifySession } = await import('../lib/session')
    const clientToken = signClientSession(IDENTITY)
    expect(verifySession(clientToken)).toBeNull()
  })

  it('an attorney session token fails verifyClientSession', async () => {
    const { signSession } = await import('../lib/session')
    const attorneyToken = signSession({
      actorId: '00000000-0000-0000-0001-000000000002',
      tenantId: TENANT,
      email: 'attorney@pachecolaw.test',
      displayName: 'Attorney',
    })
    expect(verifyClientSession(attorneyToken)).toBeNull()
  })

  it('a client session token is not a valid OAuth-state token', async () => {
    const { verifyOAuthState } = await import('@exsto/legal')
    const session = signClientSession(IDENTITY)
    expect(() => verifyOAuthState(session)).toThrow()
  }, 30_000)
})

describe('/api/client/auth/me (no DB)', () => {
  let restore: () => void
  beforeAll(() => {
    restore = withSecret()
  })
  afterAll(() => restore())

  it('returns 401 with no cookie', async () => {
    const { GET } = await import('../app/api/client/auth/me/route')
    const res = await GET(new Request('https://app.test/api/client/auth/me'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with display fields (email, displayName, matterCount) for a valid cookie', async () => {
    const { GET } = await import('../app/api/client/auth/me/route')
    const token = signClientSession(IDENTITY)
    const res = await GET(
      new Request('https://app.test/api/client/auth/me', {
        headers: { cookie: buildClientSessionCookie(token).split(';')[0] },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { email: string; displayName: string; matterCount: number }
    expect(body.email).toBe(IDENTITY.email)
    expect(body.displayName).toBe(IDENTITY.displayName)
    expect(body.matterCount).toBe(2)
  })

  it('returns 401 for a tampered cookie', async () => {
    const { GET } = await import('../app/api/client/auth/me/route')
    const token = signClientSession(IDENTITY)
    const tampered = token.slice(0, token.indexOf('.')) + '.deadbeef'
    const res = await GET(
      new Request('https://app.test/api/client/auth/me', {
        headers: { cookie: `${CLIENT_SESSION_COOKIE_NAME}=${encodeURIComponent(tampered)}` },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('an attorney session cookie does NOT authenticate the client me route', async () => {
    const { GET } = await import('../app/api/client/auth/me/route')
    const { signSession } = await import('../lib/session')
    // Even if an attorney pastes their token under our cookie name, it fails MAC.
    const attorneyToken = signSession({
      actorId: '00000000-0000-0000-0001-000000000002',
      tenantId: TENANT,
      email: 'attorney@pachecolaw.test',
      displayName: 'Attorney',
    })
    const res = await GET(
      new Request('https://app.test/api/client/auth/me', {
        headers: { cookie: `${CLIENT_SESSION_COOKIE_NAME}=${encodeURIComponent(attorneyToken)}` },
      }),
    )
    expect(res.status).toBe(401)
  })
})
