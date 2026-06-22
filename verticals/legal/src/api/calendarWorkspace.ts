// Calendar workspace (WP7, REQ-CALMAIL-01): full visibility + management of
// the attorney's real calendar. In-app changes write through the action layer
// (booking.create/update/cancel) AND round-trip to Google; events created
// directly in Google appear via the live read. Consultation events link to
// their matters through the google_event_id stored on the matter.
import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import {
  listCalendarEvents,
  createBookingEvent,
  rescheduleEvent,
  cancelEvent,
  loadCredentials,
  fetchBusyIntervals,
  type WorkspaceEvent,
  type BusyInterval,
} from '../adapters/googleCalendar.js'
import { redactSecret } from '../adapters/redact.js'
import { getMatter } from '../queries/matters.js'
import { listMatterConsultations, type UpcomingBooking, type BookingCategory } from './calendar.js'

// 'google'       — live read succeeded.
// 'disconnected' — no Google credentials for this attorney (genuinely not set up).
// 'error'        — credentials EXIST but the Google API call failed (e.g. the
//                  Calendar API is not enabled in the Cloud project, or the token
//                  was revoked). Previously this was swallowed as 'disconnected'
//                  and rendered as an empty calendar, hiding the real cause.
export type CalendarSource = 'google' | 'disconnected' | 'error'

// Concise, secret-safe message from a Google API failure. Google's own errors are
// the most actionable thing we can show (they name the disabled API + project), so
// surface them — just truncated and with any token-like substring scrubbed.
export function cleanGoogleError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return redactSecret(raw).replace(/\s+/g, ' ').trim().slice(0, 400)
}

export interface WorkspaceCalendarEvent extends WorkspaceEvent {
  matterEntityId: string | null
  matterNumber: string | null
  managedByApp: boolean
}

// Live Google events merged with matter linkage (google_event_id ↔ matter
// metadata). Events with no matter render read-only in the app.
export async function listWorkspaceEvents(
  ctx: ActionContext,
  fromIso: string,
  toIso: string,
): Promise<{ events: WorkspaceCalendarEvent[]; source: CalendarSource; error?: string }> {
  // No credentials = genuinely disconnected (not an error). Distinguishing this
  // up front means a real API failure below surfaces instead of masquerading as
  // an empty, "disconnected" calendar.
  const creds = await loadCredentials(ctx.tenantId, ctx.actorId)
  if (!creds) return { events: [], source: 'disconnected' }

  let events: WorkspaceEvent[]
  try {
    events = await listCalendarEvents(ctx.tenantId, fromIso, toIso, ctx.actorId)
  } catch (err) {
    // Connected, but the Google read failed (Calendar API disabled in the
    // project, revoked token, …). Surface the cause rather than hiding it.
    return { events: [], source: 'error', error: cleanGoogleError(err) }
  }

  const ids = events.map((e) => e.eventId)
  const links = await withActionContext(ctx, async (client) => {
    if (ids.length === 0) return new Map<string, { id: string; name: string }>()
    const res = await client.query<{ event_id: string; id: string; name: string }>(
      `SELECT e.metadata->>'google_event_id' AS event_id, e.id, e.name
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'matter' AND e.status = 'active'
         AND e.metadata->>'google_event_id' = ANY($2)`,
      [ctx.tenantId, ids],
    )
    return new Map(res.rows.map((r) => [r.event_id, { id: r.id, name: r.name }]))
  })

  return {
    events: events.map((e) => {
      const m = links.get(e.eventId)
      return {
        ...e,
        matterEntityId: m?.id ?? null,
        matterNumber: m?.name ?? null,
        managedByApp: Boolean(m),
      }
    }),
    source: 'google',
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Contract M — getBusyIntervals(range): the busy/free picture of the attorney's
// synced Google calendar. S5's availability engine consumes this; keep the shape
// stable. Returns merged BUSY intervals within [fromIso, toIso) — free time is
// the complement, which the caller computes against its own working-hours model.
// `source` mirrors listWorkspaceEvents: 'disconnected' (no Google creds),
// 'error' (connected but the read failed; cause in `error`), 'google' (live).
// ───────────────────────────────────────────────────────────────────────────
export interface BusyIntervalsResult {
  intervals: BusyInterval[]
  source: CalendarSource
  error?: string
}

export async function getBusyIntervals(
  ctx: ActionContext,
  range: { fromIso: string; toIso: string },
): Promise<BusyIntervalsResult> {
  // Same disconnected-vs-error discipline as listWorkspaceEvents: no creds is a
  // genuine 'disconnected', a thrown read is a real 'error' with a clean cause.
  const creds = await loadCredentials(ctx.tenantId, ctx.actorId)
  if (!creds) return { intervals: [], source: 'disconnected' }
  try {
    const intervals = await fetchBusyIntervals(
      ctx.tenantId,
      range.fromIso,
      range.toIso,
      ctx.actorId,
    )
    return { intervals, source: 'google' }
  } catch (err) {
    return { intervals: [], source: 'error', error: cleanGoogleError(err) }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Unified calendar feed: the attorney's REAL Google calendar for a date range,
// merged with app-booked consultations. This is what the dashboard renders so it
// shows live Google events — not just app consultations. Consultations carry full
// matter context (clickable); the attorney's other Google events ride along as
// read-only "external" items. Matter-linked Google events ARE the consultations,
// so they're skipped from the external list (dedup, see mergeCalendarFeed).
// ───────────────────────────────────────────────────────────────────────────

export interface CalendarFeedItem {
  id: string
  title: string
  startIso: string
  endIso: string | null
  allDay: boolean
  // 'consultation' = an app-booked matter consultation (clickable → matter);
  // 'external' = one of the attorney's own Google events with no matter link.
  kind: 'consultation' | 'external'
  matterEntityId: string | null
  matterNumber: string | null
  clientName: string | null
  serviceKey: string | null
  category: BookingCategory | null
  status: string | null
  htmlLink: string | null
}

// Pure merge so the dedup logic is unit-testable without a DB or Google.
export function mergeCalendarFeed(
  consultations: UpcomingBooking[],
  workspaceEvents: WorkspaceCalendarEvent[],
): CalendarFeedItem[] {
  const items: CalendarFeedItem[] = consultations.map((c) => ({
    id: `consult:${c.matterEntityId}:${c.scheduledAt}`,
    title: c.clientName || c.matterNumber,
    startIso: c.scheduledAt,
    endIso: c.scheduledEnd,
    allDay: false,
    kind: 'consultation',
    matterEntityId: c.matterEntityId,
    matterNumber: c.matterNumber,
    clientName: c.clientName || null,
    serviceKey: c.serviceKey || null,
    category: c.category,
    status: c.status || null,
    htmlLink: null,
  }))
  for (const e of workspaceEvents) {
    // managedByApp events are the app consultations above — skip to avoid showing
    // each booked consultation twice (once as a consultation, once as a Google
    // event). Skip events Google couldn't give a start time for.
    if (e.managedByApp || !e.startIso) continue
    items.push({
      id: `gcal:${e.eventId}`,
      title: e.summary || '(busy)',
      startIso: e.startIso,
      endIso: e.endIso,
      allDay: e.allDay,
      kind: 'external',
      matterEntityId: null,
      matterNumber: null,
      clientName: null,
      serviceKey: null,
      category: null,
      status: e.status || null,
      htmlLink: e.htmlLink,
    })
  }
  return items.sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime())
}

// Fetch consultations + the real Google calendar for [fromIso, toIso) and merge.
// source='disconnected' (no Google) or 'error' (connected but the read failed,
// with `error` set) both fall back to consultations-only; the UI surfaces `error`.
export async function listCalendarFeed(
  ctx: ActionContext,
  fromIso: string,
  toIso: string,
): Promise<{ items: CalendarFeedItem[]; source: CalendarSource; error?: string }> {
  const [consultations, workspace] = await Promise.all([
    listMatterConsultations(ctx, fromIso, toIso),
    listWorkspaceEvents(ctx, fromIso, toIso),
  ])
  return {
    items: mergeCalendarFeed(consultations, workspace.events),
    source: workspace.source,
    error: workspace.error,
  }
}

export interface CreateConsultationInput {
  matterEntityId: string
  startIso: string
  endIso: string
}

// Attorney books/rebooks a consultation for an existing matter from the
// Calendar tab. Creates the Google event first (invite emails), then records
// booking.create.
export async function createConsultation(
  ctx: ActionContext,
  input: CreateConsultationInput,
): Promise<ActionResult> {
  const matter = await getMatter(ctx, input.matterEntityId)
  if (!matter) throw new Error(`Matter not found: ${input.matterEntityId}`)

  const creds = await loadCredentials(ctx.tenantId, ctx.actorId)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.URL ?? 'http://localhost:3000'
  let googleEventId: string | null = null
  let googleEventUrl: string | null = null
  if (creds) {
    const created = await createBookingEvent({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      summary: `Consultation — ${matter.clientName || matter.matterNumber}`,
      descriptionHtml: `Consultation for matter <b>${matter.matterNumber}</b> (${matter.serviceKey}).<br><a href="${baseUrl}/attorney/matters/${matter.matterEntityId}">Open the matter</a>`,
      startIso: input.startIso,
      endIso: input.endIso,
      attorneyEmail: creds.accountEmail,
      clientEmail: matter.clientEmail ?? creds.accountEmail,
      clientName: matter.clientName || 'Client',
      matterId: matter.matterEntityId,
      matterReschedulePath: `/book/reschedule/${matter.matterEntityId}`,
      bookingBaseUrl: baseUrl,
    })
    googleEventId = created.eventId
    googleEventUrl = created.htmlLink
  }

  return submitAction(ctx, {
    actionKindName: 'booking.create',
    intentKind: 'adjustment',
    payload: {
      matter_entity_id: input.matterEntityId,
      scheduled_at: input.startIso,
      scheduled_end: input.endIso,
      google_event_id: googleEventId,
      google_event_url: googleEventUrl,
    },
  })
}

export interface RescheduleBookingInput {
  matterEntityId: string
  startIso: string
  endIso: string
  // Whose Google credentials drive the calendar-event update. Defaults to the
  // acting context (attorney-side flow). The PUBLIC client manage-link flow runs
  // as the system actor — which has no Google creds — so it passes the firm's
  // primary connected actor here while the substrate action stays attributed to
  // the context actor (provenance of who initiated the change).
  calendarActorId?: string
}

export async function rescheduleBooking(
  ctx: ActionContext,
  input: RescheduleBookingInput,
): Promise<ActionResult> {
  const eventId = await matterGoogleEventId(ctx, input.matterEntityId)
  if (eventId) {
    await rescheduleEvent(
      ctx.tenantId,
      eventId,
      input.startIso,
      input.endIso,
      input.calendarActorId ?? ctx.actorId,
    )
  }
  return submitAction(ctx, {
    actionKindName: 'booking.update',
    intentKind: 'adjustment',
    payload: {
      matter_entity_id: input.matterEntityId,
      scheduled_at: input.startIso,
      scheduled_end: input.endIso,
      google_event_id: eventId,
    },
  })
}

export async function cancelBooking(
  ctx: ActionContext,
  input: { matterEntityId: string; reason?: string; calendarActorId?: string },
): Promise<ActionResult> {
  const eventId = await matterGoogleEventId(ctx, input.matterEntityId)
  if (eventId) {
    await cancelEvent(ctx.tenantId, eventId, input.calendarActorId ?? ctx.actorId).catch(() => {
      // Event already gone in Google — the substrate record still closes out.
    })
  }
  return submitAction(ctx, {
    actionKindName: 'booking.cancel',
    intentKind: 'adjustment',
    payload: { matter_entity_id: input.matterEntityId, reason: input.reason ?? null },
  })
}

async function matterGoogleEventId(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ event_id: string | null }>(
      `SELECT e.metadata->>'google_event_id' AS event_id
       FROM entity e WHERE e.tenant_id = $1 AND e.id = $2`,
      [ctx.tenantId, matterEntityId],
    )
    return res.rows[0]?.event_id ?? null
  })
}
