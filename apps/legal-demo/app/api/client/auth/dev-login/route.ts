import { NextResponse } from 'next/server'
import { mintClientSession } from '@/lib/clientSessionMint'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY client-portal login shim — the portal twin of the attorney
// `?demo_user=` shim. The client portal is gated by a signed httpOnly session
// (email + password via Supabase Auth); there is no dev password, so local
// verification of the portal UI had no way in. This route mints a REAL portal
// session for an explicitly-supplied (tenantId, contactId) so the portal can be
// walked locally against the dev DB.
//
// HARD gate: it 404s in production (NODE_ENV === 'production'), exactly like the
// attorney demo_user shim, so it can never mint a session on the live site. It
// takes the identity from the URL (never a cookie/body a visitor controls) and
// binds it through the SAME vetted `mintClientSession` the magic-link and
// Supabase-Auth flows use — it invents no new auth path and skips no check
// (contact-active, matter re-resolution, actor binding all still run).
//
// Usage (dev only): /api/client/auth/dev-login?tenantId=<uuid>&contactId=<uuid>
// then it 302s to /portal (or ?continue=<path>).
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  const url = new URL(request.url)
  const tenantId = url.searchParams.get('tenantId')
  const contactId = url.searchParams.get('contactId')
  const cont = url.searchParams.get('continue') ?? '/portal'
  if (!tenantId || !contactId) {
    return NextResponse.json(
      { error: 'dev-login requires ?tenantId=<uuid>&contactId=<uuid>' },
      { status: 400 },
    )
  }
  const result = await mintClientSession(tenantId, contactId)
  if (!result.ok || !result.cookie) {
    return NextResponse.json({ error: result.error ?? 'Could not mint session.' }, { status: 401 })
  }
  const dest = cont.startsWith('/') ? cont : '/portal'
  const res = NextResponse.redirect(new URL(dest, url.origin))
  res.headers.set('Set-Cookie', result.cookie)
  return res
}
