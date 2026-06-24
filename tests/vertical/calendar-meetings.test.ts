// Calendar events as meetings (beta sprint Obj 8). A Google event is captured as
// a calendar_event and linked to a matter via meeting_of; it surfaces on the
// matter and its contact alongside calls. Re-assigning re-routes (sealing the
// prior link); unassigning detaches. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  submitBooking,
  assignMeeting,
  unassignMeeting,
  listMeetingsForMatter,
  listMeetingsForContact,
  listUnassignedMeetings,
  createMeeting,
  rescheduleMeeting,
  cancelMeeting,
} from '@exsto/legal'
import { withSuperuser, closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const publicCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

function slot(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1)
  d.setUTCHours(19, 0, 0, 0)
  return { startIso: d.toISOString(), endIso: new Date(d.getTime() + 30 * 60 * 1000).toISOString() }
}

async function bookMatter(person: string, email: string, days: number): Promise<string> {
  const s = slot(days)
  const b = await submitBooking(publicCtx, {
    clientFullName: person,
    clientEmail: email,
    clientPhone: '+1 919 555 0005',
    clientCompanyName: 'Meeting Test Co',
    attributionSource: 'meeting-test',
    serviceKey: 'nc_llc_single_member',
    intakeResponses: { company_name: 'Meeting Test Co' },
    scheduledAtIso: s.startIso,
    scheduledEndIso: s.endIso,
  })
  return (b.effects[0] as { matterEntityId: string }).matterEntityId
}

async function contactFor(matterId: string): Promise<string> {
  return withSuperuser(async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT r.source_entity_id AS id FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'client_of' LIMIT 1`,
      [TENANT, matterId],
    )
    return r.rows[0]!.id
  })
}

run('Calendar meetings (live DB)', { timeout: 120_000 }, () => {
  const tag = `mtg-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('captures, surfaces on matter+contact, re-routes (seals prior), and unassigns', async () => {
    const m1 = await bookMatter(`${tag} Fay`, `${tag}-fay@mtg.test`, 4)
    const m2 = await bookMatter(`${tag} Gus`, `${tag}-gus@mtg.test`, 6)
    const c1 = await contactFor(m1)
    const c2 = await contactFor(m2)

    const ev = {
      googleEventId: `${tag}-evt`,
      summary: 'Strategy call re: formation',
      startedAt: new Date().toISOString(),
      endedAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      allDay: false,
      attendeeEmails: ['fay@mtg.test', 'jc@pacheco.law'],
      htmlLink: 'https://calendar.google.com/event?eid=abc',
      eventStatus: 'confirmed',
    }

    // Assign to m1 — captured + linked.
    const a1 = await assignMeeting(attorneyCtx, { ...ev, matterEntityId: m1 })
    expect(a1.captured).toBe(true)
    expect(a1.alreadyAssigned).toBe(false)
    const meetingId = a1.calendarEventEntityId!

    const onM1 = (await listMeetingsForMatter(attorneyCtx, m1)).find(
      (x) => x.calendarEventEntityId === meetingId,
    )
    expect(onM1?.title).toBe('Strategy call re: formation')
    expect(onM1?.attendeeEmails).toEqual(['fay@mtg.test', 'jc@pacheco.law'])
    expect(onM1?.htmlLink).toContain('calendar.google.com')
    expect(
      (await listMeetingsForContact(attorneyCtx, c1)).some(
        (x) => x.calendarEventEntityId === meetingId,
      ),
    ).toBe(true)

    // Re-assign to m2 — re-routes (NOT re-captured), prior link sealed.
    const a2 = await assignMeeting(attorneyCtx, { ...ev, matterEntityId: m2 })
    expect(a2.captured).toBe(false)
    expect(a2.alreadyAssigned).toBe(false)
    expect(a2.reassignedFrom).toBe(m1)

    expect(
      (await listMeetingsForMatter(attorneyCtx, m2)).some(
        (x) => x.calendarEventEntityId === meetingId,
      ),
    ).toBe(true)
    // Gone from m1 and c1 (prior meeting_of sealed); now on c2.
    expect(
      (await listMeetingsForMatter(attorneyCtx, m1)).some(
        (x) => x.calendarEventEntityId === meetingId,
      ),
    ).toBe(false)
    expect(
      (await listMeetingsForContact(attorneyCtx, c1)).some(
        (x) => x.calendarEventEntityId === meetingId,
      ),
    ).toBe(false)
    expect(
      (await listMeetingsForContact(attorneyCtx, c2)).some(
        (x) => x.calendarEventEntityId === meetingId,
      ),
    ).toBe(true)

    // Re-assigning to the same matter is idempotent.
    const a3 = await assignMeeting(attorneyCtx, { ...ev, matterEntityId: m2 })
    expect(a3.alreadyAssigned).toBe(true)

    // Unassign — leaves every timeline, lands in the unassigned set.
    await unassignMeeting(attorneyCtx, meetingId)
    expect(
      (await listMeetingsForMatter(attorneyCtx, m2)).some(
        (x) => x.calendarEventEntityId === meetingId,
      ),
    ).toBe(false)
    expect(
      (await listUnassignedMeetings(attorneyCtx)).some(
        (x) => x.calendarEventEntityId === meetingId,
      ),
    ).toBe(true)
  })

  // PR2: the attorney CREATES events (contact / personal) from the Calendar tab.
  // No Google creds in test, so the event is substrate-only (google_event_id null);
  // we assert the handler's writes directly.
  async function latestAttr(entityId: string, kind: string): Promise<string | null> {
    return withSuperuser(async (client) => {
      const r = await client.query<{ v: string }>(
        `SELECT a.value #>> '{}' AS v FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name = $3
         WHERE a.tenant_id = $1 AND a.entity_id = $2 AND a.valid_to IS NULL
         ORDER BY a.valid_from DESC LIMIT 1`,
        [TENANT, entityId, kind],
      )
      return r.rows[0]?.v ?? null
    })
  }
  async function openRelTarget(sourceId: string, kind: string): Promise<string | null> {
    return withSuperuser(async (client) => {
      const r = await client.query<{ t: string }>(
        `SELECT r.target_entity_id AS t FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = $3
         WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND r.valid_to IS NULL LIMIT 1`,
        [TENANT, sourceId, kind],
      )
      return r.rows[0]?.t ?? null
    })
  }

  it('creates a CONTACT meeting (meeting_with), reschedules, and cancels', async () => {
    const m = await bookMatter(`${tag} Hal`, `${tag}-hal@mtg.test`, 8)
    const c = await contactFor(m)
    const s = slot(9)

    const created = await createMeeting(attorneyCtx, {
      summary: 'Intro call',
      startIso: s.startIso,
      endIso: s.endIso,
      contactEntityId: c,
    })
    const ceId = created.calendarEventEntityId!
    expect(created.contactEntityId).toBe(c)
    // meeting_with link to the contact; human-sourced title.
    expect(await openRelTarget(ceId, 'meeting_with')).toBe(c)
    expect(await latestAttr(ceId, 'meeting_title')).toBe('Intro call')
    expect(await latestAttr(ceId, 'meeting_event_status')).toBe('confirmed')

    // Reschedule appends a new start time.
    const s2 = slot(11)
    await rescheduleMeeting(attorneyCtx, {
      calendarEventEntityId: ceId,
      googleEventId: null,
      startIso: s2.startIso,
      endIso: s2.endIso,
    })
    expect(new Date(await latestAttr(ceId, 'meeting_started_at')!).getTime()).toBe(
      new Date(s2.startIso).getTime(),
    )

    // Cancel marks it cancelled (append-only).
    await cancelMeeting(attorneyCtx, { calendarEventEntityId: ceId, googleEventId: null })
    expect(await latestAttr(ceId, 'meeting_event_status')).toBe('cancelled')
  })

  it('creates a PERSONAL block (no matter, no contact)', async () => {
    const s = slot(13)
    const created = await createMeeting(attorneyCtx, {
      summary: 'Focus block',
      startIso: s.startIso,
      endIso: s.endIso,
    })
    const ceId = created.calendarEventEntityId!
    expect(created.contactEntityId ?? null).toBeNull()
    expect(await openRelTarget(ceId, 'meeting_with')).toBeNull()
    expect(await openRelTarget(ceId, 'meeting_of')).toBeNull()
    expect(await latestAttr(ceId, 'meeting_title')).toBe('Focus block')
  })
})
