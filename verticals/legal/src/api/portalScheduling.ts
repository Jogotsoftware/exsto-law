import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { getFirmBookingRules } from './firmBookingRules.js'
import { getGoogleAvailability } from '../adapters/googleCalendar.js'
import { getGoogleStatus } from './google.js'
import { resolveFirmPrimaryActor } from '../adapters/connectionStore.js'
import { tryCreateStandaloneEvent } from './publicBooking.js'
import { getFirmDefaultRate, getClientRate } from './rates.js'
import { getLatestAttributeValue } from '../handlers/common.js'
import { loadClientContactEmail } from './clientIdentity.js'
import { queueNotification } from './notifications.js'
import {
  presentFeeQuote,
  decideFeeQuote,
  findFeeConsent,
} from './feeConsent.js'

// PORTAL-1 (WP4) — schedule time from inside the portal: consultations and
// appointments on the firm's REAL availability (rules ∩ live Google free/busy —
// never a stub), a calendar event with the client as guest, and — when the
// attorney turned the per-client billable-scheduling toggle ON — a rate ×
// duration fee consent BEFORE the booking confirms (law 2, enforced here).

export interface PortalSlot {
  startIso: string
  endIso: string
  label: string
}

export interface PortalSchedulingAvailability {
  configured: boolean
  timezone: string
  meetingLengthsMinutes: number[]
  durationMinutes: number
  slots: PortalSlot[]
}

function pickDuration(lengths: number[], fallback: number, requested?: number): number {
  if (requested && lengths.includes(requested)) return requested
  return lengths[0] ?? fallback
}

export async function getPortalSchedulingAvailability(
  ctx: ActionContext,
  opts: { durationMinutes?: number; daysOut?: number } = {},
): Promise<PortalSchedulingAvailability> {
  const rules = await getFirmBookingRules(ctx)
  const durationMinutes = pickDuration(
    rules.meetingLengthsMinutes,
    rules.defaultDurationMinutes,
    opts.durationMinutes,
  )
  const base = {
    timezone: rules.timezone,
    meetingLengthsMinutes: rules.meetingLengthsMinutes,
    durationMinutes,
  }
  const firmActor = await resolveFirmPrimaryActor(ctx.tenantId, 'google')
  const status = await getGoogleStatus(ctx, firmActor)
  if (!firmActor || !status.connected) return { ...base, configured: false, slots: [] }
  try {
    const slots = await getGoogleAvailability(
      ctx.tenantId,
      Math.min(60, Math.max(1, opts.daysOut ?? 21)),
      firmActor,
      rules,
      durationMinutes,
    )
    return {
      ...base,
      configured: true,
      slots: slots
        .filter((s) => s.available)
        .map(({ startIso, endIso, label }) => ({ startIso, endIso, label })),
    }
  } catch {
    // Connected-but-erroring reads show honestly empty — never fabricated slots.
    return { ...base, configured: false, slots: [] }
  }
}

export interface SchedulingFeeQuote {
  basis: 'consultation'
  rate: string
  durationMinutes: number
  /** rate × duration, decimal string. */
  amount: string
  currency: 'USD'
  description: string
}

// The client-parent for the contact (contact_of), for the toggle + Contract K.
async function resolveClientParent(
  ctx: ActionContext,
  clientContactId: string,
): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT r.target_entity_id AS id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.source_entity_id = $2
         AND rkd.kind_name = 'contact_of'
         AND (r.valid_to IS NULL OR r.valid_to > now())
       ORDER BY r.recorded_at DESC LIMIT 1`,
      [ctx.tenantId, clientContactId],
    )
    return res.rows[0]?.id ?? null
  })
}

const round2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2)

// Null when scheduling is non-billable for this client (toggle OFF or no
// governing rate configured) — no consent friction on non-billable acts.
export async function getSchedulingFeeQuote(
  ctx: ActionContext,
  clientContactId: string,
  durationMinutes: number,
): Promise<SchedulingFeeQuote | null> {
  const parentId = await resolveClientParent(ctx, clientContactId)
  if (!parentId) return null
  const billable = await withActionContext(ctx, (client) =>
    getLatestAttributeValue<boolean>(client, ctx.tenantId, parentId, 'portal_scheduling_billable'),
  )
  if (billable !== true) return null
  const rate = (await getClientRate(ctx, parentId)) ?? (await getFirmDefaultRate(ctx))
  if (!rate || !Number.isFinite(Number(rate)) || Number(rate) <= 0) return null
  const amount = round2((Number(rate) * durationMinutes) / 60)
  return {
    basis: 'consultation',
    rate,
    durationMinutes,
    amount,
    currency: 'USD',
    description: `${durationMinutes} min consultation @ $${rate}/hr`,
  }
}

export class SchedulingFeeConsentRequiredError extends Error {
  quote: SchedulingFeeQuote
  constructor(quote: SchedulingFeeQuote) {
    super('This time is billable and needs your acceptance of the fee first.')
    this.name = 'SchedulingFeeConsentRequiredError'
    this.quote = quote
  }
}

export interface ScheduleTimeInput {
  clientContactId: string
  startIso: string
  endIso: string
  durationMinutes?: number
  reason?: string | null
  feeAccepted?: boolean
}

export interface ScheduledTimeResult {
  bookingRef: string
  startIso: string
  endIso: string
  calendarWritten: boolean
  consentEventId: string | null
}

// ctx MUST be the client's own actor context (the authed route builds it from
// the session) — the booking, the consent, and the calendar hold are all the
// client's own acts on the ledger.
export async function scheduleClientTime(
  ctx: ActionContext,
  input: ScheduleTimeInput,
): Promise<ScheduledTimeResult> {
  const start = new Date(input.startIso)
  const end = new Date(input.endIso)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error('That time slot is invalid — please pick another.')
  }
  if (start.getTime() <= Date.now()) throw new Error('That time has passed — please pick another.')
  const durationMinutes =
    input.durationMinutes ?? Math.round((end.getTime() - start.getTime()) / 60000)

  // Still free on the firm's LIVE calendar (rules ∩ free/busy).
  const avail = await getPortalSchedulingAvailability(ctx, { durationMinutes })
  if (!avail.configured) throw new Error('Scheduling is not available right now.')
  if (!avail.slots.some((s) => s.startIso === input.startIso)) {
    throw new Error('That time was just taken — please pick another available slot.')
  }

  // Fee consent (WP3): billable scheduling proceeds only past an accepted quote.
  const quote = await getSchedulingFeeQuote(ctx, input.clientContactId, durationMinutes)
  let consentEventId: string | null = null
  if (quote) {
    const subjectKey = `${input.startIso}|${durationMinutes}`
    const existing = await findFeeConsent(ctx, {
      clientContactId: input.clientContactId,
      subjectKind: 'scheduled_time',
      subjectKey,
      amount: quote.amount,
      rate: quote.rate,
    })
    if (existing) {
      consentEventId = existing.consentEventId
    } else {
      if (input.feeAccepted !== true) throw new SchedulingFeeConsentRequiredError(quote)
      const { quoteEventId } = await presentFeeQuote(ctx, {
        clientContactId: input.clientContactId,
        subjectKind: 'scheduled_time',
        subjectKey,
        amount: quote.amount,
        rate: quote.rate,
        durationMinutes,
        basis: 'consultation',
        description: quote.description,
      })
      const decided = await decideFeeQuote(ctx, {
        clientContactId: input.clientContactId,
        quoteEventId,
        decision: 'accept',
      })
      consentEventId = decided.consentEventId
    }
  }

  const email = await loadClientContactEmail(ctx.tenantId, input.clientContactId)
  const name = await withActionContext(ctx, (client) =>
    getLatestAttributeValue<string>(client, ctx.tenantId, input.clientContactId, 'full_name'),
  )

  // Real calendar hold (best-effort — the booking records with or without it).
  const cal = await tryCreateStandaloneEvent(ctx, {
    firmName: 'Pacheco Law',
    clientName: name ?? email ?? 'Client',
    clientEmail: email ?? '',
    reason: input.reason ?? 'Scheduled from the client portal',
    startIso: input.startIso,
    endIso: input.endIso,
  })

  // booking.create with the CONTACT as subject (matter-less, standalone shape),
  // attributed to the client's own actor.
  const bookingRef = `B-${Date.now().toString(36).toUpperCase()}`
  await submitAction(ctx, {
    actionKindName: 'booking.create',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: input.clientContactId,
      matter_number: bookingRef,
      scheduled_at: input.startIso,
      scheduled_end: input.endIso,
      google_event_id: cal?.eventId ?? null,
      google_event_url: cal?.htmlLink ?? null,
    },
  })

  // Confirmation email (transactional template; the calendar invite also goes
  // out via sendUpdates when the hold was written).
  if (email) {
    await queueNotification(ctx, {
      routeKindName: 'prospect_booking_confirmation',
      to: email,
      variables: {
        client_full_name: name ?? email,
        client_email: email,
        service_label: 'Consultation',
        scheduled_at: input.startIso,
        scheduled_at_label: start.toLocaleString('en-US', {
          timeZone: avail.timezone || 'America/New_York',
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        }),
      },
    })
  }

  return {
    bookingRef,
    startIso: input.startIso,
    endIso: input.endIso,
    calendarWritten: cal != null,
    consentEventId,
  }
}
