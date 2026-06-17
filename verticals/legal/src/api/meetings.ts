import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'

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
