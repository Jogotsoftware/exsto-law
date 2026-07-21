// Signing-link token: compact format round-trip + legacy-format acceptance.
// The compact format exists because Gmail silently hard-dropped signing emails
// carrying the ~300-char JSON tokens (phishing fingerprint); links already
// delivered in the old format must keep verifying forever, so both paths are
// pinned here.
import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  signSigningToken,
  verifySigningToken,
  type SigningTokenPayload,
} from '../../verticals/legal/src/esign/signingToken.js'

const TENANT = 'ae5530a1-05c7-4241-a38e-79bd186c1bbb'
const ENVELOPE = '28c2c77e-ca5b-4dc4-9372-a494ed2157cf'
const REQUEST = '973add87-3f14-4137-ba7e-64508d514e3d'
const NOW = 1_700_000_000_000

beforeAll(() => {
  process.env.ESIGN_SIGNING_SECRET = 'test-secret-at-least-16-chars'
})

// The pre-compact minting logic, verbatim — legacy links in delivered emails
// look exactly like this.
function mintLegacyToken(payload: SigningTokenPayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = createHmac('sha256', process.env.ESIGN_SIGNING_SECRET as string)
    .update(payloadB64)
    .digest('base64url')
  return `${payloadB64}.${mac}`
}

describe('compact signing token', () => {
  it('round-trips all fields and defaults scope to sign', () => {
    const token = signSigningToken(
      { requestId: REQUEST, envelopeId: ENVELOPE, tenantId: TENANT },
      1000 * 60 * 60,
      NOW,
    )
    const out = verifySigningToken(token, NOW)
    expect(out.requestId).toBe(REQUEST)
    expect(out.envelopeId).toBe(ENVELOPE)
    expect(out.tenantId).toBe(TENANT)
    expect(out.scope).toBe('sign')
    // exp is stored at second precision
    expect(out.exp).toBe(Math.floor((NOW + 1000 * 60 * 60) / 1000) * 1000)
  })

  it('is short, dot-free, and URL-safe — the whole point', () => {
    const token = signSigningToken({ requestId: REQUEST, envelopeId: ENVELOPE, tenantId: TENANT })
    expect(token.length).toBe(96)
    expect(token).not.toContain('.')
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encodeURIComponent(token)).toBe(token)
  })

  it('round-trips the view scope', () => {
    const token = signSigningToken(
      { requestId: REQUEST, envelopeId: ENVELOPE, tenantId: TENANT, scope: 'view' },
      1000,
      NOW,
    )
    expect(verifySigningToken(token, NOW).scope).toBe('view')
  })

  it('rejects a tampered token', () => {
    const token = signSigningToken(
      { requestId: REQUEST, envelopeId: ENVELOPE, tenantId: TENANT },
      1000,
      NOW,
    )
    const i = 20
    const tampered = token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1)
    expect(() => verifySigningToken(tampered, NOW)).toThrow(/mismatch|Invalid/)
  })

  it('rejects an expired token with the resend message', () => {
    const token = signSigningToken(
      { requestId: REQUEST, envelopeId: ENVELOPE, tenantId: TENANT },
      1000,
      NOW,
    )
    expect(() => verifySigningToken(token, NOW + 2000)).toThrow(/expired/)
  })

  it('rejects garbage of the wrong shape', () => {
    expect(() => verifySigningToken('short', NOW)).toThrow(/Invalid/)
    expect(() => verifySigningToken('x'.repeat(95), NOW)).toThrow(/Invalid/)
    expect(() => verifySigningToken(null, NOW)).toThrow(/Missing/)
  })
})

describe('legacy signing token (already-delivered links)', () => {
  it('still verifies a legacy token, including missing scope → sign default at call sites', () => {
    const legacy = mintLegacyToken({
      requestId: REQUEST,
      envelopeId: ENVELOPE,
      tenantId: TENANT,
      exp: NOW + 60_000,
    })
    expect(legacy).toContain('.')
    const out = verifySigningToken(legacy, NOW)
    expect(out.requestId).toBe(REQUEST)
    expect(out.envelopeId).toBe(ENVELOPE)
    expect(out.tenantId).toBe(TENANT)
    expect(out.scope).toBeUndefined()
  })

  it('still verifies a legacy view-scope token', () => {
    const legacy = mintLegacyToken({
      requestId: REQUEST,
      envelopeId: ENVELOPE,
      tenantId: TENANT,
      exp: NOW + 60_000,
      scope: 'view',
    })
    expect(verifySigningToken(legacy, NOW).scope).toBe('view')
  })

  it('rejects a tampered legacy token', () => {
    const legacy = mintLegacyToken({
      requestId: REQUEST,
      envelopeId: ENVELOPE,
      tenantId: TENANT,
      exp: NOW + 60_000,
    })
    expect(() => verifySigningToken(`${legacy}x`, NOW)).toThrow(/mismatch/)
  })

  it('rejects an expired legacy token', () => {
    const legacy = mintLegacyToken({
      requestId: REQUEST,
      envelopeId: ENVELOPE,
      tenantId: TENANT,
      exp: NOW - 1,
    })
    expect(() => verifySigningToken(legacy, NOW)).toThrow(/expired/)
  })
})
