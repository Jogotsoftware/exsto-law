// Meeting reconciliation (beta sprint Obj 8 follow-up). When a captured meeting's
// Google event changes, legal.meeting.reconcile APPENDS corrections: a changed
// field becomes a new value row, an unchanged pass appends nothing, and a deleted
// event becomes status='cancelled'. Tests the handler diff directly (the Google
// re-read is the worker's job). DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { submitBooking, assignMeeting, listMeetingsForMatter } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'

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
    clientPhone: '+1 919 555 0006',
    clientCompanyName: 'Reconcile Co',
    attributionSource: 'reconcile-test',
    serviceKey: 'nc_llc_single_member',
    intakeResponses: { company_name: 'Reconcile Co' },
    scheduledAtIso: s.startIso,
    scheduledEndIso: s.endIso,
  })
  return (b.effects[0] as { matterEntityId: string }).matterEntityId
}

run('Meeting reconcile (live DB)', { timeout: 120_000 }, () => {
  const tag = `rec-${Date.now()}`
  afterAll(async () => {
    await closeDbPool()
  })

  function reconcile(payload: Record<string, unknown>) {
    return submitAction(attorneyCtx, {
      actionKindName: 'legal.meeting.reconcile',
      intentKind: 'automatic_sync',
      payload,
    })
  }

  it('appends only changed fields, no-ops when unchanged, and marks deletion', async () => {
    const matterId = await bookMatter(`${tag} Hank`, `${tag}-hank@rec.test`, 4)
    const gid = `${tag}-evt`
    const base = {
      googleEventId: gid,
      summary: 'Original title',
      startedAt: '2026-07-01T15:00:00.000Z',
      endedAt: '2026-07-01T15:30:00.000Z',
      allDay: false,
      attendeeEmails: ['hank@rec.test'],
      htmlLink: 'https://calendar.google.com/event?eid=rec',
      eventStatus: 'confirmed',
    }
    const a = await assignMeeting(attorneyCtx, { ...base, matterEntityId: matterId })
    const id = a.calendarEventEntityId!

    const fields = {
      calendar_event_entity_id: id,
      google_event_id: gid,
      summary: base.summary,
      started_at: base.startedAt,
      ended_at: base.endedAt,
      all_day: base.allDay,
      attendee_emails: base.attendeeEmails,
      html_link: base.htmlLink,
      event_status: base.eventStatus,
    }

    // 1. RENAME + reschedule: only those two fields append.
    const r1 = await reconcile({
      ...fields,
      summary: 'Renamed (rescheduled)',
      started_at: '2026-07-01T16:00:00.000Z',
    })
    const changed1 = (r1.effects[0] as { changed: string[] }).changed
    expect(changed1.sort()).toEqual(['meeting_started_at', 'meeting_title'])
    const m1 = (await listMeetingsForMatter(attorneyCtx, matterId)).find(
      (x) => x.calendarEventEntityId === id,
    )
    expect(m1?.title).toBe('Renamed (rescheduled)')
    expect(new Date(m1!.startIso!).getTime()).toBe(new Date('2026-07-01T16:00:00.000Z').getTime())

    // 2. Same values again → no-op (nothing appended). Time format differs but
    //    same instant, so it must NOT count as a change.
    const r2 = await reconcile({
      ...fields,
      summary: 'Renamed (rescheduled)',
      started_at: '2026-07-01T16:00:00Z',
    })
    expect((r2.effects[0] as { changed: string[] }).changed).toEqual([])

    // 3. Deleted in Google → status cancelled.
    const r3 = await reconcile({
      calendar_event_entity_id: id,
      google_event_id: gid,
      deleted: true,
    })
    expect((r3.effects[0] as { changed: string[] }).changed).toEqual(['meeting_event_status'])
    const m3 = (await listMeetingsForMatter(attorneyCtx, matterId)).find(
      (x) => x.calendarEventEntityId === id,
    )
    expect(m3?.eventStatus).toBe('cancelled')

    // 4. Deleting again → idempotent no-op.
    const r4 = await reconcile({
      calendar_event_entity_id: id,
      google_event_id: gid,
      deleted: true,
    })
    expect((r4.effects[0] as { changed: string[] }).changed).toEqual([])
  })
})
