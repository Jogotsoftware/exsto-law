// ORIGIN-1 — firm-aware URL origins (verticals/legal/src/lib/firmOrigin.ts).
// PURE unit tests: the tenant→public_slug read is mocked at the @exsto/shared
// seam (the tenant-actor-resolver.test.ts idiom) so no DB is needed. Pins the
// dormant invariant (TENANT_BASE_DOMAIN unset ⇒ the canonical chain, zero DB
// reads — prod behavior must be byte-identical until the env flips), the
// slug-origin composition, the invalid-slug fallback, and the slug cache.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const slugRows: Array<{ public_slug: string | null }> = []
let queryCount = 0
vi.mock('@exsto/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exsto/shared')>()
  return {
    ...actual,
    withTenant: vi.fn(async (_tenantId: string, fn: (client: unknown) => Promise<unknown>) =>
      fn({
        query: async () => {
          queryCount++
          return { rows: slugRows, rowCount: slugRows.length }
        },
      }),
    ),
  }
})
import {
  appBaseUrl,
  tenantBaseDomain,
  firmOriginFromSlug,
  firmOriginForTenant,
  _clearFirmOriginCache,
} from '../../verticals/legal/src/lib/firmOrigin.js'

const TENANT = 'ae5530a1-05c7-4241-a38e-79bd186c1bbb'
const CANONICAL = 'https://exsto-law.netlify.app'

// Everything reads env at call time, so the tests own these four keys for the
// duration of each case and restore whatever the outer environment had.
const ENV_KEYS = ['NEXT_PUBLIC_BASE_URL', 'APP_BASE_URL', 'URL', 'TENANT_BASE_DOMAIN'] as const
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  slugRows.length = 0
  queryCount = 0
  _clearFirmOriginCache()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('appBaseUrl — the canonical chain', () => {
  it('falls back to the historical Netlify host with nothing set', () => {
    expect(appBaseUrl()).toBe(CANONICAL)
  })

  it('prefers NEXT_PUBLIC_BASE_URL, then APP_BASE_URL, then URL — trailing slash stripped', () => {
    process.env.URL = 'https://from-url.example/'
    expect(appBaseUrl()).toBe('https://from-url.example')
    process.env.APP_BASE_URL = 'https://from-worker.example/'
    expect(appBaseUrl()).toBe('https://from-worker.example')
    process.env.NEXT_PUBLIC_BASE_URL = 'https://from-next.example/'
    expect(appBaseUrl()).toBe('https://from-next.example')
  })
})

describe('tenantBaseDomain', () => {
  it('is null while unset or blank (the dormant state)', () => {
    expect(tenantBaseDomain()).toBeNull()
    process.env.TENANT_BASE_DOMAIN = '   '
    expect(tenantBaseDomain()).toBeNull()
  })

  it('trims and lowercases a configured domain', () => {
    process.env.TENANT_BASE_DOMAIN = ' Instruments.Legal '
    expect(tenantBaseDomain()).toBe('instruments.legal')
  })
})

describe('firmOriginFromSlug', () => {
  it('composes https://<slug>.<base> when the platform has a base domain', () => {
    process.env.TENANT_BASE_DOMAIN = 'instruments.legal'
    expect(firmOriginFromSlug('pacheco')).toBe('https://pacheco.instruments.legal')
  })

  it('falls back to the canonical base while dormant', () => {
    expect(firmOriginFromSlug('pacheco')).toBe(CANONICAL)
  })

  it('falls back to the canonical base for a missing or invalid slug — never throws', () => {
    process.env.TENANT_BASE_DOMAIN = 'instruments.legal'
    expect(firmOriginFromSlug(null)).toBe(CANONICAL)
    expect(firmOriginFromSlug('')).toBe(CANONICAL)
    expect(firmOriginFromSlug('Bad_Slug!')).toBe(CANONICAL)
    // A dotted "slug" would mint an unrelated host — must be refused.
    expect(firmOriginFromSlug('a.b')).toBe(CANONICAL)
  })
})

describe('firmOriginForTenant', () => {
  it('dormant: returns the canonical base WITHOUT touching the DB', async () => {
    expect(await firmOriginForTenant(TENANT)).toBe(CANONICAL)
    expect(queryCount).toBe(0)
  })

  it("active: resolves the tenant's slug into its subdomain origin", async () => {
    process.env.TENANT_BASE_DOMAIN = 'instruments.legal'
    slugRows.push({ public_slug: 'pacheco' })
    expect(await firmOriginForTenant(TENANT)).toBe('https://pacheco.instruments.legal')
  })

  it('active with no slug on the tenant row: canonical fallback', async () => {
    process.env.TENANT_BASE_DOMAIN = 'instruments.legal'
    slugRows.push({ public_slug: null })
    expect(await firmOriginForTenant(TENANT)).toBe(CANONICAL)
  })

  it('caches the slug per tenant; _clearFirmOriginCache forces a re-read', async () => {
    process.env.TENANT_BASE_DOMAIN = 'instruments.legal'
    slugRows.push({ public_slug: 'pacheco' })
    await firmOriginForTenant(TENANT)
    await firmOriginForTenant(TENANT)
    expect(queryCount).toBe(1)
    _clearFirmOriginCache()
    await firmOriginForTenant(TENANT)
    expect(queryCount).toBe(2)
  })
})
