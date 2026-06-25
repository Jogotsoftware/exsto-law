// Start (or resume) the firm's Stripe Connect Express onboarding. Attorney-authed
// (the connected account is the firm's), mirroring /api/auth/google/init: resolve
// the signed-in attorney's ctx from the cookie, ask the vertical to create/reuse
// the connected account + mint a one-time onboarding link, then 302 to Stripe.
import { NextResponse } from 'next/server'
import { startFirmOnboarding } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  }
  const origin = new URL(request.url).origin
  try {
    const { url } = await startFirmOnboarding(ctx, origin)
    return NextResponse.redirect(url)
  } catch {
    // Don't leak internals (or strand the attorney on a raw 500) — bounce back to
    // Settings, which shows a clean "couldn't start setup" banner on ?payments=error.
    return NextResponse.redirect(`${origin}/attorney/settings?payments=error`)
  }
}
