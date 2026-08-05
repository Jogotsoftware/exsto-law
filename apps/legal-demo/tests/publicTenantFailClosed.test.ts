// SECOND-FIRM-1 — resolvePublicTenant fails CLOSED in every branch. The old
// behavior silently landed slug-less public requests (legacy host, no ?firm=,
// no cookie) on the Dev Firm's tenant; now every branch either resolves a REAL
// firm or throws FirmNotFoundError with actionable copy. Routes map that to a
// 404, and the bare /book page renders a "use your firm's booking link" state.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@exsto/legal', () => ({
  resolvePublicFirm: vi.fn(async (slug: string) =>
    slug === 'goodfirm' ? { tenantId: 'tenant-good', firmName: 'Good Firm' } : null,
  ),
  resolvePublicIntakeActor: vi.fn(async () => 'actor-good'),
}))
import { resolvePublicTenant, FirmNotFoundError } from '../lib/publicTenant'

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://legacy-host.example/api/client/mcp', { headers })
}

describe('resolvePublicTenant (SECOND-FIRM-1)', () => {
  it('resolves a known slug to its firm + per-tenant actor', async () => {
    const pub = await resolvePublicTenant(req({ 'x-firm-slug': 'goodfirm' }))
    expect(pub).toEqual({
      tenantId: 'tenant-good',
      actorId: 'actor-good',
      firmName: 'Good Firm',
      slug: 'goodfirm',
    })
  })

  it('fails closed on an unknown slug', async () => {
    await expect(resolvePublicTenant(req({ 'x-firm-slug': 'nosuchfirm' }))).rejects.toBeInstanceOf(
      FirmNotFoundError,
    )
  })

  it('fails closed on a firm host that lost its slug', async () => {
    await expect(resolvePublicTenant(req({ 'x-firm-host': '1' }))).rejects.toBeInstanceOf(
      FirmNotFoundError,
    )
  })

  it('fails closed with actionable copy when NO firm is named at all (no env default)', async () => {
    const err = await resolvePublicTenant(req()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FirmNotFoundError)
    // The message must tell the caller HOW to fix it (their firm link), since
    // this is what a legacy-host visitor with no ?firm= ultimately sees.
    expect((err as Error).message).toMatch(/firm/i)
    expect((err as Error).message).toMatch(/\?firm=|subdomain/i)
  })
})
