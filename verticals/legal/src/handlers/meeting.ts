import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, insertRelationship, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Calendar events as meetings (beta sprint Obj 8 — the meetings half). A
// calendar_event entity mirrors call_session; a meeting_of relationship mirrors
// call_of (calendar_event -> matter). legal.meeting.assign captures a Google
// event (idempotent on its id, like call.ingest) and links it to a matter;
// legal.meeting.unassign and re-routing SEAL the open meeting_of (relationship
// valid_to) — append-only, no state attribute.
//
// PROVENANCE SPLIT (Hard rule 4): the captured Google snapshot (title/times/
// attendees/…) is integration:'google:'+id (Google's observation). The attorney
// asserts only the LINK — the meeting_of relationship is written under the human
// action, so its provenance is the attorney via the action's actor.
// ───────────────────────────────────────────────────────────────────────────

const CALENDAR_EVENT_KIND = 'calendar_event'

interface MeetingAssignPayload {
  google_event_id: string
  matter_entity_id: string
  summary: string
  started_at: string | null
  ended_at: string | null
  all_day: boolean
  attendee_emails: string[]
  html_link: string | null
  event_status: string
}

async function requireActiveEntity(
  client: DbClient,
  tenantId: string,
  entityId: string,
  kindName: string,
): Promise<void> {
  const res = await client.query<{ id: string }>(
    `SELECT e.id FROM entity e
     JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = $3
     WHERE e.tenant_id = $1 AND e.id = $2 AND e.status = 'active'`,
    [tenantId, entityId, kindName],
  )
  if (!res.rows[0]) throw new Error(`${kindName} not found: ${entityId}`)
}

// True if this Google event id was ever an app-booked consultation. Checks the
// APPEND-ONLY google_event_id attribute (written at booking, survives a cancel),
// NOT matter.metadata — booking.cancel strips the id from metadata, so a cancelled
// consultation would otherwise slip past this guard and double-count.
async function isAppBookedEvent(
  client: DbClient,
  tenantId: string,
  googleEventId: string,
): Promise<boolean> {
  const res = await client.query<{ one: number }>(
    `SELECT 1 AS one FROM attribute a
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name = 'google_event_id'
     WHERE a.tenant_id = $1 AND a.value #>> '{}' = $2 LIMIT 1`,
    [tenantId, googleEventId],
  )
  return Boolean(res.rows[0])
}

// The calendar_event entity for a Google event id, if already captured (idempotency
// key, mirroring findCallByGranolaId).
async function findCalendarEventByGoogleId(
  client: DbClient,
  tenantId: string,
  googleEventId: string,
): Promise<string | null> {
  const res = await client.query<{ entity_id: string }>(
    `SELECT a.entity_id FROM attribute a
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name = 'meeting_google_event_id'
     WHERE a.tenant_id = $1 AND a.value #>> '{}' = $2 LIMIT 1`,
    [tenantId, googleEventId],
  )
  return res.rows[0]?.entity_id ?? null
}

// The open (unsealed) meeting_of for a calendar_event: its relationship row id +
// the matter it targets. Re-route/unassign seal this row (valid_to).
async function openMeetingOf(
  client: DbClient,
  tenantId: string,
  calendarEventId: string,
): Promise<{ relationshipId: string; targetEntityId: string } | null> {
  const res = await client.query<{ id: string; target_entity_id: string }>(
    `SELECT r.id, r.target_entity_id FROM relationship r
     JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'meeting_of'
     WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND r.valid_to IS NULL
     ORDER BY r.recorded_at DESC LIMIT 1`,
    [tenantId, calendarEventId],
  )
  const row = res.rows[0]
  return row ? { relationshipId: row.id, targetEntityId: row.target_entity_id } : null
}

// Seal a relationship (set valid_to) — the bitemporal close the foundation's
// relationship.close performs, done in-handler so assign is one atomic action
// (mirrors how serviceLibrary.upsert seals the prior workflow_definition row).
async function sealRelationship(
  client: DbClient,
  tenantId: string,
  relationshipId: string,
): Promise<void> {
  await client.query(
    `UPDATE relationship SET valid_to = now()
     WHERE tenant_id = $1 AND id = $2 AND valid_to IS NULL`,
    [tenantId, relationshipId],
  )
}

registerActionHandler('legal.meeting.assign', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as MeetingAssignPayload
  if (!p.google_event_id) throw new Error('google_event_id is required.')
  await requireActiveEntity(client, ctx.tenantId, p.matter_entity_id, 'matter')

  // Guard: a consultation already surfaces via the booking path; capturing it
  // again would double-count. Keyed on the append-only google_event_id attribute.
  if (await isAppBookedEvent(client, ctx.tenantId, p.google_event_id)) {
    return { skipped: true, reason: 'managed_by_app', googleEventId: p.google_event_id }
  }

  // Capture-or-reuse the calendar_event (one per Google id). Snapshot fields carry
  // INTEGRATION provenance (Google observed them, not the attorney).
  const sourceRef = `google:${p.google_event_id}`
  let calendarEventId = await findCalendarEventByGoogleId(client, ctx.tenantId, p.google_event_id)
  let captured = false
  if (!calendarEventId) {
    captured = true
    const kindId = await lookupKindId(
      client,
      'entity_kind_definition',
      ctx.tenantId,
      CALENDAR_EVENT_KIND,
    )
    calendarEventId = await insertEntity(
      client,
      ctx.tenantId,
      actionId,
      kindId,
      `Meeting ${p.summary || p.google_event_id}`,
      { google_event_id: p.google_event_id, captured_from: 'google' },
    )

    const precision = p.all_day ? 'day' : 'minute'
    const snapshot: Array<{ kind: string; value: unknown; precision?: string; know?: string }> = [
      { kind: 'meeting_google_event_id', value: p.google_event_id },
      { kind: 'meeting_title', value: p.summary || '(no title)' },
      { kind: 'meeting_all_day', value: Boolean(p.all_day) },
      { kind: 'meeting_event_status', value: p.event_status || 'confirmed' },
      {
        kind: 'meeting_attendee_emails',
        value: p.attendee_emails ?? [],
        know: (p.attendee_emails?.length ?? 0) > 0 ? 'observed' : 'observed_null',
      },
    ]
    if (p.started_at) snapshot.push({ kind: 'meeting_started_at', value: p.started_at, precision })
    if (p.ended_at) snapshot.push({ kind: 'meeting_ended_at', value: p.ended_at, precision })
    if (p.html_link) snapshot.push({ kind: 'meeting_html_link', value: p.html_link })

    for (const a of snapshot) {
      const akId = await lookupKindId(client, 'attribute_kind_definition', ctx.tenantId, a.kind)
      await insertAttribute(client, {
        tenantId: ctx.tenantId,
        actionId,
        entityId: calendarEventId,
        attributeKindId: akId,
        value: a.value,
        confidence: 1.0,
        knowabilityState: a.know ?? 'observed',
        timePrecision: a.precision ?? 'exact_instant',
        sourceType: 'integration',
        sourceRef,
      })
    }
  }

  // Link to the matter. Re-route seals the prior open meeting_of (append-only),
  // so only one open row ever exists and the reads stay verbatim call_of clones.
  const open = await openMeetingOf(client, ctx.tenantId, calendarEventId)
  if (open && open.targetEntityId === p.matter_entity_id) {
    return {
      calendarEventEntityId: calendarEventId,
      matterEntityId: p.matter_entity_id,
      captured,
      alreadyAssigned: true,
    }
  }
  if (open) await sealRelationship(client, ctx.tenantId, open.relationshipId)

  const meetingOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'meeting_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: calendarEventId,
    targetEntityId: p.matter_entity_id,
    relationshipKindId: meetingOfId,
  })

  // Linking only — matter_status is left untouched (same rule as legal.call.assign).
  return {
    calendarEventEntityId: calendarEventId,
    matterEntityId: p.matter_entity_id,
    captured,
    reassignedFrom: open ? open.targetEntityId : null,
    alreadyAssigned: false,
  }
})

interface MeetingUnassignPayload {
  calendar_event_entity_id: string
}

registerActionHandler('legal.meeting.unassign', async (ctx, client, payload) => {
  const p = payload as unknown as MeetingUnassignPayload
  if (!p.calendar_event_entity_id) throw new Error('calendar_event_entity_id is required.')
  await requireActiveEntity(client, ctx.tenantId, p.calendar_event_entity_id, 'calendar_event')

  const open = await openMeetingOf(client, ctx.tenantId, p.calendar_event_entity_id)
  if (!open) {
    return { calendarEventEntityId: p.calendar_event_entity_id, unassigned: false }
  }
  await sealRelationship(client, ctx.tenantId, open.relationshipId)
  return {
    calendarEventEntityId: p.calendar_event_entity_id,
    priorMatter: open.targetEntityId,
    unassigned: true,
  }
})
