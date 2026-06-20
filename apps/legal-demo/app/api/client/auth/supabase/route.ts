// Bridge: Supabase Auth session  →  our httpOnly client-portal session.
//
// The browser signs in with email+password or Google via Supabase Auth, then
// POSTs the resulting access token here. We VERIFY that token against Supabase
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
import { findClientContactByEmail } from '@exsto/legal'
import { safeInternalPath } from '@/lib/safeRedirect'
import { mintClientSessionResponse } from '@/lib/clientSessionMint'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

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
  } | null
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : ''
  const dest = safeInternalPath(typeof body?.continue === 'string' ? body.continue : null, '/portal')
  if (!accessToken) {
    return NextResponse.json({ error: 'Missing sign-in token.' }, { status: 400 })
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

  // Map the verified email to a client of the firm. They authenticated as this
  // email, so a clear "not a client" message is safe (it's their own address).
  const contact = await findClientContactByEmail(user.email)
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
