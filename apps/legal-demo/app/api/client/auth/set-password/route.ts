// Set-password (invite) bridge: a signed portal-invite token  →  a Supabase Auth
// password  →  our httpOnly client-portal session.
//
// The attorney's `legal.contact.invite_to_portal` tool emailed the client a
// /portal/set-password?token=… link (delivered only to their on-file address, so
// possession proves email control). Here we:
//   • verify the invite token's MAC + expiry (domain-separated — a magic-link or
//     session token fails),
//   • resolve the contact's CURRENT on-file email server-side (never from the body),
//   • create-or-reset a confirmed Supabase Auth password for that email,
//   • mint the SAME exsto_client_session the magic-link/Supabase flows do.
// The client is signed straight in, and email+password works on every later visit.
import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import {
  verifyPortalInviteToken,
  loadClientContactEmail,
  isClientContactActive,
  provisionClientPortalActor,
  resolveClientMatterIds,
} from '@exsto/legal'
import { safeInternalPath } from '@/lib/safeRedirect'
import { mintClientSessionResponse } from '@/lib/clientSessionMint'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { upsertConfirmedPasswordAccount, supabaseAdminConfigured } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

const MIN_PASSWORD_LENGTH = 8

// Submitting actor for the account-provisioning action (the resulting session
// then acts as the client's own actor).
const PUBLIC_INTAKE_ACTOR_ID =
  process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`client-auth-set-password:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  if (!supabaseAdminConfigured()) {
    return NextResponse.json(
      { error: 'Portal account setup is temporarily unavailable. Please contact the firm.' },
      { status: 503 },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    token?: unknown
    password?: unknown
    continue?: unknown
  } | null
  const token = typeof body?.token === 'string' ? body.token : null
  const password = typeof body?.password === 'string' ? body.password : ''
  const dest = safeInternalPath(
    typeof body?.continue === 'string' ? body.continue : null,
    '/portal',
  )

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    )
  }

  // Verify the invite token (throws on a bad/expired/tampered link).
  let invite: { clientContactId: string; tenantId: string }
  try {
    invite = verifyPortalInviteToken(token)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'This invite link is invalid.' },
      { status: 401 },
    )
  }

  // Re-check the contact is STILL an active client_contact before writing any
  // credential — so a revoked/deactivated invite link is fully inert (it can't even
  // set/reset a Supabase Auth password), not merely barred from minting a session.
  const active = await isClientContactActive(invite.tenantId, invite.clientContactId)
  if (!active) {
    return NextResponse.json(
      { error: 'This invite is no longer valid. Please contact the firm.' },
      { status: 401 },
    )
  }

  // The email is the contact's CURRENT on-file address, resolved server-side from
  // the proven identity — never taken from the request body.
  const email = await loadClientContactEmail(invite.tenantId, invite.clientContactId)
  if (!email) {
    return NextResponse.json(
      { error: 'We could not find your account. Please contact the firm.' },
      { status: 404 },
    )
  }

  try {
    await upsertConfirmedPasswordAccount(email, password)
  } catch {
    return NextResponse.json(
      { error: 'We could not set your password. Please try again or contact the firm.' },
      { status: 502 },
    )
  }

  // PORTAL-1: account creation provisions the client's OWN actor (idempotent) and
  // advances any matter parked on a send_portal_invite client gate. Done here —
  // not left to the mint's lazy backfill — so the receipt reads trigger:'invite'.
  {
    // Idempotent (and self-heals the RBAC scope for pre-0136 actors); advances
    // any matter parked on a send_portal_invite client gate.
    const matterIds = await resolveClientMatterIds(invite.tenantId, invite.clientContactId)
    await provisionClientPortalActor(
      { tenantId: invite.tenantId, actorId: PUBLIC_INTAKE_ACTOR_ID },
      { clientContactId: invite.clientContactId, matterEntityIds: matterIds, trigger: 'invite' },
    )
  }

  // Bind the proven identity into a portal session (re-checks active + re-resolves
  // matterIds in the shared mint path) and sign them in.
  return mintClientSessionResponse(invite.tenantId, invite.clientContactId, {
    redirect: `${BASE_URL}${dest}`,
    path: dest,
  })
}
