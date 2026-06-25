// Stripe Express onboarding refresh_url. Stripe redirects here if the onboarding
// link expired or was reopened; we mint a fresh link (reusing the firm's existing
// connected account) and bounce the attorney straight back into onboarding.
import { NextResponse } from 'next/server'
import { startFirmOnboarding } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const origin = new URL(request.url).origin
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) {
    return NextResponse.redirect(`${origin}/attorney/settings?payments=signin`)
  }
  try {
    const { url } = await startFirmOnboarding(ctx, origin)
    return NextResponse.redirect(url)
  } catch {
    return NextResponse.redirect(`${origin}/attorney/settings?payments=error`)
  }
}
