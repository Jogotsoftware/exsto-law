// BOOKING-FRONTDOOR-1 — the standalone public booking front door ("grab time on my
// calendar"). A service-AGNOSTIC Calendly-style link at /book/{slug}: a prospect
// resolves the firm by its public slug, sees the firm's REAL available slots (rules
// ∩ live Google free/busy), and books with just contact info + a reason. This is a
// SECOND, parallel booking surface — it reuses the booking primitives (firm rules,
// the availability engine, booking.create, the Google event write) but has NOTHING
// to do with the in-service intake path (submitBooking): no service, no matter, no
// questionnaire, no workflow. The only "gate" is name / email / phone / reason.
//
// NO-SIMULATE: availability is REAL Google free/busy only (getGoogleAvailability,
// never getAvailability's stub fallback). A firm with no connected calendar shows
// honestly-empty availability, never fabricated slots.
import { withAppRole, withTenant } from '@exsto/shared'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { getFirmBookingRules, type FirmBookingRules } from './firmBookingRules.js'
import { getGoogleAvailability, createCalendarEvent } from '../adapters/googleCalendar.js'
// Re-export the pure availability intersection so callers + tests can reach it via
// the package without importing the adapter directly.
export { computeAvailabilityFromBusy } from '../adapters/googleCalendar.js'
export type { AvailabilitySlot } from '../adapters/googleCalendar.js'
export { resolveFirmPrimaryActor } from '../adapters/connectionStore.js'
import { resolveFirmPrimaryActor } from '../adapters/connectionStore.js'
import { getGoogleStatus } from './google.js'

// The public-intake SYSTEM actor (ADR 0035): every public write is attributed to it,
// never an authenticated human. Client identity lives in the created contact row.
// Resolve the RESOLVED firm's OWN system actor per booking: a single global const
// (tenant zero's …0005) FK-fails booking.create/client.create for ANY other tenant,
// whose …0005 does not exist. Falls back to the historical env/const so tenant-zero
// behavior is unchanged.
const PUBLIC_INTAKE_ACTOR_FALLBACK =
  process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'

// The tenant's own public-intake actor: the historical …0005 when it exists in this
// tenant (tenant zero), else the tenant's system/agent actor. Reads the `actor` table
// UNDER THE TENANT'S OWN CONTEXT (withTenant): the tenant id is already known, and the
// actor RLS policy casts app.tenant_id::uuid — under an RLS-engaged role (ADR 0037
// SUBSTRATE_DB_ROLE=authenticated) withAppRole leaves app.tenant_id unset (''), which
// blows up as "invalid input syntax for type uuid". withTenant binds it, so the lookup
// is RLS-safe whether the connection logs in as owner or authenticator. (This is why it
// differs from resolvePublicFirm, which is a genuinely cross-tenant slug→tenant lookup
// via a SECURITY DEFINER function.) Exported (MULTI-TENANT-1): the app-layer public
// funnel resolves the per-tenant intake actor the same way the /book/{slug} front door
// does, so a write under a resolved firm is attributed to THAT firm's actor.
export async function resolvePublicIntakeActor(tenantId: string): Promise<string> {
  return withTenant(tenantId, async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM actor
        WHERE tenant_id = $1 AND status = 'active'
          AND (id = $2 OR actor_type IN ('system', 'agent'))
        ORDER BY (id = $2) DESC,
                 CASE actor_type WHEN 'system' THEN 0 ELSE 1 END, created_at
        LIMIT 1`,
      [tenantId, PUBLIC_INTAKE_ACTOR_FALLBACK],
    )
    return res.rows[0]?.id ?? PUBLIC_INTAKE_ACTOR_FALLBACK
  })
}

const MAX_DAYS_OUT = 60

export interface PublicFirm {
  tenantId: string
  firmName: string
}

// WP1 — resolve a public slug to its firm WITHOUT a tenant context. Goes through the
// SECURITY DEFINER resolver (migration 0119), which exposes ONLY the tenant id + firm
// name for an active, slug-matching firm — never any private tenant data. withAppRole
// runs as the app role with NO app.tenant_id set (there is no tenant yet); the
// resolver's definer rights are what make the single cross-tenant lookup possible.
export async function resolvePublicFirm(slug: string): Promise<PublicFirm | null> {
  const s = (slug ?? '').trim().toLowerCase()
  if (!s || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(s)) return null
  return withAppRole(async (client) => {
    const res = await client.query<{ tenant_id: string; firm_name: string }>(
      `SELECT tenant_id, firm_name FROM public.resolve_public_firm($1)`,
      [s],
    )
    const row = res.rows[0]
    return row ? { tenantId: row.tenant_id, firmName: row.firm_name } : null
  })
}

export interface PublicSlot {
  startIso: string
  endIso: string
  label: string
}

// A candidate cell for the calendar grid: a time + whether it is OPEN (available) or
// blocked. Carries NO event detail — only the time and busy/free — so the public
// calendar exposes busy/free and nothing about what the attorney is doing.
export interface PublicGridSlot extends PublicSlot {
  available: boolean
}

export interface PublicAvailability {
  firmName: string
  timezone: string
  meetingLengthsMinutes: number[]
  durationMinutes: number
  // Only TRUE-available slots (rules ∩ live Google free/busy). Never fabricated.
  // Drives the list view + the confirm no-double-book re-check.
  slots: PublicSlot[]
  // The FULL candidate grid (open + blocked) for the calendar view — same computed
  // set as `slots`, unfiltered, each cell tagged available/blocked. Anonymous
  // (times only, no event detail). Empty when not configured.
  gridSlots: PublicGridSlot[]
  // false when the firm has not connected a calendar — the page shows an honest
  // "not yet configured", NEVER stub slots (NO-SIMULATE).
  configured: boolean
}

// Firm ctx for a resolved public booking (the tenant's own public-intake system actor).
async function firmCtx(tenantId: string): Promise<ActionContext> {
  return { tenantId, actorId: await resolvePublicIntakeActor(tenantId) }
}

// Pick the duration to compute against: the requested one IF the firm offers it,
// else the firm's first offered length.
function pickDuration(rules: FirmBookingRules, requested: number | undefined): number {
  if (requested && rules.meetingLengthsMinutes.includes(requested)) return requested
  return rules.meetingLengthsMinutes[0] ?? rules.defaultDurationMinutes
}

// WP3 — public availability for a slug. REAL Google free/busy only.
export async function getPublicAvailability(
  slug: string,
  opts: { durationMinutes?: number; daysOut?: number } = {},
): Promise<PublicAvailability | null> {
  const firm = await resolvePublicFirm(slug)
  if (!firm) return null
  const ctx = await firmCtx(firm.tenantId)
  const rules = await getFirmBookingRules(ctx)
  const durationMinutes = pickDuration(rules, opts.durationMinutes)
  const daysOut = Math.min(MAX_DAYS_OUT, Math.max(1, opts.daysOut ?? 21))

  const base = {
    firmName: firm.firmName,
    timezone: rules.timezone,
    meetingLengthsMinutes: rules.meetingLengthsMinutes,
    durationMinutes,
  }

  // The firm's primary connected Google attorney. No connection → not configured →
  // honestly no availability (never stub).
  const firmActor = await resolveFirmPrimaryActor(firm.tenantId, 'google')
  const status = await getGoogleStatus(ctx, firmActor)
  if (!firmActor || !status.connected) {
    return { ...base, slots: [], gridSlots: [], configured: false }
  }

  try {
    // getGoogleAvailability throws if the freebusy read fails; we do NOT fall back to
    // getAvailability's stub — real slots or honestly none.
    const slots = await getGoogleAvailability(
      firm.tenantId,
      daysOut,
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
      // The full computed grid (open + blocked), anonymous — each cell only carries a
      // time + busy/free flag. The calendar renders open as clickable, blocked as an
      // anonymous greyed cell; no event detail exists here to leak.
      gridSlots: slots.map(({ startIso, endIso, label, available }) => ({
        startIso,
        endIso,
        label,
        available,
      })),
    }
  } catch (err) {
    console.error(`[publicBooking] availability read failed for ${firm.tenantId}:`, err)
    // A connected-but-erroring calendar shows honestly-empty, never fabricated.
    return { ...base, slots: [], gridSlots: [], configured: false }
  }
}

// Best-effort standalone Google hold on the firm's primary attorney calendar (the
// prospect is the sole guest). Matter-LESS (createCalendarEvent, not the in-service
// createBookingEvent). Returns the event id/link, or null if Google isn't connected
// or the write fails — the booking is still recorded either way.
export async function tryCreateStandaloneEvent(
  ctx: ActionContext,
  args: {
    firmName: string
    clientName: string
    clientEmail: string
    reason: string
    startIso: string
    endIso: string
  },
): Promise<{ eventId: string; htmlLink: string } | null> {
  const firmActor = await resolveFirmPrimaryActor(ctx.tenantId, 'google')
  const status = await getGoogleStatus(ctx, firmActor)
  if (!firmActor || !status.connected || !status.accountEmail) return null
  try {
    const ev = await createCalendarEvent({
      tenantId: ctx.tenantId,
      actorId: firmActor,
      summary: `${args.firmName} — consultation (${args.clientName})`,
      description: args.reason ? `Reason: ${args.reason}` : '',
      startIso: args.startIso,
      endIso: args.endIso,
      attorneyEmail: status.accountEmail,
      attendeeEmails: args.clientEmail ? [args.clientEmail] : [],
    })
    return { eventId: ev.eventId, htmlLink: ev.htmlLink }
  } catch (err) {
    console.error('[publicBooking] standalone calendar write failed:', err)
    return null
  }
}

export interface PublicBookingInput {
  slug: string
  clientName: string
  clientEmail: string
  clientPhone?: string | null
  reason?: string | null
  startIso: string
  endIso: string
  durationMinutes?: number
}

export interface PublicBookingResult {
  firmName: string
  clientEntityId: string
  bookingActionId: string
  startIso: string
  endIso: string
  calendarWritten: boolean
  calendarLink: string | null
}

// WP4 — record a standalone booking. Creates a lightweight CONTACT (the first CRM
// row) carrying the lead's details, writes the Google hold (best-effort), and records
// booking.create attributed to the public-intake actor with the CONTACT as its
// subject (reuses the booking pipeline; never touches the matter-coupled in-service
// path). Re-checks live availability first so a slot taken since page load can't be
// double-booked. Throws a VISIBLE error on any failure — never a silent dead-end.
export async function submitPublicBooking(input: PublicBookingInput): Promise<PublicBookingResult> {
  const firm = await resolvePublicFirm(input.slug)
  if (!firm) throw new Error('This booking link is not valid.')
  const ctx = await firmCtx(firm.tenantId)

  const name = (input.clientName ?? '').trim()
  const email = (input.clientEmail ?? '').trim()
  if (!name) throw new Error('Please enter your name.')
  if (!email || !email.includes('@')) throw new Error('Please enter a valid email.')
  const start = new Date(input.startIso)
  const end = new Date(input.endIso)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error('That time slot is invalid — please pick another.')
  }
  if (start.getTime() <= Date.now()) throw new Error('That time has passed — please pick another.')

  const rules = await getFirmBookingRules(ctx)
  const durationMinutes = pickDuration(rules, input.durationMinutes)

  // No-double-book: the slot must STILL be free on the firm's live calendar. This
  // catches a slot booked between page load and confirm.
  const avail = await getPublicAvailability(input.slug, { durationMinutes })
  if (!avail || !avail.configured) {
    throw new Error('This firm is not accepting bookings right now.')
  }
  const stillFree = avail.slots.some((s) => s.startIso === input.startIso)
  if (!stillFree) {
    throw new Error('That time was just taken — please pick another available slot.')
  }

  // 1) The lightweight contact — the first CRM row. Name is the entity name +
  //    client_name; email/phone/reason/source ride the entity metadata.
  const created = await submitAction(ctx, {
    actionKindName: 'legal.client.create',
    intentKind: 'enforcement',
    payload: {
      client_name: name,
      metadata: {
        source: 'public_booking',
        booking_slug: input.slug,
        contact_email: email,
        contact_phone: input.clientPhone ?? null,
        booking_reason: input.reason ?? null,
      },
    },
  })
  const clientEntityId = (created.effects[0] as { clientEntityId: string }).clientEntityId

  // 2) The Google hold (best-effort — recorded on the booking below when present).
  const cal = await tryCreateStandaloneEvent(ctx, {
    firmName: firm.firmName,
    clientName: name,
    clientEmail: email,
    reason: input.reason ?? '',
    startIso: input.startIso,
    endIso: input.endIso,
  })

  // 3) booking.create attributed to the public-intake actor, with the CONTACT as the
  //    subject (matter-less). Reuses the booking pipeline verbatim — no touch to the
  //    in-service submitBooking. A booking ref stands in for the matter number.
  const bookingRef = `B-${Date.now().toString(36).toUpperCase()}`
  const booked = await submitAction(ctx, {
    actionKindName: 'booking.create',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: clientEntityId,
      matter_number: bookingRef,
      scheduled_at: input.startIso,
      scheduled_end: input.endIso,
      google_event_id: cal?.eventId ?? null,
      google_event_url: cal?.htmlLink ?? null,
    },
  })

  return {
    firmName: firm.firmName,
    clientEntityId,
    bookingActionId: booked.actionId,
    startIso: input.startIso,
    endIso: input.endIso,
    calendarWritten: cal != null,
    calendarLink: cal?.htmlLink ?? null,
  }
}

// WP1 helper — the firm's public slug (for the attorney settings page to show/copy
// their link). Tenant-scoped read (the attorney is authenticated for their tenant).
export async function getOwnPublicSlug(ctx: ActionContext): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ public_slug: string | null }>(
      `SELECT public_slug FROM tenant WHERE id = $1`,
      [ctx.tenantId],
    )
    return res.rows[0]?.public_slug ?? null
  })
}
