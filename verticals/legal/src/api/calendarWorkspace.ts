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
  type WorkspaceEvent,
} from '../adapters/googleCalendar.js'
import { getMatter } from '../queries/matters.js'

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
): Promise<{ events: WorkspaceCalendarEvent[]; source: 'google' | 'disconnected' }> {
  let events: WorkspaceEvent[]
  try {
    events = await listCalendarEvents(ctx.tenantId, fromIso, toIso)
  } catch {
    return { events: [], source: 'disconnected' }
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

  const creds = await loadCredentials(ctx.tenantId)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.URL ?? 'http://localhost:3000'
  let googleEventId: string | null = null
  let googleEventUrl: string | null = null
  if (creds) {
    const created = await createBookingEvent({
      tenantId: ctx.tenantId,
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
}

export async function rescheduleBooking(
  ctx: ActionContext,
  input: RescheduleBookingInput,
): Promise<ActionResult> {
  const eventId = await matterGoogleEventId(ctx, input.matterEntityId)
  if (eventId) {
    await rescheduleEvent(ctx.tenantId, eventId, input.startIso, input.endIso)
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
  input: { matterEntityId: string; reason?: string },
): Promise<ActionResult> {
  const eventId = await matterGoogleEventId(ctx, input.matterEntityId)
  if (eventId) {
    await cancelEvent(ctx.tenantId, eventId).catch(() => {
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
