// The portal bridge only trusts Supabase's email_confirmed_at when the project
// REQUIRES email confirmation. This guard enforces that against GoTrue's own
// settings and fails closed otherwise — the control that closes the sign-up →
// sign-in account-takeover hole independently of the dashboard toggle.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  confirmGateFromSettings,
  emailConfirmationGate,
  __resetConfirmGuardCacheForTest,
} from '@/lib/supabaseConfirmGuard'

const URL = 'https://proj.supabase.co'
const KEY = 'anon-key'

// Minimal Response-like stub so we don't depend on global fetch in unit tests.
function res(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response
}

describe('confirmGateFromSettings — pure decision', () => {
  it('treats explicit mailer_autoconfirm:false as ok (confirmation required)', () => {
    expect(confirmGateFromSettings({ mailer_autoconfirm: false })).toBe('ok')
  })
  it('treats mailer_autoconfirm:true as unsafe (auto-confirm on)', () => {
    expect(confirmGateFromSettings({ mailer_autoconfirm: true })).toBe('autoconfirm-on')
  })
  it('fails closed (unknown) when the field is missing', () => {
    expect(confirmGateFromSettings({ disable_signup: false })).toBe('unknown')
  })
  it('fails closed (unknown) for non-object / null bodies', () => {
    expect(confirmGateFromSettings(null)).toBe('unknown')
    expect(confirmGateFromSettings('nope')).toBe('unknown')
    expect(confirmGateFromSettings(undefined)).toBe('unknown')
  })
  it('does not coerce a truthy/odd field to safe', () => {
    expect(confirmGateFromSettings({ mailer_autoconfirm: 'false' })).toBe('unknown')
    expect(confirmGateFromSettings({ mailer_autoconfirm: 0 })).toBe('unknown')
  })
})

describe('emailConfirmationGate — fetch + fail-closed + cache', () => {
  beforeEach(() => __resetConfirmGuardCacheForTest())

  it('returns ok when GoTrue reports auto-confirm OFF', async () => {
    const gate = await emailConfirmationGate({
      settingsUrl: URL,
      anonKey: KEY,
      fetchImpl: async () => res(true, { mailer_autoconfirm: false }),
      now: 1000,
    })
    expect(gate).toBe('ok')
  })

  it('returns autoconfirm-on (caller fails closed) when GoTrue reports it ON', async () => {
    const gate = await emailConfirmationGate({
      settingsUrl: URL,
      anonKey: KEY,
      fetchImpl: async () => res(true, { mailer_autoconfirm: true }),
      now: 1000,
    })
    expect(gate).toBe('autoconfirm-on')
  })

  it('fails closed (unknown) on a non-OK settings response', async () => {
    const gate = await emailConfirmationGate({
      settingsUrl: URL,
      anonKey: KEY,
      fetchImpl: async () => res(false, {}),
      now: 1000,
    })
    expect(gate).toBe('unknown')
  })

  it('fails closed (unknown) when the fetch throws and nothing is cached', async () => {
    const gate = await emailConfirmationGate({
      settingsUrl: URL,
      anonKey: KEY,
      fetchImpl: async () => {
        throw new Error('network down')
      },
      now: 1000,
    })
    expect(gate).toBe('unknown')
  })

  it('hits the settings URL with the anon apikey header', async () => {
    let seenUrl = ''
    let seenKey: string | undefined
    await emailConfirmationGate({
      settingsUrl: URL,
      anonKey: KEY,
      fetchImpl: async (input, init) => {
        seenUrl = String(input)
        seenKey = (init?.headers as Record<string, string>)?.apikey
        return res(true, { mailer_autoconfirm: false })
      },
      now: 1000,
    })
    expect(seenUrl).toBe(`${URL}/auth/v1/settings`)
    expect(seenKey).toBe(KEY)
  })

  it('serves a recent cached ok on a later transient failure (availability)', async () => {
    // Prime the cache with a successful safe reading.
    await emailConfirmationGate({
      settingsUrl: URL,
      anonKey: KEY,
      fetchImpl: async () => res(true, { mailer_autoconfirm: false }),
      now: 1000,
    })
    // A blip 5s later still returns ok from cache rather than locking clients out.
    const gate = await emailConfirmationGate({
      settingsUrl: URL,
      anonKey: KEY,
      fetchImpl: async () => {
        throw new Error('blip')
      },
      now: 6000,
    })
    expect(gate).toBe('ok')
  })

  it('never caches an unsafe reading — a flip to auto-confirm is caught at once', async () => {
    // First call sees safe and caches it.
    await emailConfirmationGate({
      settingsUrl: URL,
      anonKey: KEY,
      fetchImpl: async () => res(true, { mailer_autoconfirm: false }),
      now: 1000,
    })
    // After the TTL, a live read showing auto-confirm ON must surface, not 'ok'.
    const gate = await emailConfirmationGate({
      settingsUrl: URL,
      anonKey: KEY,
      fetchImpl: async () => res(true, { mailer_autoconfirm: true }),
      now: 1000 + 61_000,
    })
    expect(gate).toBe('autoconfirm-on')
  })
})
