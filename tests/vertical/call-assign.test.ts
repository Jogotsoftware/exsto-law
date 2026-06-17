// Assign a call to a matter (beta sprint Obj 8). An unmatched call sits in the
// review queue (listUnmatchedCalls); legal.call.assign routes it to a matter, so
// it then appears on that matter (listCallsForMatter) and leaves the queue. The
// link carries human provenance. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { submitBooking, listUnmatchedCalls, listCallsForMatter } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const SYSTEM = '00000000-0000-0000-0001-000000000001'
const publicCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
const systemCtx: ActionContext = { tenantId: TENANT, actorId: SYSTEM }

function slot(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1)
  d.setUTCHours(19, 0, 0, 0)
  return { startIso: d.toISOString(), endIso: new Date(d.getTime() + 30 * 60 * 1000).toISOString() }
}

run('Assign call to matter (live DB)', { timeout: 120_000 }, () => {
  const tag = `cas-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('routes an unmatched call onto a matter and out of the review queue', async () => {
    const s = slot(4)
    const booking = await submitBooking(publicCtx, {
      clientFullName: `${tag} Eli`,
      clientEmail: `${tag}-eli@assign.test`,
      clientPhone: '+1 919 555 0004',
      clientCompanyName: 'Assign Test Co',
      attributionSource: 'call-assign-test',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: { company_name: 'Assign Test Co' },
      scheduledAtIso: s.startIso,
      scheduledEndIso: s.endIso,
    })
    const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId

    // Ingest an UNMATCHED call (no matter) — lands in the review queue.
    const ingest = await submitAction(systemCtx, {
      actionKindName: 'call.ingest',
      intentKind: 'automatic_sync',
      payload: {
        granola_call_id: `${tag}-orphan`,
        matter_entity_id: null,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: 1200,
        transcript_text: 'Prospective client call, matter not yet identified.',
        transcript_source: 'manual',
        notes: null,
        attendee_emails: [],
      },
    })
    const callId = (ingest.effects[0] as { callEntityId: string }).callEntityId

    expect((await listUnmatchedCalls(attorneyCtx)).some((c) => c.callEntityId === callId)).toBe(
      true,
    )

    // Assign it.
    const assigned = await submitAction(attorneyCtx, {
      actionKindName: 'legal.call.assign',
      intentKind: 'adjustment',
      payload: { call_entity_id: callId, matter_entity_id: matterId },
    })
    expect((assigned.effects[0] as { alreadyAssigned: boolean }).alreadyAssigned).toBe(false)

    // Now on the matter, gone from the queue.
    expect(
      (await listCallsForMatter(attorneyCtx, matterId)).some((c) => c.callEntityId === callId),
    ).toBe(true)
    expect((await listUnmatchedCalls(attorneyCtx)).some((c) => c.callEntityId === callId)).toBe(
      false,
    )

    // Re-assigning is idempotent (no double link).
    const again = await submitAction(attorneyCtx, {
      actionKindName: 'legal.call.assign',
      intentKind: 'adjustment',
      payload: { call_entity_id: callId, matter_entity_id: matterId },
    })
    expect((again.effects[0] as { alreadyAssigned: boolean }).alreadyAssigned).toBe(true)
  })
})
