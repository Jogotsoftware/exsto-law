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
  addEventAttendees,
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
  // The matter's chosen call-type (consultation_category palette key), if set —
  // drives color-coding on the calendar page. Null for external/uncategorized.
  categoryKey: string | null
  // For app-CREATED meetings (legal.meeting.create — contact/personal events): the
  // calendar_event entity id, plus the linked contact. Null for consultations and
  // external Google events. Lets the page reschedule/cancel via the meeting actions.
  meetingEntityId: string | null
  contactEntityId: string | null
  contactName: string | null
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
  const emptyMatter = () =>
    new Map<string, { id: string; name: string; categoryKey: string | null }>()
  const emptyMeeting = () =>
    new Map<
      string,
      {
        calendarEventId: string
        matterId: string | null
        matterName: string | null
        contactId: string | null
        contactName: string | null
      }
    >()

  const { matterLinks, meetingLinks } = await withActionContext(ctx, async (client) => {
    if (ids.length === 0) return { matterLinks: emptyMatter(), meetingLinks: emptyMeeting() }

    // (1) Consultations: a matter carries its booked Google event id in metadata.
    // Latest consultation_category rides along to color the event by call-type.
    const matterRes = await client.query<{
      event_id: string
      id: string
      name: string
      category_key: string | null
    }>(
      `SELECT e.metadata->>'google_event_id' AS event_id, e.id, e.name,
              (SELECT a2.value #>> '{}' FROM attribute a2
                 JOIN attribute_kind_definition k2 ON k2.id = a2.attribute_kind_id
                WHERE a2.tenant_id = $1 AND a2.entity_id = e.id
                  AND k2.kind_name = 'consultation_category' AND a2.valid_to IS NULL
                ORDER BY a2.valid_from DESC LIMIT 1) AS category_key
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'matter' AND e.status = 'active'
         AND e.metadata->>'google_event_id' = ANY($2)`,
      [ctx.tenantId, ids],
    )

    // (2) App-created meetings: a calendar_event holds its Google id in the
    // meeting_google_event_id attribute, with its matter (meeting_of) and/or
    // contact (meeting_with) open links. Personal blocks have neither.
    const meetingRes = await client.query<{
      event_id: string
      calendar_event_id: string
      matter_id: string | null
      matter_name: string | null
      contact_id: string | null
      contact_name: string | null
    }>(
      `SELECT gid.value #>> '{}' AS event_id,
              ce.id AS calendar_event_id,
              m.id AS matter_id, m.name AS matter_name,
              ct.id AS contact_id, cn.value #>> '{}' AS contact_name
       FROM entity ce
       JOIN entity_kind_definition cek ON cek.id = ce.entity_kind_id AND cek.kind_name = 'calendar_event'
       JOIN attribute gid ON gid.entity_id = ce.id AND gid.valid_to IS NULL
       JOIN attribute_kind_definition gidk ON gidk.id = gid.attribute_kind_id
            AND gidk.kind_name = 'meeting_google_event_id'
       LEFT JOIN relationship rof ON rof.tenant_id = $1 AND rof.source_entity_id = ce.id
            AND rof.valid_to IS NULL
            AND rof.relationship_kind_id IN
              (SELECT id FROM relationship_kind_definition WHERE tenant_id = $1 AND kind_name = 'meeting_of')
       LEFT JOIN entity m ON m.id = rof.target_entity_id AND m.status = 'active'
       LEFT JOIN relationship rw ON rw.tenant_id = $1 AND rw.source_entity_id = ce.id
            AND rw.valid_to IS NULL
            AND rw.relationship_kind_id IN
              (SELECT id FROM relationship_kind_definition WHERE tenant_id = $1 AND kind_name = 'meeting_with')
       LEFT JOIN entity ct ON ct.id = rw.target_entity_id AND ct.status = 'active'
       LEFT JOIN attribute cn ON cn.entity_id = ct.id AND cn.valid_to IS NULL
            AND cn.attribute_kind_id IN
              (SELECT id FROM attribute_kind_definition WHERE tenant_id = $1 AND kind_name = 'full_name')
       WHERE ce.tenant_id = $1 AND ce.status = 'active'
         AND gid.value #>> '{}' = ANY($2)`,
      [ctx.tenantId, ids],
    )

    return {
      matterLinks: new Map(
        matterRes.rows.map((r) => [
          r.event_id,
          { id: r.id, name: r.name, categoryKey: r.category_key },
        ]),
      ),
      meetingLinks: new Map(
        meetingRes.rows.map((r) => [
          r.event_id,
          {
            calendarEventId: r.calendar_event_id,
            matterId: r.matter_id,
            matterName: r.matter_name,
            contactId: r.contact_id,
            contactName: r.contact_name,
          },
        ]),
      ),
    }
  })

  return {
    events: events.map((e) => {
      const m = matterLinks.get(e.eventId)
      // A consultation (matter metadata) wins; otherwise an app-created meeting.
      const mt = m ? undefined : meetingLinks.get(e.eventId)
      return {
        ...e,
        matterEntityId: m?.id ?? mt?.matterId ?? null,
        matterNumber: m?.name ?? mt?.matterName ?? null,
        categoryKey: m?.categoryKey ?? null,
        meetingEntityId: mt?.calendarEventId ?? null,
        contactEntityId: mt?.contactId ?? null,
        contactName: mt?.contactName ?? null,
        managedByApp: Boolean(m) || Boolean(mt),
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
  // Attorney-chosen palette key (consultation_category); takes precedence over
  // `category` for color-coding. Null for external events / uncategorized.
  categoryKey: string | null
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
    categoryKey: c.categoryKey,
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
      categoryKey: null,
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

// Invite extra guests to a matter's consultation (a Google-event mutation — the
// substrate models the matter's schedule, not the event's guest list, so this is a
// read-through write to Google with no substrate effect, like the live calendar
// read). Google emails the new guests their invite (sendUpdates:'all').
export async function addBookingAttendees(
  ctx: ActionContext,
  input: { matterEntityId: string; attendeeEmails: string[]; calendarActorId?: string },
): Promise<{ attendees: string[] }> {
  const eventId = await matterGoogleEventId(ctx, input.matterEntityId)
  if (!eventId) {
    throw new Error('This consultation has no Google calendar event to add guests to.')
  }
  const emails = (input.attendeeEmails ?? []).map((e) => e.trim()).filter((e) => e.includes('@'))
  if (emails.length === 0) throw new Error('Enter at least one valid email address.')
  return addEventAttendees(ctx.tenantId, eventId, emails, input.calendarActorId ?? ctx.actorId)
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
