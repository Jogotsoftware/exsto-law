import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'
import { getCalendarEvent, type WorkspaceEvent } from '../adapters/googleCalendar.js'
import { resolveFirmPrimaryActor } from '../adapters/connectionStore.js'
import { listMeetingsToReconcile, type MeetingSummary } from '../queries/meetings.js'

// Write API for meetings (beta sprint Obj 8). The attorney picks a live Google
// event (already surfaced by legal.calendar.events) and assigns it to a matter;
// the event fields ride along so the handler — a pure substrate writer — captures
// the snapshot without a Google round-trip of its own (same division booking.ts
// uses). Re-assigning to a different matter re-routes (the handler seals the prior
// link). Unassign detaches.

export interface AssignMeetingInput {
  googleEventId: string
  matterEntityId: string
  // The event fields as read from Google (legal.calendar.events / WorkspaceEvent).
  summary: string
  startedAt: string | null
  endedAt: string | null
  allDay: boolean
  attendeeEmails: string[]
  htmlLink: string | null
  eventStatus: string
}

export interface AssignMeetingResult {
  calendarEventEntityId?: string
  matterEntityId?: string
  captured?: boolean
  reassignedFrom?: string | null
  alreadyAssigned?: boolean
  skipped?: boolean
  reason?: string
  googleEventId?: string
}

export async function assignMeeting(
  ctx: ActionContext,
  input: AssignMeetingInput,
): Promise<AssignMeetingResult> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.meeting.assign',
    intentKind: 'adjustment',
    payload: {
      google_event_id: input.googleEventId,
      matter_entity_id: input.matterEntityId,
      summary: input.summary,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      all_day: input.allDay,
      attendee_emails: input.attendeeEmails,
      html_link: input.htmlLink,
      event_status: input.eventStatus,
    },
  })
  return res.effects[0] as AssignMeetingResult
}

export async function unassignMeeting(
  ctx: ActionContext,
  calendarEventEntityId: string,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'legal.meeting.unassign',
    intentKind: 'adjustment',
    payload: { calendar_event_entity_id: calendarEventEntityId },
  })
}

// ── Reconciliation (worker-driven) ──────────────────────────────────────────
// Re-read each assigned meeting's Google event and append corrections when it
// changed (moved/renamed/cancelled). Pure additive: a deleted event becomes
// status='cancelled', a changed field a new value row — never an in-place edit.

const norm = (s: string | null): number | null => (s ? new Date(s).getTime() : null)

// Has the live Google event diverged from our stored snapshot?
function meetingDiverged(snap: MeetingSummary, ev: WorkspaceEvent): boolean {
  if (snap.title !== ev.summary) return true
  if (norm(snap.startIso) !== norm(ev.startIso)) return true
  if (norm(snap.endIso) !== norm(ev.endIso)) return true
  if (snap.allDay !== ev.allDay) return true
  if ((snap.eventStatus ?? 'confirmed') !== ev.status) return true
  if ((snap.htmlLink ?? null) !== (ev.htmlLink ?? null)) return true
  const a = [...snap.attendeeEmails].sort()
  const b = [...ev.attendeeEmails].sort()
  return JSON.stringify(a) !== JSON.stringify(b)
}

export interface ReconcileSummary {
  checked: number
  updated: number
  cancelled: number
  skipped: number
}

// Reconcile every assigned meeting against Google. Best-effort per event: a
// fetch error skips that one (retried next pass) rather than failing the batch.
export async function reconcileAllMeetings(ctx: ActionContext): Promise<ReconcileSummary> {
  const googleActor = await resolveFirmPrimaryActor(ctx.tenantId, 'google')
  const meetings = await listMeetingsToReconcile(ctx)
  const result: ReconcileSummary = { checked: 0, updated: 0, cancelled: 0, skipped: 0 }
  if (!googleActor) {
    result.skipped = meetings.length
    return result
  }

  for (const m of meetings) {
    if (!m.googleEventId) {
      result.skipped += 1
      continue
    }
    result.checked += 1
    let ev: WorkspaceEvent | null
    try {
      ev = await getCalendarEvent(ctx.tenantId, m.googleEventId, googleActor)
    } catch {
      // Auth/network error — leave the snapshot as-is, try again next pass.
      result.skipped += 1
      continue
    }

    if (ev === null) {
      // Gone from Google (cancelled/deleted). Mark it once.
      if ((m.eventStatus ?? 'confirmed') !== 'cancelled') {
        await submitAction(ctx, {
          actionKindName: 'legal.meeting.reconcile',
          intentKind: 'automatic_sync',
          payload: {
            calendar_event_entity_id: m.calendarEventEntityId,
            google_event_id: m.googleEventId,
            deleted: true,
          },
        })
        result.cancelled += 1
      }
      continue
    }

    if (meetingDiverged(m, ev)) {
      await submitAction(ctx, {
        actionKindName: 'legal.meeting.reconcile',
        intentKind: 'automatic_sync',
        payload: {
          calendar_event_entity_id: m.calendarEventEntityId,
          google_event_id: m.googleEventId,
          summary: ev.summary,
          started_at: ev.startIso,
          ended_at: ev.endIso,
          all_day: ev.allDay,
          attendee_emails: ev.attendeeEmails,
          html_link: ev.htmlLink,
          event_status: ev.status,
        },
      })
      result.updated += 1
    }
  }
  return result
}
