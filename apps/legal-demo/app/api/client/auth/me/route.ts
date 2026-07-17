import { NextResponse } from 'next/server'
import { findClientContactMembershipsByEmail } from '@exsto/legal'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { resolvePublicTenant, FirmNotFoundError } from '@/lib/publicTenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The client session cookie is httpOnly, so the client cannot read its own
// identity for display. This endpoint verifies the cookie server-side and
// returns ONLY display-safe fields (never the token, never the matter ids
// themselves — just the count for the switcher hint). 401 when there is no valid
// session, so the UI treats "not signed in" and "expired" identically.
//
// MULTI-FIRM (referrals-tenancy P1): also returns the person's firm list for the
// header firm switcher — a live membership scan of the session's OWN email
// (their own memberships, nothing else), exposing only the two per-firm fields
// that are already public via resolve_public_firm (name + slug). firms[0] is the
// person's MAIN firm (the one they signed up with).
export async function GET(request: Request) {
  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  // A portal session is only valid FOR its own firm. The public funnel asks
  // this endpoint whether the session matches the firm the visitor is booking
  // (middleware -> x-firm-slug) and, on a mismatch, walks them through the
  // ANONYMOUS flow instead of mixing tenants — the cross-firm "Unknown
  // service" bug (founder walk 2026-07-17). Tenant-generic by construction:
  // it compares ids, never firm names.
  let matchesFirm = true
  try {
    const pub = await resolvePublicTenant(request)
    matchesFirm = pub.tenantId === session.tenantId
  } catch (e) {
    if (e instanceof FirmNotFoundError) matchesFirm = false
    // Any other failure: no firm context to compare — leave true (portal pages
    // outside the funnel don't carry a firm and must keep working).
  }
  // Fail-soft: this is a display endpoint. If the membership scan is unavailable
  // the session's own display fields still answer; the header just loses the
  // firm name + switcher until the next load (it never 500s a signed-in client).
  const memberships = await findClientContactMembershipsByEmail(session.email).catch(() => [])
  const current = memberships.find((m) => m.tenantId === session.tenantId)
  return NextResponse.json({
    email: session.email,
    displayName: session.displayName,
    matterCount: session.matterIds.length,
    matchesFirm,
    firmName: current?.firmName ?? null,
    firms: memberships.map((m, i) => ({
      tenantId: m.tenantId,
      firmName: m.firmName,
      slug: m.firmSlug,
      current: m.tenantId === session.tenantId,
      main: i === 0,
    })),
  })
}
