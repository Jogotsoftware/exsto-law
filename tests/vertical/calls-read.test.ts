// Calls read layer (beta sprint Obj 8). On a fresh DB, after booking a matter and
// ingesting a call against it (with a Granola summary) plus an unmatched call,
// listCallsForMatter / listCallsForContact surface the matched call with its
// summary + transcript, and listUnmatchedCalls surfaces the orphan. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  submitBooking,
  listCallsForMatter,
  listCallsForContact,
  listUnmatchedCalls,
} from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { withSuperuser, closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const SYSTEM = '00000000-0000-0000-0001-000000000001'
const publicCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }
const systemCtx: ActionContext = { tenantId: TENANT, actorId: SYSTEM }

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
    clientPhone: '+1 919 555 0002',
    clientCompanyName: 'Calls Test Co',
    attributionSource: 'calls-read-test',
    serviceKey: 'nc_llc_single_member',
    intakeResponses: { company_name: 'Calls Test Co' },
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

async function ingestCall(
  granolaId: string,
  matterId: string | null,
  summary: Record<string, unknown> | null,
): Promise<string> {
  const res = await submitAction(systemCtx, {
    actionKindName: 'call.ingest',
    intentKind: 'automatic_sync',
    payload: {
      granola_call_id: granolaId,
      matter_entity_id: matterId,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: 1800,
      transcript_text: 'Attorney and client discussed the operating agreement at length.',
      transcript_source: 'manual',
      notes: summary,
      attendee_emails: [],
    },
  })
  return (res.effects[0] as { callEntityId: string }).callEntityId
}

run('Calls read layer (live DB)', { timeout: 120_000 }, () => {
  const tag = `clr-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('matter, contact and unmatched-queue reads surface calls with summary + transcript', async () => {
    const matterId = await bookMatter(`${tag} Cara`, `${tag}-cara@calls.test`, 4)
    const contactId = await contactFor(matterId)

    const summary = { headline: 'Consult complete', action_items: ['Send engagement letter'] }
    const matchedCallId = await ingestCall(`${tag}-matched`, matterId, summary)
    const unmatchedCallId = await ingestCall(`${tag}-orphan`, null, null)

    // Matter read: the matched call, with its Granola summary + transcript.
    const matterCalls = await listCallsForMatter(systemCtx, matterId)
    const onMatter = matterCalls.find((c) => c.callEntityId === matchedCallId)
    expect(onMatter).toBeTruthy()
    expect(onMatter?.granolaCallId).toBe(`${tag}-matched`)
    expect(onMatter?.durationSeconds).toBe(1800)
    expect(onMatter?.summary).toMatchObject({ headline: 'Consult complete' })
    expect(onMatter?.transcriptText).toContain('operating agreement')
    expect(onMatter?.matterEntityId).toBe(matterId)

    // Contact read: same call shows up across the contact's matters.
    const contactCalls = await listCallsForContact(systemCtx, contactId)
    expect(contactCalls.some((c) => c.callEntityId === matchedCallId)).toBe(true)

    // Review queue: the orphan call, and NOT the matched one.
    const unmatched = await listUnmatchedCalls(systemCtx)
    expect(unmatched.some((c) => c.callEntityId === unmatchedCallId)).toBe(true)
    expect(unmatched.some((c) => c.callEntityId === matchedCallId)).toBe(false)
  })
})
