// Security unit tests for the PUBLIC booking-manage token (no DB needed). The
// HMAC token IS the authorization for the unauthenticated /book/manage routes,
// so forge / tamper / expiry / domain-separation / fail-closed must all hold.
import { describe, it, expect, beforeAll } from 'vitest'
import { createHmac } from 'node:crypto'
import { signBookingManageToken, verifyBookingManageToken } from '@exsto/legal'

const SECRET = 'test-secret-at-least-16-chars-long'
const payload = { matterEntityId: 'matter-1', tenantId: 'tenant-1' }

describe('bookingManageToken — public manage-link security', () => {
  beforeAll(() => {
    process.env.OAUTH_STATE_SECRET = SECRET
    delete process.env.ESIGN_SIGNING_SECRET // exercise the OAUTH_STATE_SECRET fallback
  })

  it('round-trips a valid token', () => {
    const out = verifyBookingManageToken(signBookingManageToken(payload))
    expect(out.matterEntityId).toBe('matter-1')
    expect(out.tenantId).toBe('tenant-1')
  })

  it('rejects a tampered payload (re-signing required, attacker lacks the secret)', () => {
    const sig = signBookingManageToken(payload).split('.')[1]
    const forged = Buffer.from(
      JSON.stringify({
        matterEntityId: 'matter-EVIL',
        tenantId: 'tenant-1',
        exp: Date.now() + 1e6,
      }),
    ).toString('base64url')
    expect(() => verifyBookingManageToken(`${forged}.${sig}`)).toThrow()
  })

  it('rejects a tampered signature', () => {
    const p = signBookingManageToken(payload).split('.')[0]
    expect(() => verifyBookingManageToken(`${p}.AAAAtampered`)).toThrow()
  })

  it('rejects an expired token (valid MAC, past exp)', () => {
    expect(() => verifyBookingManageToken(signBookingManageToken(payload, -1000))).toThrow(
      /expired/i,
    )
  })

  it('enforces domain separation — a bare-payload (e-sign/oauth-style) MAC does NOT verify', () => {
    const full = { ...payload, exp: Date.now() + 1e6 }
    const b64 = Buffer.from(JSON.stringify(full)).toString('base64url')
    // Mimic signingToken/oauthState: HMAC over the BARE payload (no 'booking-manage.' prefix).
    const bareMac = createHmac('sha256', SECRET).update(b64).digest('base64url')
    expect(() => verifyBookingManageToken(`${b64}.${bareMac}`)).toThrow()
  })

  it('rejects malformed tokens', () => {
    expect(() => verifyBookingManageToken(null)).toThrow()
    expect(() => verifyBookingManageToken('')).toThrow()
    expect(() => verifyBookingManageToken('no-dot')).toThrow()
    expect(() => verifyBookingManageToken('.sigonly')).toThrow()
  })

  it('rejects a payload with a mistyped field (exp as string), even with a valid MAC', () => {
    const bad = { matterEntityId: 'matter-1', tenantId: 'tenant-1', exp: 'soon' }
    const b64 = Buffer.from(JSON.stringify(bad)).toString('base64url')
    const sig = createHmac('sha256', SECRET).update(`booking-manage.${b64}`).digest('base64url')
    expect(() => verifyBookingManageToken(`${b64}.${sig}`)).toThrow()
  })

  it('fails closed when no secret is configured', () => {
    const o = process.env.OAUTH_STATE_SECRET
    delete process.env.OAUTH_STATE_SECRET
    delete process.env.ESIGN_SIGNING_SECRET
    expect(() => signBookingManageToken(payload)).toThrow()
    process.env.OAUTH_STATE_SECRET = o
  })

  it('fails closed when the secret is too short (<16 chars)', () => {
    const o = process.env.OAUTH_STATE_SECRET
    process.env.OAUTH_STATE_SECRET = 'short'
    delete process.env.ESIGN_SIGNING_SECRET
    expect(() => signBookingManageToken(payload)).toThrow()
    process.env.OAUTH_STATE_SECRET = o
  })
})
