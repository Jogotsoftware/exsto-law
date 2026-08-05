// HOST-TENANCY-1 — the guard that makes "the firm host you are standing on must
// match the tenant you are acting as" real. Session mint + the attorney resolver
// both call checkTenantMatchesHost, so its fail-closed edges (slug-less tenant,
// header pairs that only middleware may set) are what keep a wrong-firm session
// off a firm subdomain.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPublicSlugForTenantMock = vi.hoisted(() => vi.fn())
vi.mock('@exsto/legal', () => ({ getPublicSlugForTenant: getPublicSlugForTenantMock }))

import { checkTenantMatchesHost, firmHostFromRequest } from '@/lib/hostTenantGuard'

const TENANT = '11111111-1111-1111-1111-111111111111'

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api/whatever', { headers })
}

beforeEach(() => {
  getPublicSlugForTenantMock.mockReset()
})

describe('firmHostFromRequest', () => {
  it('legacy/canonical hosts (no x-firm-* headers) have no firm-host context', () => {
    expect(firmHostFromRequest(req())).toBeNull()
  })

  it('a slug without the host marker is the ?firm=/cookie fallback, not a firm host', () => {
    expect(firmHostFromRequest(req({ 'x-firm-slug': 'pacheco' }))).toBeNull()
  })

  it('a host marker without a slug is malformed — fail closed to null', () => {
    expect(firmHostFromRequest(req({ 'x-firm-host': '1' }))).toBeNull()
    expect(firmHostFromRequest(req({ 'x-firm-host': '1', 'x-firm-slug': '  ' }))).toBeNull()
  })

  it('both headers together yield the firm-host context', () => {
    expect(firmHostFromRequest(req({ 'x-firm-host': '1', 'x-firm-slug': 'pacheco' }))).toEqual({
      slug: 'pacheco',
      isFirmHost: true,
    })
  })
})

describe('checkTenantMatchesHost', () => {
  it('is trivially ok off firm hosts — and never touches the DB', async () => {
    await expect(checkTenantMatchesHost(TENANT, req())).resolves.toEqual({ ok: true })
    expect(getPublicSlugForTenantMock).not.toHaveBeenCalled()
  })

  it('ok when the tenant public_slug matches the host label', async () => {
    getPublicSlugForTenantMock.mockResolvedValue('pacheco')
    await expect(
      checkTenantMatchesHost(TENANT, req({ 'x-firm-host': '1', 'x-firm-slug': 'pacheco' })),
    ).resolves.toEqual({ ok: true })
    expect(getPublicSlugForTenantMock).toHaveBeenCalledWith(TENANT)
  })

  it('fails on a wrong-firm tenant', async () => {
    getPublicSlugForTenantMock.mockResolvedValue('otherfirm')
    await expect(
      checkTenantMatchesHost(TENANT, req({ 'x-firm-host': '1', 'x-firm-slug': 'pacheco' })),
    ).resolves.toEqual({ ok: false, hostSlug: 'pacheco', tenantSlug: 'otherfirm' })
  })

  it('fails closed for a tenant with NO public slug — it has no subdomain at all', async () => {
    getPublicSlugForTenantMock.mockResolvedValue(null)
    await expect(
      checkTenantMatchesHost(TENANT, req({ 'x-firm-host': '1', 'x-firm-slug': 'pacheco' })),
    ).resolves.toEqual({ ok: false, hostSlug: 'pacheco', tenantSlug: null })
  })
})
