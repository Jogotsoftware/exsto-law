import { withActionContext, type ActionContext } from '@exsto/substrate'

// Meetings read layer (beta sprint Obj 8) — the calendar-event twin of calls.ts.
// A meeting is a calendar_event entity linked to a matter via meeting_of (the
// twin of call_of). These reads surface meetings on a matter, on a contact
// (across that contact's matters, same client_of traversal calls use), and the
// not-yet-assigned set. Re-route/unassign seal the meeting_of, so the active link
// is simply the open one — the join mirrors callSelect verbatim.

export interface MeetingSummary {
  calendarEventEntityId: string
  googleEventId: string | null
  title: string
  startIso: string | null
  endIso: string | null
  allDay: boolean
  attendeeEmails: string[]
  htmlLink: string | null
  eventStatus: string | null
  matterEntityId: string | null
  matterNumber: string | null
  capturedAt: string
}

type MeetingRow = {
  calendar_event_id: string
  google_event_id: string | null
  title: string | null
  started_at: string | null
  ended_at: string | null
  all_day: string | null
  attendee_emails: string[] | null
  html_link: string | null
  event_status: string | null
  matter_entity_id: string | null
  matter_number: string | null
  captured_at: Date
}

// Shared projection over calendar_event entities + the OPEN meeting_of link.
function meetingSelect(whereClause: string): string {
  return `
    SELECT
      e.id AS calendar_event_id,
      (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'meeting_google_event_id' ORDER BY a.valid_from DESC LIMIT 1) AS google_event_id,
      (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'meeting_title' ORDER BY a.valid_from DESC LIMIT 1)           AS title,
      (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'meeting_started_at' ORDER BY a.valid_from DESC LIMIT 1)      AS started_at,
      (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'meeting_ended_at' ORDER BY a.valid_from DESC LIMIT 1)        AS ended_at,
      (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'meeting_all_day' ORDER BY a.valid_from DESC LIMIT 1)         AS all_day,
      (SELECT a.value FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'meeting_attendee_emails' ORDER BY a.valid_from DESC LIMIT 1)          AS attendee_emails,
      (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'meeting_html_link' ORDER BY a.valid_from DESC LIMIT 1)       AS html_link,
      (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'meeting_event_status' ORDER BY a.valid_from DESC LIMIT 1)    AS event_status,
      m.id   AS matter_entity_id,
      m.name AS matter_number,
      e.created_at AS captured_at
    FROM entity e
    JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'calendar_event'
    LEFT JOIN relationship mr ON mr.source_entity_id = e.id
      AND mr.relationship_kind_id = (SELECT id FROM relationship_kind_definition WHERE tenant_id = $1 AND kind_name = 'meeting_of')
      AND (mr.valid_to IS NULL OR mr.valid_to > now())
    LEFT JOIN entity m ON m.id = mr.target_entity_id
    WHERE e.tenant_id = $1 AND e.status = 'active' AND ${whereClause}
    ORDER BY started_at DESC NULLS LAST, e.created_at DESC`
}

function mapMeeting(r: MeetingRow): MeetingSummary {
  return {
    calendarEventEntityId: r.calendar_event_id,
    googleEventId: r.google_event_id,
    title: r.title ?? '(no title)',
    startIso: r.started_at,
    endIso: r.ended_at,
    allDay: r.all_day === 'true',
    attendeeEmails: r.attendee_emails ?? [],
    htmlLink: r.html_link,
    eventStatus: r.event_status,
    matterEntityId: r.matter_entity_id,
    matterNumber: r.matter_number,
    capturedAt: r.captured_at.toISOString(),
  }
}

// Meetings assigned to a matter (via the open meeting_of).
export async function listMeetingsForMatter(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<MeetingSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<MeetingRow>(meetingSelect(`mr.target_entity_id = $2`), [
      ctx.tenantId,
      matterEntityId,
    ])
    return res.rows.map(mapMeeting)
  })
}

// Meetings associated with a contact — across every matter the contact is on
// (client_of: contact → matter), exactly the traversal listCallsForContact uses.
export async function listMeetingsForContact(
  ctx: ActionContext,
  contactEntityId: string,
): Promise<MeetingSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<MeetingRow>(
      meetingSelect(
        `mr.target_entity_id IN (
           SELECT r.target_entity_id FROM relationship r
           JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'client_of'
           WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND (r.valid_to IS NULL OR r.valid_to > now())
         )`,
      ),
      [ctx.tenantId, contactEntityId],
    )
    return res.rows.map(mapMeeting)
  })
}

// All meetings currently assigned to a matter (open meeting_of) — the set the
// reconciliation pass re-reads against Google. Each row carries the current
// snapshot so the worker can diff before writing a correction.
export async function listMeetingsToReconcile(ctx: ActionContext): Promise<MeetingSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<MeetingRow>(meetingSelect(`mr.target_entity_id IS NOT NULL`), [
      ctx.tenantId,
    ])
    return res.rows.map(mapMeeting)
  })
}

// Captured meetings not currently assigned to any matter (no open meeting_of) —
// e.g. a meeting the attorney pulled in then unassigned.
export async function listUnassignedMeetings(ctx: ActionContext): Promise<MeetingSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<MeetingRow>(
      meetingSelect(
        `NOT EXISTS (
           SELECT 1 FROM relationship r
           JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'meeting_of'
           WHERE r.tenant_id = $1 AND r.source_entity_id = e.id AND (r.valid_to IS NULL OR r.valid_to > now())
         )`,
      ),
      [ctx.tenantId],
    )
    return res.rows.map(mapMeeting)
  })
}
