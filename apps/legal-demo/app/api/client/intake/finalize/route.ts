// PORTAL-1 (WP1) — the intake account gate: account creation is the FINAL step
// of intake submit, after the sunk cost of the questionnaire.
//
// One request does, in order:
//   1. ensure the staged contact exists (the stage endpoint normally already
//      created it; a direct call self-heals),
//   2. create the Supabase Auth account (N1: admin.generateLink mints an
//      UNCONFIRMED account + token WITHOUT Supabase sending its own email —
//      we send our own firm-branded one via issuePortalConfirmationEmail.
//      Portal login stays behind email_confirmed_at, the existing fail-closed
//      gate),
//   3. provision the client's OWN actor (idempotent),
//   4. record fee consent when the service declares a cost (fee.quoted +
//      fee.accepted by the client's actor; a costed service with no acceptance
//      is REFUSED — law 2, enforced here, not in the UI),
//   5. run the normal intake.submit → matter.open → booking.create ATTRIBUTED
//      TO THE CLIENT'S ACTOR (contact deduped by email, so the staged lead is
//      reused, not duplicated).
//
// If the email already has a CONFIRMED auth account, the password is NOT
// touched (no reset without an invite-token proof — anti-takeover); the
// booking still proceeds bound to that contact and the client signs in with
// their existing password. An existing but UNCONFIRMED account gets a fresh
// token + a re-sent email (mintSignupConfirmation regenerates it) — that's
// the same path a stalled first attempt takes on retry.
import { NextResponse } from 'next/server'
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
import { resolvePublicTenant, FirmNotFoundError } from '@/lib/publicTenant'
import { validatePassword } from '@/lib/passwordPolicy'
import { issuePortalConfirmationEmail } from '@/lib/portalConfirmationEmail'
import type { ConfirmationEmailLang } from '@/lib/confirmationEmailTemplate'

export const runtime = 'nodejs'
// Booking a service whose workflow opens on a producing stage can draft
// synchronously in this request (same budget as the public mcp route).
export const maxDuration = 300

// MULTI-TENANT-1: tenant + public-intake actor resolved per request (lib/publicTenant.ts).
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exsto-law.netlify.app'
).replace(/\/$/, '')

interface FinalizeBody {
  clientFullName?: unknown
  clientEmail?: unknown
  clientPhone?: unknown
  clientCompanyName?: unknown
  clientMailingAddress?: unknown
  clientBusinessAddress?: unknown
  clientPreferredContactMethod?: unknown
  attributionSource?: unknown
  serviceKey?: unknown
  intakeResponses?: unknown
  scheduledAtIso?: unknown
  scheduledEndIso?: unknown
  stagedUploads?: unknown
  password?: unknown
  feeAccepted?: unknown
  captchaToken?: unknown
  lang?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
// A structured-address object rides through as-is; anything non-object is dropped
// to null so the handler's isStructuredAddress guard treats it as "not provided".
const addr = (v: unknown): unknown => (v && typeof v === 'object' ? v : null)

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
  const pwErr = validatePassword(password)
  if (pwErr) {
    return NextResponse.json({ error: pwErr }, { status: 400 })
  }

  let tenantId: string
  let publicCtx: ActionContext
  try {
    const pub = await resolvePublicTenant(request)
    tenantId = pub.tenantId
    publicCtx = { tenantId: pub.tenantId, actorId: pub.actorId }
  } catch (e) {
    if (e instanceof FirmNotFoundError) {
      return NextResponse.json({ error: 'This firm could not be found.' }, { status: 404 })
    }
    throw e
  }
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
        clientMailingAddress: addr(body.clientMailingAddress),
        clientBusinessAddress: addr(body.clientBusinessAddress),
        clientPreferredContactMethod: str(body.clientPreferredContactMethod) || null,
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

    // 3. The auth account. 'exists' (already CONFIRMED) is NOT an error: the
    // booking proceeds and the client signs in with the password they already
    // have. 'created' covers both a brand-new account and an existing-but-
    // UNCONFIRMED one (mintSignupConfirmation regenerates its token) — either
    // way a fresh confirmation email goes out.
    const lang: ConfirmationEmailLang = str(body.lang) === 'es' ? 'es' : 'en'
    const account = await issuePortalConfirmationEmail(publicCtx, {
      email,
      password,
      baseUrl: BASE_URL,
      lang,
    })

    // 4. The client's own actor (idempotent; also self-heals the RBAC scope
    // assignment for actors provisioned before 0136).
    const provisioned = await provisionClientPortalActor(publicCtx, {
      clientContactId,
      trigger: 'intake_gate',
    })
    const clientActorId = provisioned.actorId
    const clientCtx: ActionContext = { tenantId, actorId: clientActorId }

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
      clientMailingAddress: addr(body.clientMailingAddress),
      clientBusinessAddress: addr(body.clientBusinessAddress),
      clientPreferredContactMethod: str(body.clientPreferredContactMethod) || null,
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
      accountCreated: account.status === 'created',
      accountExisted: account.status === 'exists',
      emailConfirmationRequired: account.status === 'created',
      confirmationEmailSent: account.status === 'created' ? account.emailSent : null,
      matterNumber: effect.matterNumber ?? null,
      scheduledAt: effect.scheduledAt ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('SLOT_TAKEN') ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
