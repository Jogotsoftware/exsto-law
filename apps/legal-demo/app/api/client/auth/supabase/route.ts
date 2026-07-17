// Bridge: Supabase Auth session  →  our httpOnly client-portal session.
//
// The browser signs in with email + password via Supabase Auth, then POSTs the
// resulting access token here. We VERIFY that token against Supabase
// (auth.getUser is authoritative — it validates the JWT server-side), take the
// VERIFIED email, resolve the firm's client_contact for it, and mint the same
// exsto_client_session the magic-link flow does. Supabase only proves "this
// person controls this email"; the substrate-side authorization is unchanged.
//
// The email is never taken from the request body — only from the token Supabase
// verified — so a caller can't bridge into someone else's portal.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import '@exsto/legal/mcp'
import { findClientContactMembershipsByEmail } from '@exsto/legal'
import { safeInternalPath } from '@/lib/safeRedirect'
import { mintClientSessionResponse } from '@/lib/clientSessionMint'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { emailConfirmationGate } from '@/lib/supabaseConfirmGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`client-auth-supabase:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return NextResponse.json({ error: 'Password sign-in is not configured.' }, { status: 503 })
  }

  const body = (await request.json().catch(() => null)) as {
    accessToken?: unknown
    continue?: unknown
    tenantId?: unknown
  } | null
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : ''
  const requestedTenantId = typeof body?.tenantId === 'string' ? body.tenantId : null
  const dest = safeInternalPath(
    typeof body?.continue === 'string' ? body.continue : null,
    '/portal',
  )
  if (!accessToken) {
    return NextResponse.json({ error: 'Missing sign-in token.' }, { status: 400 })
  }

  // Defense-in-depth: the email_confirmed_at gate below is only meaningful when
  // the project requires email confirmation. If "Confirm email" is OFF Supabase
  // auto-confirms every sign-up, so anyone could sign up AS a client's email and
  // bridge in. Verify auto-confirm is OFF against GoTrue itself; fail closed
  // (loud outage, never a silent takeover) if it is on or unverifiable. See
  // lib/supabaseConfirmGuard.ts.
  const gate = await emailConfirmationGate({ settingsUrl: SUPABASE_URL, anonKey: SUPABASE_ANON })
  if (gate !== 'ok') {
    return NextResponse.json(
      { error: 'Portal sign-in is temporarily unavailable. Please contact the firm.' },
      { status: 503 },
    )
  }

  // Authoritative verification: ask Supabase who this token belongs to.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(accessToken)
  const user = data?.user
  if (error || !user?.email) {
    return NextResponse.json({ error: 'Your sign-in could not be verified.' }, { status: 401 })
  }
  // Only a CONFIRMED email may bind to a portal session (an unconfirmed password
  // sign-up must verify first; Google emails are confirmed by the provider).
  if (!user.email_confirmed_at) {
    return NextResponse.json(
      { error: 'Please confirm your email first — check your inbox for the verification link.' },
      { status: 403 },
    )
  }

  // Map the verified email to the person's firm memberships. They authenticated
  // as this email, so a clear "not a client" message is safe (their own address).
  // MULTI-FIRM (referrals-tenancy P1): a person can be an active client at
  // several firms. Default = their MAIN firm (oldest contact — the firm they
  // signed up with, memberships[0]); an explicit body tenantId is honored ONLY
  // when it is one of their own memberships (the in-portal firm switcher and the
  // invite sign-in leg use this). A tenantId outside their memberships gets the
  // same 403 as an unknown email — no membership oracle. The funnel middleware's
  // x-firm-slug header is deliberately ignored here: a stale ?firm= cookie must
  // never steer an authenticated session.
  const memberships = await findClientContactMembershipsByEmail(user.email)
  if (memberships.length === 0) {
    return NextResponse.json(
      {
        error:
          'We couldn’t find a client account for this email. Use the email where you received your booking confirmation, or contact the firm.',
      },
      { status: 403 },
    )
  }
  const contact = requestedTenantId
    ? memberships.find((m) => m.tenantId === requestedTenantId)
    : memberships[0]
  if (!contact) {
    return NextResponse.json(
      {
        error:
          'We couldn’t find a client account for this email. Use the email where you received your booking confirmation, or contact the firm.',
      },
      { status: 403 },
    )
  }

  return mintClientSessionResponse(contact.tenantId, contact.clientContactId, {
    redirect: `${BASE_URL}${dest}`,
    path: dest,
  })
}
