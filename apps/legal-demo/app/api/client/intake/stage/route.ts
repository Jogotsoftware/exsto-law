// PORTAL-1 (WP1) — stage the intake as a LEAD before the account gate.
//
// The /book funnel calls this when the prospect reaches the "create your
// account" step, BEFORE they choose a password — so a balk leaves a
// recoverable, queryable lead (client_contact + questionnaire_response via the
// existing intake.submit vocabulary; no matter). Public, rate-limited,
// CAPTCHA-gated when configured, attributed to the public-intake actor (no
// account exists yet).
import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import { stageIntakeLead, resolveServiceFeeQuote } from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { verifyCaptchaIfConfigured } from '@/lib/captcha'

export const runtime = 'nodejs'

const TENANT_ID = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const ACTOR_ID = process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'

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

  const captcha = await verifyCaptchaIfConfigured(
    typeof body.captchaToken === 'string' ? body.captchaToken : undefined,
    clientIpFrom(request),
  )
  if (!captcha.ok) {
    return NextResponse.json({ error: captcha.reason ?? 'Captcha required.' }, { status: 403 })
  }

  const ctx: ActionContext = { tenantId: TENANT_ID, actorId: ACTOR_ID }
  try {
    const staged = await stageIntakeLead(ctx, {
      clientFullName: typeof body.clientFullName === 'string' ? body.clientFullName : '',
      clientEmail: typeof body.clientEmail === 'string' ? body.clientEmail : '',
      clientPhone: typeof body.clientPhone === 'string' ? body.clientPhone : null,
      clientCompanyName:
        typeof body.clientCompanyName === 'string' ? body.clientCompanyName : null,
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
    return NextResponse.json({ ok: true, staged: true, leadId: staged.questionnaireEntityId, quote })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
