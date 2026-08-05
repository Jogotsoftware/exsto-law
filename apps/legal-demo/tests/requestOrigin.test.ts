// ORIGIN-1 rule 2 — requestOrigin (apps/legal-demo/lib/requestOrigin.ts): the
// origin for redirects within a request flow. Pins the host allowlist: a
// hostile Host header must NEVER mint an arbitrary redirect origin (open
// redirect right after Set-Cookie), while the legitimate hosts — canonical,
// *.netlify.app previews, firm labels under TENANT_BASE_DOMAIN, localhost —
// pass through unchanged.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { requestOrigin } from '@/lib/requestOrigin'

const CANONICAL = 'https://exsto-law.netlify.app'

function req(host: string | null, forwarded?: string): Request {
  const headers = new Headers()
  if (host !== null) headers.set('host', host)
  if (forwarded !== undefined) headers.set('x-forwarded-host', forwarded)
  // The URL's own origin is deliberately garbage: on Netlify request.url
  // carries an internal port, which is exactly why requestOrigin ignores it.
  return new Request('http://internal:80/api/whatever', { headers })
}

const ENV_KEYS = ['NEXT_PUBLIC_BASE_URL', 'APP_BASE_URL', 'URL', 'TENANT_BASE_DOMAIN'] as const
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('requestOrigin', () => {
  it('a hostile host header falls back to the canonical base', () => {
    expect(requestOrigin(req('evil.example'))).toBe(CANONICAL)
    expect(requestOrigin(req('exsto-law.netlify.app.evil.example'))).toBe(CANONICAL)
    expect(requestOrigin(req(null))).toBe(CANONICAL)
  })

  it('x-forwarded-host wins over host — and is validated just as strictly', () => {
    expect(requestOrigin(req('exsto-law.netlify.app', 'evil.example'))).toBe(CANONICAL)
  })

  it('allows the canonical host and any *.netlify.app host (previews)', () => {
    expect(requestOrigin(req('exsto-law.netlify.app'))).toBe(CANONICAL)
    expect(requestOrigin(req('deploy-preview-12--exsto-law.netlify.app'))).toBe(
      'https://deploy-preview-12--exsto-law.netlify.app',
    )
  })

  it('allows the configured canonical base host', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.com'
    expect(requestOrigin(req('app.example.com'))).toBe('https://app.example.com')
  })

  it('allows a firm-label host only when TENANT_BASE_DOMAIN is set', () => {
    expect(requestOrigin(req('pacheco.instruments.legal'))).toBe(CANONICAL)
    process.env.TENANT_BASE_DOMAIN = 'instruments.legal'
    expect(requestOrigin(req('pacheco.instruments.legal'))).toBe(
      'https://pacheco.instruments.legal',
    )
    // The bare base domain is a valid host too; a multi-label prefix is not.
    expect(requestOrigin(req('instruments.legal'))).toBe('https://instruments.legal')
    expect(requestOrigin(req('a.b.instruments.legal'))).toBe(CANONICAL)
  })

  it('localhost keeps http (dev is the one non-https host)', () => {
    expect(requestOrigin(req('localhost:3000'))).toBe('http://localhost:3000')
    expect(requestOrigin(req('localhost'))).toBe('http://localhost')
  })
})
