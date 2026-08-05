// HOST-TENANCY-1 — slugFromHost is the edge-side "which firm host am I on?"
// decision. It must stay dormant with no TENANT_BASE_DOMAIN (localhost and
// *.netlify.app must never misparse as firms), and on the real base domain it
// must accept exactly one well-formed, non-reserved label — the apex, www,
// product hosts and multi-label prefixes are infrastructure, never firms.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// middleware.ts imports NextResponse for the handler itself; slugFromHost is
// pure. Stub next/server so the unit test doesn't drag the Next server runtime
// into vitest.
vi.mock('next/server', () => ({ NextResponse: { next: (): Record<string, never> => ({}) } }))

import { slugFromHost } from '@/middleware'

const saved: { domain: string | undefined } = { domain: undefined }

beforeEach(() => {
  saved.domain = process.env.TENANT_BASE_DOMAIN
  delete process.env.TENANT_BASE_DOMAIN
})

afterEach(() => {
  if (saved.domain === undefined) delete process.env.TENANT_BASE_DOMAIN
  else process.env.TENANT_BASE_DOMAIN = saved.domain
})

describe('slugFromHost', () => {
  it('is dormant while TENANT_BASE_DOMAIN is unset', () => {
    expect(slugFromHost('pacheco.instruments.legal')).toBeNull()
    expect(slugFromHost('instruments.legal')).toBeNull()
    expect(slugFromHost('exsto-law.netlify.app')).toBeNull()
    expect(slugFromHost('localhost')).toBeNull()
  })

  describe('with TENANT_BASE_DOMAIN=instruments.legal', () => {
    beforeEach(() => {
      process.env.TENANT_BASE_DOMAIN = 'instruments.legal'
    })

    it('parses a firm label under the base domain', () => {
      expect(slugFromHost('pacheco.instruments.legal')).toBe('pacheco')
      expect(slugFromHost('smith-law.instruments.legal')).toBe('smith-law')
    })

    it('the apex is not a firm', () => {
      expect(slugFromHost('instruments.legal')).toBeNull()
    })

    it('reserved labels are infrastructure, never firms', () => {
      expect(slugFromHost('www.instruments.legal')).toBeNull()
      expect(slugFromHost('app.instruments.legal')).toBeNull()
      expect(slugFromHost('portal.instruments.legal')).toBeNull()
      expect(slugFromHost('admin.instruments.legal')).toBeNull()
    })

    it('multi-label prefixes are not firms', () => {
      expect(slugFromHost('a.b.instruments.legal')).toBeNull()
    })

    it('rejects malformed labels', () => {
      expect(slugFromHost('pa_checo.instruments.legal')).toBeNull()
      expect(slugFromHost('-pacheco.instruments.legal')).toBeNull()
      expect(slugFromHost('pacheco-.instruments.legal')).toBeNull()
    })

    it('unrelated hosts never match', () => {
      expect(slugFromHost('exsto-law.netlify.app')).toBeNull()
      expect(slugFromHost('evil-instruments.legal')).toBeNull()
      expect(slugFromHost('pacheco.instruments.legal.evil.example')).toBeNull()
    })

    it('is case-insensitive (DNS is), returning the canonical lowercase slug', () => {
      expect(slugFromHost('PACHECO.Instruments.Legal')).toBe('pacheco')
    })
  })
})
