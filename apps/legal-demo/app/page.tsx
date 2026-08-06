import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getPublicFirmSite } from '@exsto/legal'
import { FirmLandingPage } from '@/components/FirmLandingPage'
import { PRODUCT_TAGLINE } from '@/lib/brand'
import LoginPage from './login/page'

// FIRM-LANDING-3 — link-share metadata is host-aware like the page: on a firm
// host the card carries the FIRM's name + the firm-tinted mark (/og), so a
// pasted tenant link previews the firm, not the product. metadataBase comes
// from the request host so the og:image URL is absolute on whatever origin
// the link was shared from. Non-firm hosts inherit the product defaults.
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  const slug = (h.get('x-firm-slug') ?? '').trim().toLowerCase()
  if (!slug || h.get('x-firm-host') !== '1') return {}
  const site = await getPublicFirmSite(slug)
  if (!site) return {}
  const host = h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return {
    ...(host ? { metadataBase: new URL(`${proto}://${host}`) } : {}),
    title: site.firmName,
    description: site.tagline ?? PRODUCT_TAGLINE,
    openGraph: {
      title: site.firmName,
      description: site.tagline ?? PRODUCT_TAGLINE,
      siteName: PRODUCT_TAGLINE,
      images: [{ url: '/og', width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image' },
  }
}

// HOST-TENANCY-1 — the root page is host-aware. On a firm subdomain
// ({slug}.TENANT_BASE_DOMAIN) the public sees the firm's landing page, and an
// unknown label is a dead host (404) — never the attorney login, which belongs
// to the canonical/legacy hosts and keeps rendering here unchanged (it also
// lives at /login on every host). The headers are middleware-authoritative:
// client-supplied x-firm-* values are stripped at the edge before injection.

// Which page renders depends on the request's HOST, and the firm branch reads
// the DB — a statically cached render would leak one host's answer to another.
export const dynamic = 'force-dynamic'

export default async function RootPage(): Promise<React.JSX.Element> {
  const h = await headers()
  const slug = (h.get('x-firm-slug') ?? '').trim().toLowerCase()
  // x-firm-host distinguishes "slug came from the host" (authoritative — an
  // unknown firm must 404) from the legacy ?firm=/cookie fallback, which never
  // changes what the canonical root shows.
  if (slug && h.get('x-firm-host') === '1') {
    // FIRM-LANDING-2 — one composed public-safe read: identity + tagline/about
    // + set contact fields + the bookable-services list. Fails closed exactly
    // like resolvePublicFirm did (unknown slug → null → 404).
    const site = await getPublicFirmSite(slug)
    if (!site) notFound()
    return <FirmLandingPage site={site} />
  }
  return <LoginPage />
}
