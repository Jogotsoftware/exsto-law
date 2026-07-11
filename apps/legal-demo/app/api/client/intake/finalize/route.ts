// PORTAL-1 (WP1) — the intake account gate: account creation is the FINAL step
// of intake submit, after the sunk cost of the questionnaire.
//
// One request does, in order:
//   1. ensure the staged contact exists (the stage endpoint normally already
//      created it; a direct call self-heals),
//   2. create the Supabase Auth account (anon signUp → GoTrue sends its own
//      confirmation email; the account is UNCONFIRMED so possession of the
//      typed email is never assumed — portal login stays behind
//      email_confirmed_at, the existing fail-closed gate),
//   3. provision the client's OWN actor (idempotent),
//   4. record fee consent when the service declares a cost (fee.quoted +
//      fee.accepted by the client's actor; a costed service with no acceptance
//      is REFUSED — law 2, enforced here, not in the UI),
//   5. run the normal intake.submit → matter.open → booking.create ATTRIBUTED
//      TO THE CLIENT'S ACTOR (contact deduped by email, so the staged lead is
//      reused, not duplicated).
//
// If the email already has an auth account, the password is NOT touched (no
// reset without an invite-token proof — anti-takeover); the booking still
// proceeds bound to that contact and the client signs in with their existing
// password.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import '@exsto/legal/mcp'
import {
  stageIntakeLead,
  findClientContactIdByEmail,
  provisionClientPortalActor,
  resolveServiceFeeQuote,
  grantServiceFeeConsent,
  findServiceFeeConsent,
  submitBooking,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { verifyCaptchaIfConfigured } from '@/lib/captcha'

export const runtime = 'nodejs'
// Booking a service whose workflow opens on a producing stage can draft
// synchronously in this request (same budget as the public mcp route).
export const maxDuration = 300

const TENANT_ID = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
const ACTOR_ID = process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'
const MIN_PASSWORD_LENGTH = 8
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

interface FinalizeBody {
  clientFullName?: unknown
  clientEmail?: unknown
  clientPhone?: unknown
  clientCompanyName?: unknown
  attributionSource?: unknown
  serviceKey?: unknown
  intakeResponses?: unknown
  scheduledAtIso?: unknown
  scheduledEndIso?: unknown
  stagedUploads?: unknown
  password?: unknown
  feeAccepted?: unknown
  captchaToken?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// Anon-key signUp, server-side: GoTrue sends the confirmation email and hands
// existing emails back as an obfuscated user with no identities.
async function createUnconfirmedAccount(
  email: string,
  password: string,
): Promise<'created' | 'exists'> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('Account creation is not configured.')
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${BASE_URL}/portal/login` },
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes('already registered') || m.includes('already exists')) return 'exists'
    // GoTrue rate-limits confirmation resends per email; a quick retry after a
    // failed attempt means the account from that attempt already exists.
    if (m.includes('you can only request this after')) return 'exists'
    throw new Error(error.message)
  }
  // Existing-email signUp "succeeds" with an identity-less stub user.
  if (data.user && (data.user.identities ?? []).length === 0) return 'exists'
  return 'created'
}

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`intake-finalize:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = (await request.json().catch(() => null)) as FinalizeBody | null
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const captcha = await verifyCaptchaIfConfigured(
    typeof body.captchaToken === 'string' ? body.captchaToken : undefined,
    clientIpFrom(request),
  )
  if (!captcha.ok) {
    return NextResponse.json({ error: captcha.reason ?? 'Captcha required.' }, { status: 403 })
  }

  const email = str(body.clientEmail).trim()
  const fullName = str(body.clientFullName).trim()
  const serviceKey = str(body.serviceKey).trim()
  const password = str(body.password)
  if (!email || !fullName || !serviceKey) {
    return NextResponse.json({ error: 'Name, email and service are required.' }, { status: 400 })
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    )
  }

  const publicCtx: ActionContext = { tenantId: TENANT_ID, actorId: ACTOR_ID }
  const intakeResponses =
    body.intakeResponses && typeof body.intakeResponses === 'object'
      ? (body.intakeResponses as Record<string, unknown>)
      : {}

  try {
    // 1. The staged contact (self-heal if the stage call never landed).
    let clientContactId = await findClientContactIdByEmail(publicCtx, email)
    if (!clientContactId) {
      const staged = await stageIntakeLead(publicCtx, {
        clientFullName: fullName,
        clientEmail: email,
        clientPhone: str(body.clientPhone) || null,
        clientCompanyName: str(body.clientCompanyName) || null,
        serviceKey,
        intakeResponses,
      })
      clientContactId = staged.clientEntityId
    }

    // 2. Fee gate FIRST — a missing acceptance must refuse BEFORE any side
    // effect (no auth account, no actor) so the 409 is a clean re-entry.
    const quote = await resolveServiceFeeQuote(publicCtx, serviceKey, clientContactId)
    const priorConsent = quote
      ? await findServiceFeeConsent(publicCtx, clientContactId, quote)
      : null
    if (quote && !priorConsent && body.feeAccepted !== true) {
      return NextResponse.json(
        {
          error: 'This service has a fee that needs your acceptance first.',
          code: 'FEE_CONSENT_REQUIRED',
          quote: {
            basis: quote.basis,
            amount: quote.amount,
            rate: quote.rate,
            currency: quote.currency,
            description: quote.description,
          },
        },
        { status: 409 },
      )
    }

    // 3. The auth account. 'exists' is NOT an error: the booking proceeds and
    // the client signs in with the password they already have.
    const account = await createUnconfirmedAccount(email, password)

    // 4. The client's own actor (idempotent; also self-heals the RBAC scope
    // assignment for actors provisioned before 0136).
    const provisioned = await provisionClientPortalActor(publicCtx, {
      clientContactId,
      trigger: 'intake_gate',
    })
    const clientActorId = provisioned.actorId
    const clientCtx: ActionContext = { tenantId: TENANT_ID, actorId: clientActorId }

    // 5. Record the acceptance as the client's OWN actor (the consent receipt).
    if (quote && !priorConsent) {
      await grantServiceFeeConsent(clientCtx, { clientContactId, quote })
    }

    // 6. The booking, attributed to the client's own actor.
    const result = await submitBooking(clientCtx, {
      clientFullName: fullName,
      clientEmail: email,
      clientPhone: str(body.clientPhone) || undefined,
      clientCompanyName: str(body.clientCompanyName) || undefined,
      attributionSource: str(body.attributionSource) || 'client_portal_intake_gate',
      serviceKey,
      intakeResponses,
      scheduledAtIso: str(body.scheduledAtIso) || undefined,
      scheduledEndIso: str(body.scheduledEndIso) || undefined,
      stagedUploads: Array.isArray(body.stagedUploads)
        ? body.stagedUploads.filter((t): t is string => typeof t === 'string')
        : undefined,
    })
    const effect = (result.effects[0] ?? {}) as {
      matterEntityId?: string
      matterNumber?: string
      scheduledAt?: string
    }

    return NextResponse.json({
      ok: true,
      accountCreated: account === 'created',
      accountExisted: account === 'exists',
      emailConfirmationRequired: account === 'created',
      matterNumber: effect.matterNumber ?? null,
      scheduledAt: effect.scheduledAt ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('SLOT_TAKEN') ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
