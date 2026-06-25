// Stripe Express onboarding return_url. Stripe redirects the attorney's browser
// here when they finish (or leave) onboarding — no code to exchange, so we just
// re-read the account's live capability flags from Stripe, persist them, and land
// the attorney back on Settings with the result reflected.
import { NextResponse } from 'next/server'
import { refreshFirmPaymentStatus } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const origin = new URL(request.url).origin
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) {
    // Lost session on the round-trip — send them to sign in, then back to Settings.
    return NextResponse.redirect(`${origin}/attorney/settings?payments=signin`)
  }
  try {
    const status = await refreshFirmPaymentStatus(ctx)
    const flag = status.chargesEnabled ? 'connected' : 'incomplete'
    return NextResponse.redirect(`${origin}/attorney/settings?payments=${flag}`)
  } catch {
    return NextResponse.redirect(`${origin}/attorney/settings?payments=error`)
  }
}
