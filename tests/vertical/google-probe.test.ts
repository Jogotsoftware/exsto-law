// WP1.1: the dual capability probe is what makes a Google connection 'connected'.
// It must pass ONLY when BOTH a Gmail profile read AND a Calendar list succeed,
// and surface a scrubbed detail otherwise. Pure: global.fetch is stubbed, no DB,
// no network — guards the gate logic that the exchange flow relies on.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { probeGoogleCapabilities } from '@exsto/legal'

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
const CAL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList'

function stubFetch(handler: (url: string) => { status: number; body?: string }) {
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = String(input)
    const { status, body } = handler(url)
    return Promise.resolve(
      new Response(body ?? '', { status, statusText: status === 200 ? 'OK' : 'ERR' }),
    )
  })
}

describe('probeGoogleCapabilities (no network)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('passes only when BOTH Gmail profile read and Calendar list succeed', async () => {
    stubFetch(() => ({ status: 200, body: '{}' }))
    expect(await probeGoogleCapabilities('tok')).toEqual({ ok: true })
  })

  it('fails (with detail) when the Gmail profile read fails', async () => {
    stubFetch((url) =>
      url.startsWith(GMAIL) ? { status: 403, body: 'no gmail' } : { status: 200 },
    )
    const res = await probeGoogleCapabilities('tok')
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.detail).toMatch(/Gmail profile read failed.*403/)
  })

  it('fails (with detail) when the Calendar list fails even though Gmail passed', async () => {
    stubFetch((url) => (url.startsWith(CAL) ? { status: 401, body: 'no cal' } : { status: 200 }))
    const res = await probeGoogleCapabilities('tok')
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.detail).toMatch(/Calendar list failed.*401/)
  })

  it('never lets the bearer token leak into the failure detail', async () => {
    stubFetch(() => ({ status: 500, body: 'boom' }))
    const res = await probeGoogleCapabilities('super-secret-access-token')
    expect(JSON.stringify(res)).not.toContain('super-secret-access-token')
  })
})
