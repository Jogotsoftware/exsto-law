// AUTH-HANDOFF-1 — the cross-host sign-in token (lib/authHandoff.ts). Pure unit
// tests: MAC roundtrip, tamper/expiry/shape rejection, slug validation, dest
// path containment. The DB burn (single-use) and host binding live in the
// exchange route and are exercised in the cutover pilot — this file proves the
// token itself can't be forged, altered, extended, or aimed off-path.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { mintHandoffToken, verifyHandoffToken, handoffRedirectUrl } from '../lib/authHandoff'

const TENANT = '11111111-1111-1111-1111-111111111111'
const ACTOR = '22222222-2222-2222-2222-222222222222'

const attorney = {
  kind: 'attorney' as const,
  tenantId: TENANT,
  actorId: ACTOR,
  email: 'a@firm.test',
  displayName: 'A. Attorney',
}

beforeAll(() => {
  process.env.AUTH_HANDOFF_SECRET = 'unit-test-secret-0123456789'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mint/verify roundtrip', () => {
  it('verifies its own token and preserves the principal, slug, dest, jti', () => {
    const token = mintHandoffToken(attorney, 'pacheco', '/attorney/matters')
    const v = verifyHandoffToken(token)
    expect(v).not.toBeNull()
    expect(v?.principal).toEqual(attorney)
    expect(v?.slug).toBe('pacheco')
    expect(v?.dest).toBe('/attorney/matters')
    expect(v?.jti).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('client principals roundtrip too', () => {
    const token = mintHandoffToken(
      { kind: 'client', tenantId: TENANT, clientContactId: ACTOR },
      'pacheco',
      '/portal',
    )
    expect(verifyHandoffToken(token)?.principal.kind).toBe('client')
  })
})

describe('rejection paths', () => {
  it('rejects tampered payloads (MAC mismatch)', () => {
    const token = mintHandoffToken(attorney, 'pacheco', '/attorney')
    const [b64, sig] = token.split('.')
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString())
    payload.slug = 'other-firm'
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`
    expect(verifyHandoffToken(forged)).toBeNull()
  })

  it('rejects expired tokens (60s TTL)', () => {
    vi.useFakeTimers()
    const token = mintHandoffToken(attorney, 'pacheco', '/attorney')
    vi.advanceTimersByTime(61_000)
    expect(verifyHandoffToken(token)).toBeNull()
  })

  it('still accepts within the TTL', () => {
    vi.useFakeTimers()
    const token = mintHandoffToken(attorney, 'pacheco', '/attorney')
    vi.advanceTimersByTime(30_000)
    expect(verifyHandoffToken(token)).not.toBeNull()
  })

  it('rejects garbage, empty, and signature-less inputs', () => {
    expect(verifyHandoffToken(null)).toBeNull()
    expect(verifyHandoffToken('')).toBeNull()
    expect(verifyHandoffToken('nodot')).toBeNull()
    expect(verifyHandoffToken('a.b')).toBeNull()
  })

  it('refuses to mint for an invalid or reserved slug', () => {
    expect(() => mintHandoffToken(attorney, 'Bad Slug!', '/attorney')).toThrow()
    expect(() => mintHandoffToken(attorney, 'app', '/attorney')).toThrow()
  })
})

describe('dest containment', () => {
  it('normalizes hostile dests to a safe internal path at mint time', () => {
    const token = mintHandoffToken(attorney, 'pacheco', 'https://evil.example/phish')
    expect(verifyHandoffToken(token)?.dest).toBe('/')
    const token2 = mintHandoffToken(attorney, 'pacheco', '//evil.example')
    expect(verifyHandoffToken(token2)?.dest).toBe('/')
  })
})

describe('handoffRedirectUrl', () => {
  it('targets the slug host exchange endpoint when the base domain is set', () => {
    process.env.TENANT_BASE_DOMAIN = 'instruments.legal'
    const url = handoffRedirectUrl('pacheco', 'tok.sig')
    expect(url).toBe('https://pacheco.instruments.legal/api/auth/handoff?token=tok.sig')
    delete process.env.TENANT_BASE_DOMAIN
  })
})
