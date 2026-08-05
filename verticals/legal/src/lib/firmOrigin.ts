// ORIGIN-1 — the ONE place that decides which https origin a generated absolute URL
// gets. Before this module, ~30 call sites each re-derived a single global base URL
// (NEXT_PUBLIC_BASE_URL ?? URL ?? the Netlify host), which made every email, e-sign,
// pay and portal link firm-BLIND: under per-tenant subdomains ({slug}.instruments.legal)
// a Pacheco client would be mailed a link to the wrong host. Three rules now:
//
//   1. Links that LEAVE the app (emails, invites, e-sign, pay, portal CTAs)
//      → firmOriginForTenant(tenantId): the tenant's own subdomain when the platform
//        has a base domain configured, else the canonical base. Never wrong-firm.
//   2. Redirects WITHIN a request flow → requestOrigin() (app-side helper, not here):
//        stay on the host the user is on (a cross-host redirect right after Set-Cookie
//        would strand a host-only session cookie).
//   3. Fixed protocol endpoints (Google OAuth redirect URI, admin console)
//      → appBaseUrl(): the canonical host, always.
//
// Everything reads env AT CALL TIME, never at import: several former call sites were
// module-level constants frozen at import, which made env changes (and the worker,
// which boots long before some envs are wired) silently fall to the hardcoded default.
//
// Dormant-safe: while TENANT_BASE_DOMAIN is unset (pre-DNS-cutover), every function
// returns the canonical base — a strict no-op vs. the historical behavior.

import { withTenant } from '@exsto/shared'

// Matches middleware.ts SLUG_RE — a single DNS label.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})$/

// Historical last-resort default; the Netlify site name never changes, so old links
// keep resolving even after the custom-domain cutover.
const FALLBACK_BASE = 'https://exsto-law.netlify.app'

// The canonical app origin. APP_BASE_URL exists for non-Next processes (the Render
// worker has no NEXT_PUBLIC_* injection); URL is Netlify's injected deploy URL.
export function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_BASE_URL ?? process.env.APP_BASE_URL ?? process.env.URL ?? FALLBACK_BASE
  return raw.replace(/\/$/, '')
}

// The base domain firms hang off of (e.g. 'instruments.legal'), or null while the
// subdomain program is dormant. Mirrors middleware.ts slugFromHost's gate.
export function tenantBaseDomain(): string | null {
  const d = (process.env.TENANT_BASE_DOMAIN ?? '').trim().toLowerCase()
  return d || null
}

// A firm's public origin from its slug. Falls back to the canonical base when the
// platform is dormant or the slug is missing/invalid — never throws, because link
// generation must not take a booking or an email down.
export function firmOriginFromSlug(slug: string | null | undefined): string {
  const base = tenantBaseDomain()
  const s = (slug ?? '').trim().toLowerCase()
  if (!base || !s || !SLUG_RE.test(s)) return appBaseUrl()
  return `https://${s}.${base}`
}

// tenant id → public_slug, cached in-process. Email-heavy paths (a notification fanout
// renders many links for one tenant) must not pay a DB round-trip per link; 60s stale
// is fine because slugs change only via an admin action.
const SLUG_TTL_MS = 60_000
const slugCache = new Map<string, { slug: string | null; at: number }>()

// Own-tenant read under withTenant (RLS-safe under both owner and authenticator roles;
// same rationale as resolvePublicIntakeActor in api/publicBooking.ts).
async function readPublicSlug(tenantId: string): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    const res = await client.query<{ public_slug: string | null }>(
      `SELECT public_slug FROM tenant WHERE id = $1`,
      [tenantId],
    )
    return res.rows[0]?.public_slug ?? null
  })
}

export async function getPublicSlugForTenant(tenantId: string): Promise<string | null> {
  const hit = slugCache.get(tenantId)
  if (hit && Date.now() - hit.at < SLUG_TTL_MS) return hit.slug
  const slug = await readPublicSlug(tenantId)
  slugCache.set(tenantId, { slug, at: Date.now() })
  return slug
}

// Rule 1 — the origin for links that leave the app on behalf of a firm. Skips the DB
// entirely while dormant, so pre-cutover behavior is byte-identical to the old chain.
export async function firmOriginForTenant(tenantId: string): Promise<string> {
  if (!tenantBaseDomain()) return appBaseUrl()
  return firmOriginFromSlug(await getPublicSlugForTenant(tenantId))
}

// Test seam: the cache would otherwise leak firm A's slug into firm B's assertions.
export function _clearFirmOriginCache(): void {
  slugCache.clear()
}
