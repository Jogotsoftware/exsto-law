// Plumbing test for the public client MCP caller (feat/captcha-widget).
//
// The booking CAPTCHA gate's frontend half hinges on one contract: when a
// captchaToken is supplied, callClientMcp must place it at the POST body
// TOP LEVEL as `captchaToken` (the exact field /api/client/mcp reads). When it
// is NOT supplied, the body must be exactly { toolName, input } as before so the
// existing read/booking flow is unchanged. We assert both by stubbing fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { callClientMcp } from '../lib/mcpClient'

function stubFetchOnce(result: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ result }),
    text: async () => JSON.stringify({ result }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)
  expect(call, 'fetch was not called').toBeTruthy()
  const init = call![1] as RequestInit
  return JSON.parse(init.body as string) as Record<string, unknown>
}

describe('callClientMcp — captchaToken plumbing', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('includes captchaToken at the body top-level when provided', async () => {
    const fetchMock = stubFetchOnce({ ok: true })
    await callClientMcp({
      toolName: 'legal.booking.submit',
      input: { clientFullName: 'Marcus' },
      captchaToken: 'cf-token-123',
    })

    const body = lastBody(fetchMock)
    expect(body.toolName).toBe('legal.booking.submit')
    expect(body.input).toEqual({ clientFullName: 'Marcus' })
    // Top-level, not nested under input — this is the field the server reads.
    expect(body.captchaToken).toBe('cf-token-123')
  })

  it('omits captchaToken entirely when not provided (unchanged read/booking body)', async () => {
    const fetchMock = stubFetchOnce({ services: [] })
    await callClientMcp({ toolName: 'legal.service.list' })

    const body = lastBody(fetchMock)
    expect(body.toolName).toBe('legal.service.list')
    expect('captchaToken' in body).toBe(false)
  })

  it('omits captchaToken when passed an empty/undefined token', async () => {
    const fetchMock = stubFetchOnce({ ok: true })
    await callClientMcp({
      toolName: 'legal.booking.submit',
      input: { x: 1 },
      captchaToken: undefined,
    })

    const body = lastBody(fetchMock)
    expect('captchaToken' in body).toBe(false)
  })

  it('returns the unwrapped result envelope', async () => {
    stubFetchOnce({ value: 42 })
    const out = await callClientMcp<{ value: number }>({ toolName: 'legal.service.list' })
    expect(out).toEqual({ value: 42 })
  })
})
