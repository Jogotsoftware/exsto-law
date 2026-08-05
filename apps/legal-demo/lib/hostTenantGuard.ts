// HOST-TENANCY-1 — "the firm subdomain you are standing on must match the tenant
// you are acting as." Session cookies are host-only, so a firm host can only ever
// receive sessions minted ON it; this guard is what makes minting (and the
// attorney API resolver, as belt-and-suspenders) refuse a wrong-firm binding in
// the first place. Fail closed: any lookup doubt reads as mismatch.
//
// x-firm-slug/x-firm-host are set exclusively by middleware.ts (client-supplied
// values are stripped there), so trusting them here does not trust the client.

import { getPublicSlugForTenant } from '@exsto/legal'

export interface FirmHostContext {
  slug: string
  isFirmHost: true
}

// The firm-host context of a request, or null on legacy/canonical hosts (where
// no host↔tenant relationship exists to enforce).
export function firmHostFromRequest(request: Request): FirmHostContext | null {
  if (request.headers.get('x-firm-host') !== '1') return null
  const slug = (request.headers.get('x-firm-slug') ?? '').trim().toLowerCase()
  if (!slug) return null
  return { slug, isFirmHost: true }
}

export type HostTenantCheck =
  | { ok: true }
  | { ok: false; hostSlug: string; tenantSlug: string | null }

// Does this tenant belong on this request's host? Trivially ok off firm hosts.
// On a firm host, the tenant's public_slug (60s-cached read) must equal the host
// label — a tenant with NO slug fails on every firm host (it has no subdomain).
export async function checkTenantMatchesHost(
  tenantId: string,
  request: Request,
): Promise<HostTenantCheck> {
  const host = firmHostFromRequest(request)
  if (!host) return { ok: true }
  const tenantSlug = await getPublicSlugForTenant(tenantId)
  if (tenantSlug && tenantSlug === host.slug) return { ok: true }
  return { ok: false, hostSlug: host.slug, tenantSlug }
}
