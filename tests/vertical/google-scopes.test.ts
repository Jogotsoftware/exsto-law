// Guards the load-bearing invariant of the single-Google-connection change:
// ONE "Connect Google" (calendar/mail mode) must request the FULL scope set
// (calendar + Gmail read + Gmail send) in a single consent, while sign-in stays
// identity-only (no Gmail/calendar scopes). Pure: buildGoogleAuthUrl needs only
// env (OAuth client config + state secret), no DB.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildGoogleAuthUrl } from '@exsto/legal'

const CALENDAR = 'https://www.googleapis.com/auth/calendar.events'
const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send'
const GMAIL_READ = 'https://www.googleapis.com/auth/gmail.readonly'

function scopesOf(url: string): string[] {
  const scope = new URL(url).searchParams.get('scope') ?? ''
  return scope.split(/\s+/).filter(Boolean)
}

describe('buildGoogleAuthUrl scope set (no DB)', () => {
  const prior = {
    id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    state: process.env.OAUTH_STATE_SECRET,
  }
  beforeAll(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret'
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://example.test/api/auth/google/callback'
    process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-32-bytes-min!!'
  })
  afterAll(() => {
    const set = (k: string, v: string | undefined) =>
      v === undefined ? delete process.env[k] : (process.env[k] = v)
    set('GOOGLE_OAUTH_CLIENT_ID', prior.id)
    set('GOOGLE_OAUTH_CLIENT_SECRET', prior.secret)
    set('GOOGLE_OAUTH_REDIRECT_URI', prior.redirect)
    set('OAUTH_STATE_SECRET', prior.state)
  })

  it('calendar mode requests the FULL connect set (calendar + gmail read + gmail send) in one consent', () => {
    const url = buildGoogleAuthUrl('t-1', '/attorney/settings', 'calendar', 'actor-1')
    const scopes = scopesOf(url)
    expect(scopes).toContain(CALENDAR)
    expect(scopes).toContain(GMAIL_SEND)
    expect(scopes).toContain(GMAIL_READ)
    // offline + consent so we always get a refresh token and the user sees the grant.
    const q = new URL(url).searchParams
    expect(q.get('access_type')).toBe('offline')
    expect(q.get('prompt')).toBe('consent')
    // The state is HMAC-signed (carries the connecting attorney).
    expect((q.get('state') ?? '').includes('.')).toBe(true)
  })

  it('mail mode requests the same full set (the modes are unified)', () => {
    const scopes = scopesOf(buildGoogleAuthUrl('t-1', '/attorney/mail', 'mail', 'actor-1'))
    expect(scopes).toEqual(expect.arrayContaining([CALENDAR, GMAIL_SEND, GMAIL_READ]))
  })

  it('signin mode stays identity-only — no calendar or Gmail scopes', () => {
    const url = buildGoogleAuthUrl('t-1', '/attorney', 'signin')
    const scopes = scopesOf(url)
    expect(scopes).toContain('openid')
    expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email')
    expect(scopes).not.toContain(CALENDAR)
    expect(scopes).not.toContain(GMAIL_SEND)
    expect(scopes).not.toContain(GMAIL_READ)
    // Identity-only: online + select_account (no offline refresh token).
    const q = new URL(url).searchParams
    expect(q.get('access_type')).toBe('online')
    expect(q.get('prompt')).toBe('select_account')
  })
})
