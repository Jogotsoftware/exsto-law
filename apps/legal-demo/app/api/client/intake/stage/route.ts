// PORTAL-1 (WP1) — stage the intake as a LEAD before the account gate.
//
// The /book funnel calls this when the prospect reaches the "create your
// account" step, BEFORE they choose a password — so a balk leaves a
// recoverable, queryable lead (client_contact + questionnaire_response via the
// existing intake.submit vocabulary; no matter). Public, rate-limited,
// attributed to the public-intake actor (no account exists yet). The WRITE
// (lead staging) is CAPTCHA-gated when configured; without a valid token the
// route degrades to a read-only probe (fee quote + known-account detection)
// because its only caller fires before any captcha widget has rendered.
import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import {
  stageIntakeLead,
  resolveServiceFeeQuote,
  resolvePortalActorId,
  findClientContactIdByEmail,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { verifyCaptchaIfConfigured } from '@/lib/captcha'
import { resolvePublicTenant, FirmNotFoundError } from '@/lib/publicTenant'

export const runtime = 'nodejs'

// MULTI-TENANT-1: tenant + intake actor resolved per request (see lib/publicTenant.ts).
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`intake-stage:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    clientFullName?: unknown
    clientEmail?: unknown
    clientPhone?: unknown
    clientCompanyName?: unknown
    serviceKey?: unknown
    intakeResponses?: unknown
    captchaToken?: unknown
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  let tenantId: string
  let ctx: ActionContext
  try {
    const pub = await resolvePublicTenant(request)
    tenantId = pub.tenantId
    ctx = { tenantId: pub.tenantId, actorId: pub.actorId }
  } catch (e) {
    if (e instanceof FirmNotFoundError) {
      return NextResponse.json({ error: 'This firm could not be found.' }, { status: 404 })
    }
    throw e
  }

  const captcha = await verifyCaptchaIfConfigured(
    typeof body.captchaToken === 'string' ? body.captchaToken : undefined,
    clientIpFrom(request),
  )
  if (!captcha.ok) {
    // Probe-degrade: the funnel calls this on entry to the account step, where no
    // captcha token can exist yet (the widget mounts on that step). Without a
    // token nothing is WRITTEN — no staged lead — but the reads the step needs
    // (fee quote + known-account detection, rate-limited above) still ride back,
    // so the returning-client default works in captcha-guarded deployments too.
    let quote = null
    let hasPortalAccount = false
    try {
      const contactId = await findClientContactIdByEmail(ctx, str(body.clientEmail))
      hasPortalAccount =
        contactId != null && (await resolvePortalActorId(tenantId, contactId)) != null
      const q = await resolveServiceFeeQuote(ctx, str(body.serviceKey), contactId)
      if (q) {
        quote = {
          basis: q.basis,
          amount: q.amount,
          rate: q.rate,
          currency: q.currency,
          description: q.description,
        }
      }
    } catch {
      quote = null
    }
    return NextResponse.json({ ok: true, staged: false, quote, hasPortalAccount })
  }
  try {
    const staged = await stageIntakeLead(ctx, {
      clientFullName: typeof body.clientFullName === 'string' ? body.clientFullName : '',
      clientEmail: typeof body.clientEmail === 'string' ? body.clientEmail : '',
      clientPhone: typeof body.clientPhone === 'string' ? body.clientPhone : null,
      clientCompanyName: typeof body.clientCompanyName === 'string' ? body.clientCompanyName : null,
      serviceKey: typeof body.serviceKey === 'string' ? body.serviceKey : '',
      intakeResponses:
        body.intakeResponses && typeof body.intakeResponses === 'object'
          ? (body.intakeResponses as Record<string, unknown>)
          : {},
    })
    // The fee quote for the selected service (null = no cost declared) rides
    // back so the account step can render the consent card up front.
    let quote = null
    try {
      const q = await resolveServiceFeeQuote(ctx, str(body.serviceKey), staged.clientEntityId)
      if (q) {
        quote = {
          basis: q.basis,
          amount: q.amount,
          rate: q.rate,
          currency: q.currency,
          description: q.description,
        }
      }
    } catch {
      quote = null
    }
    // Known-email detection: an active portal actor on the staged contact means
    // this prospect already has an account, so the account step can lead with
    // sign-in instead of a doomed create. Disclosure is bounded — finalize
    // already returns accountExisted post-submit — and the copy stays neutral.
    let hasPortalAccount = false
    try {
      hasPortalAccount = (await resolvePortalActorId(tenantId, staged.clientEntityId)) != null
    } catch {
      hasPortalAccount = false
    }
    return NextResponse.json({
      ok: true,
      staged: true,
      leadId: staged.questionnaireEntityId,
      quote,
      hasPortalAccount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
