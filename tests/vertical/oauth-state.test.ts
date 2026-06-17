// OAuth state signing (exsto-public-surface): the state round-trips through the
// browser carrying tenantId + returnTo, so it must be HMAC-signed and verified
// fail-closed. Pure crypto; no DB.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signOAuthState, verifyOAuthState } from '@exsto/legal'

describe('OAuth state signing (no DB)', () => {
  const prior = process.env.OAUTH_STATE_SECRET
  beforeAll(() => {
    process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-32-bytes-min!!'
  })
  afterAll(() => {
    if (prior === undefined) delete process.env.OAUTH_STATE_SECRET
    else process.env.OAUTH_STATE_SECRET = prior
  })

  it('round-trips a signed payload', () => {
    const payload = {
      tenantId: 't-1',
      returnTo: '/attorney/settings',
      mode: 'calendar',
      nonce: 'n',
    }
    const state = signOAuthState(payload)
    expect(state).toContain('.')
    expect(verifyOAuthState(state)).toEqual(payload)
  })

  it('binds the connecting attorney (actorId) tamper-proof into the state', () => {
    // Per-attorney connect (migration 0016): the callback stores Google/Gmail
    // credentials under the actorId carried here, so it MUST be signed — a forged
    // actorId would let one attorney connect under another's identity.
    const payload = {
      tenantId: 't-1',
      returnTo: '/attorney/settings',
      mode: 'calendar',
      actorId: 'attorney-A',
      nonce: 'n',
    }
    const state = signOAuthState(payload)
    expect(verifyOAuthState(state)).toEqual(payload)

    // Swapping actorId while keeping the signature is rejected.
    const sig = state.slice(state.indexOf('.') + 1)
    const forged = Buffer.from(JSON.stringify({ ...payload, actorId: 'attorney-B' })).toString(
      'base64url',
    )
    expect(() => verifyOAuthState(`${forged}.${sig}`)).toThrow(/signature mismatch/i)
  })

  it('rejects a tampered payload (forged tenantId / returnTo)', () => {
    const state = signOAuthState({ tenantId: 'victim', returnTo: '/attorney', mode: 'calendar' })
    const [payloadB64, sig] = state.split('.')
    // Attacker swaps the payload but keeps the original signature.
    const forged = Buffer.from(
      JSON.stringify({ tenantId: 'attacker', returnTo: '//evil.com', mode: 'calendar' }),
    ).toString('base64url')
    expect(() => verifyOAuthState(`${forged}.${sig}`)).toThrow(/signature mismatch/i)
    // A truncated / malformed state is also rejected.
    expect(() => verifyOAuthState(payloadB64!)).toThrow(/Invalid OAuth state/i)
    expect(() => verifyOAuthState(`${payloadB64}.deadbeef`)).toThrow()
  })

  it('a different secret cannot verify (key isolation)', () => {
    const state = signOAuthState({ tenantId: 't', returnTo: '/', mode: 'signin' })
    process.env.OAUTH_STATE_SECRET = 'a-totally-different-secret-32-bytes!!'
    expect(() => verifyOAuthState(state)).toThrow(/signature mismatch/i)
    process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-32-bytes-min!!'
  })

  it('fails closed when no secret is configured', () => {
    delete process.env.OAUTH_STATE_SECRET
    expect(() => signOAuthState({ a: 1 })).toThrow(/OAUTH_STATE_SECRET is required/i)
    process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-32-bytes-min!!'
  })
})
