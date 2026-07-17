// PORTAL-1 (WP4) — book another service, signed in. Identity comes from the
// signed session (never the body); the booking runs attributed to the client's
// OWN actor with no account gate (they're in). Fee consent per WP3: a costed
// service books only after the client's actor accepted the exact quote —
// enforced here, server-side.
import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import {
  isClientContactActive,
  loadClientContactEmail,
  resolveServiceFeeQuote,
  grantServiceFeeConsent,
  findServiceFeeConsent,
  submitBooking,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { resolvePublicTenant, FirmNotFoundError } from '@/lib/publicTenant'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`portal-book:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { clientContactId, tenantId, clientActorId } = session
  if (!UUID_RE.test(clientContactId) || !UUID_RE.test(tenantId) || !UUID_RE.test(clientActorId)) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 })
  }
  if (!(await isClientContactActive(tenantId, clientContactId))) {
    return NextResponse.json({ error: 'Session no longer valid.' }, { status: 401 })
  }
  // The session must belong to the firm this funnel is on (middleware ->
  // x-firm-slug). Without this, a client signed into firm A booking on firm B's
  // link would run B's service key under A's tenant — the cross-firm "Unknown
  // service" failure (founder walk 2026-07-17). Structured 409: the funnel
  // catches FIRM_MISMATCH and re-enters the anonymous flow for this firm.
  try {
    const pub = await resolvePublicTenant(request)
    if (pub.tenantId !== tenantId) {
      return NextResponse.json(
        {
          error:
            'Your portal account belongs to a different firm — continuing as a new client of this firm.',
          code: 'FIRM_MISMATCH',
        },
        { status: 409 },
      )
    }
  } catch (e) {
    if (e instanceof FirmNotFoundError) {
      return NextResponse.json({ error: 'This firm could not be found.' }, { status: 404 })
    }
    throw e
  }

  const body = (await request.json().catch(() => null)) as {
    serviceKey?: unknown
    intakeResponses?: unknown
    scheduledAtIso?: unknown
    scheduledEndIso?: unknown
    stagedUploads?: unknown
    feeAccepted?: unknown
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const serviceKey = str(body.serviceKey).trim()
  if (!serviceKey) return NextResponse.json({ error: 'serviceKey is required.' }, { status: 400 })

  // Contact identity is resolved server-side from the session — the booking's
  // name/email are the on-file values, never body-supplied.
  const email = await loadClientContactEmail(tenantId, clientContactId)
  if (!email) {
    return NextResponse.json({ error: 'Your account has no email on file.' }, { status: 400 })
  }

  const clientCtx: ActionContext = { tenantId, actorId: clientActorId }
  const intakeResponses =
    body.intakeResponses && typeof body.intakeResponses === 'object'
      ? (body.intakeResponses as Record<string, unknown>)
      : {}

  try {
    const quote = await resolveServiceFeeQuote(clientCtx, serviceKey, clientContactId)
    if (quote) {
      const consent = await findServiceFeeConsent(clientCtx, clientContactId, quote)
      if (!consent) {
        if (body.feeAccepted !== true) {
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
        await grantServiceFeeConsent(clientCtx, { clientContactId, quote })
      }
    }

    const result = await submitBooking(clientCtx, {
      clientFullName: session.displayName,
      clientEmail: email,
      attributionSource: 'client_portal',
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
      matterNumber: effect.matterNumber ?? null,
      scheduledAt: effect.scheduledAt ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('SLOT_TAKEN') ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
