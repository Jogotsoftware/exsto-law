// Hardening from the whole-clone security audit (2026-06-11):
//   1. safeInternalPath — closes the OAuth open-redirect (returnTo rides in an
//      unsigned state; //attacker.com passed the old startsWith('/') check).
//   2. checkPublicRateLimit — bounds the unauthenticated booking/intake route so
//      it can't be spammed into unbounded matter creation / email / calendar.
// Pure functions; no DB.
import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '../../apps/legal-demo/lib/safeRedirect'
import { checkPublicRateLimit } from '../../apps/legal-demo/lib/rateLimit'

describe('safeInternalPath (open-redirect guard)', () => {
  it('rejects protocol-relative and off-site targets', () => {
    for (const evil of [
      '//attacker.com/phishing',
      '//attacker.com',
      'https://attacker.com',
      'http://attacker.com',
      '/\\attacker.com',
      '\\\\attacker.com',
      'javascript:alert(1)',
      'data:text/html,x',
      '',
      null,
      undefined,
    ]) {
      expect(safeInternalPath(evil as string | null | undefined)).toBe('/attorney')
    }
  })

  it('preserves legitimate same-origin paths', () => {
    expect(safeInternalPath('/attorney/settings')).toBe('/attorney/settings')
    expect(safeInternalPath('/attorney/matters/abc?tab=research')).toBe(
      '/attorney/matters/abc?tab=research',
    )
    expect(safeInternalPath('/')).toBe('/')
  })

  it('honors a custom fallback', () => {
    expect(safeInternalPath('//evil', '/book')).toBe('/book')
  })
})

describe('checkPublicRateLimit', () => {
  it('allows up to the limit then blocks, per key', () => {
    const key = `test-ip-${Math.floor(Number(process.env.VITEST_WORKER_ID ?? '0')) + 1}-${'x'}`
    // Default limit is 20/min; drive one key past it and confirm a fresh key is
    // unaffected (isolation between callers).
    let lastAllowed = true
    let blockedAt = -1
    for (let i = 1; i <= 25; i++) {
      const d = checkPublicRateLimit(key)
      if (!d.allowed && blockedAt === -1) blockedAt = i
      lastAllowed = d.allowed
    }
    expect(blockedAt).toBeGreaterThan(0)
    expect(blockedAt).toBeLessThanOrEqual(21) // 20 allowed, 21st blocked
    expect(lastAllowed).toBe(false)

    const fresh = checkPublicRateLimit(`${key}-other`)
    expect(fresh.allowed).toBe(true)
    expect(fresh.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })
})
