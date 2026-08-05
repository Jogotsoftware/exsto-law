import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { firmOriginFromSlug } from '@exsto/legal'
import PublicBookingPage from './PublicBookingClient'

// HOST-TENANCY-1 — path-slug booking coexists with firm subdomains. On a firm
// host the HOST already names the firm, so a path slug is either redundant
// (same firm → /book, one canonical booking URL per host) or a link to a
// DIFFERENT firm's funnel — send that to the other firm's own origin rather
// than rendering firm B's booking under firm A's domain (wrong host for its
// session cookies, and a brand mismatch). firmOriginFromSlug falls back to the
// canonical base for an invalid label, so a mangled path can't mint a bogus
// host. Legacy/canonical hosts skip all of this and render the client page
// exactly as before.
export default async function BookBySlugPage({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<React.JSX.Element> {
  const h = await headers()
  if (h.get('x-firm-host') === '1') {
    const hostSlug = (h.get('x-firm-slug') ?? '').trim().toLowerCase()
    const pathSlug = decodeURIComponent((await params).slug ?? '')
      .trim()
      .toLowerCase()
    if (pathSlug && pathSlug !== hostSlug) redirect(`${firmOriginFromSlug(pathSlug)}/book`)
    redirect('/book')
  }
  return <PublicBookingPage />
}
