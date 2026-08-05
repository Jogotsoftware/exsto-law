import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { resolvePublicFirm } from '@exsto/legal'
import { FirmLandingPage } from '@/components/FirmLandingPage'
import LoginPage from './login/page'

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
    const firm = await resolvePublicFirm(slug)
    if (!firm) notFound()
    return <FirmLandingPage firmName={firm.firmName} />
  }
  return <LoginPage />
}
