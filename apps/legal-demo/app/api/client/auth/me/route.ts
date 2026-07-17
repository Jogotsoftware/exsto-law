import { NextResponse } from 'next/server'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { resolvePublicTenant, FirmNotFoundError } from '@/lib/publicTenant'

export const runtime = 'nodejs'

// The client session cookie is httpOnly, so the client cannot read its own
// identity for display. This endpoint verifies the cookie server-side and
// returns ONLY display-safe fields (never the token, never the matter ids
// themselves — just the count for the switcher hint). 401 when there is no valid
// session, so the UI treats "not signed in" and "expired" identically.
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
  return NextResponse.json({
    email: session.email,
    displayName: session.displayName,
    matterCount: session.matterIds.length,
    matchesFirm,
  })
}
