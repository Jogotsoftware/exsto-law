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
import {
  appBaseUrl,
  findClientContactMembershipsByEmail,
  firmOriginFromSlug,
  getPublicSlugForTenant,
  resolvePortalActorId,
  confirmPortalEmail,
} from '@exsto/legal'
import { safeInternalPath } from '@/lib/safeRedirect'
import { mintHandoffToken, handoffRedirectUrl } from '@/lib/authHandoff'
import { firmHostFromRequest } from '@/lib/hostTenantGuard'
import { mintClientSessionResponse } from '@/lib/clientSessionMint'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { requestOrigin } from '@/lib/requestOrigin'
import { emailConfirmationGate } from '@/lib/supabaseConfirmGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    confirmed?: unknown
  } | null
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : ''
  const requestedTenantId = typeof body?.tenantId === 'string' ? body.tenantId : null
  const justConfirmed = body?.confirmed === true
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
  // AUTH-HANDOFF-1 amendment to the stance above: a *firm HOST* (not the cookie)
  // may narrow the default membership to the firm the user is literally signing
  // in on — x-firm-host is middleware-set and unforgeable, unlike the stale
  // ?firm= cookie that comment guards against. An explicit tenantId still wins;
  // a member of firms A+B signing in on A's subdomain lands in A, not "oldest".
  let hostPreferred: (typeof memberships)[number] | undefined
  const firmHost = firmHostFromRequest(request)
  if (!requestedTenantId && firmHost) {
    for (const m of memberships) {
      if ((await getPublicSlugForTenant(m.tenantId)) === firmHost.slug) {
        hostPreferred = m
        break
      }
    }
  }
  const contact = requestedTenantId
    ? memberships.find((m) => m.tenantId === requestedTenantId)
    : (hostPreferred ?? memberships[0])
  if (!contact) {
    return NextResponse.json(
      {
        error:
          'We couldn’t find a client account for this email. Use the email where you received your booking confirmation, or contact the firm.',
      },
      { status: 403 },
    )
  }

  // N1 — record the confirmation as a provenanced action on the client's OWN
  // actor. Only fires for the two confirmation-return callers (verifyOtp /
  // exchangeCodeForSession on /portal/login just proved control of this
  // email), never a plain password sign-in. Best-effort: the handler is
  // idempotent (packages/handlers/clientPortalActor.ts reuses an existing
  // event), and a failure here must never block the sign-in it's riding on.
  if (justConfirmed) {
    const actorId = await resolvePortalActorId(contact.tenantId, contact.clientContactId)
    if (actorId) {
      await confirmPortalEmail(
        { tenantId: contact.tenantId, actorId },
        { clientContactId: contact.clientContactId },
      ).catch((e: unknown) => console.error('[client-auth-supabase] confirmPortalEmail failed', e))
    }
  }

  // AUTH-HANDOFF-1: when the selected membership's firm lives on its own
  // subdomain and this request is NOT already on it (neutral /signin, legacy
  // host, or the in-portal switcher hopping firms), mint NO cookie here —
  // respond with the firm host's single-use handoff URL and let the browser
  // complete sign-in there. The host never SELECTS the membership (the
  // deliberate stance above stands); it only decides whether a hop is needed.
  // Dormant-safe: without TENANT_BASE_DOMAIN the origins always match.
  const firmSlug = await getPublicSlugForTenant(contact.tenantId)
  if (firmSlug) {
    const firmOrigin = firmOriginFromSlug(firmSlug)
    if (firmOrigin !== requestOrigin(request) && firmOrigin !== appBaseUrl()) {
      const handoff = mintHandoffToken(
        { kind: 'client', tenantId: contact.tenantId, clientContactId: contact.clientContactId },
        firmSlug,
        dest,
      )
      return NextResponse.json({
        ok: true,
        redirect: handoffRedirectUrl(firmSlug, handoff),
        path: dest,
      })
    }
  }

  // ORIGIN-1 rule 2: redirect on the host the user is on — the session cookie
  // being set right here is host-only, so a cross-host redirect would strand it.
  return mintClientSessionResponse(
    contact.tenantId,
    contact.clientContactId,
    { redirect: `${requestOrigin(request)}${dest}`, path: dest },
    request,
  )
}
