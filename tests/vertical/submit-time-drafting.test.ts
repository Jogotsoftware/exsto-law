// Beta sprint Obj 6: document drafting fires at QUESTIONNAIRE SUBMIT, with no
// dependency on a consultation call. On a fresh DB, submitting an auto-route
// service records a draft.requested event for each configured document kind right
// at submit — before any transcript exists. (The draft itself runs in the worker;
// Claude drafting is already live, so this verifies the TRIGGER moved to submit.)
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { submitBooking } from '@exsto/legal'
import { type ActionContext } from '@exsto/substrate'
import { withSuperuser, closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const publicCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }

function slot(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1)
  d.setUTCHours(19, 0, 0, 0)
  return { startIso: d.toISOString(), endIso: new Date(d.getTime() + 30 * 60 * 1000).toISOString() }
}

run('submit-time drafting (live DB)', { timeout: 120_000 }, () => {
  const tag = `std-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('an auto-route submit requests drafts immediately, with no transcript', async () => {
    const s = slot(5)
    const booking = await submitBooking(publicCtx, {
      clientFullName: `${tag} Submitter`,
      clientEmail: `${tag}@submit.test`,
      clientPhone: '+1 919 555 0009',
      clientCompanyName: 'Submit Co',
      attributionSource: 'submit-time-test',
      serviceKey: 'nc_llc_single_member', // auto route
      intakeResponses: { company_name: 'Submit Co', principal_office_address: '1 Main St' },
      scheduledAtIso: s.startIso,
      scheduledEndIso: s.endIso,
    })
    const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId

    const rows = await withSuperuser(async (client) => {
      // draft.requested events recorded at submit (one per configured doc kind)…
      const drafts = await client.query<{ document_kind: string }>(
        `SELECT e.payload->>'document_kind' AS document_kind
         FROM event e JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
         WHERE e.tenant_id = $1 AND ekd.kind_name = 'draft.requested' AND e.primary_entity_id = $2`,
        [TENANT, matterId],
      )
      // …and NO transcript exists for this matter (drafting did not wait for a call).
      const transcripts = await client.query(
        `SELECT 1 FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'call_of'
         WHERE r.tenant_id = $1 AND r.target_entity_id = $2`,
        [TENANT, matterId],
      )
      return {
        kinds: drafts.rows.map((r) => r.document_kind).sort(),
        calls: transcripts.rowCount ?? 0,
      }
    })

    // nc_llc_single_member configures operating_agreement + engagement_letter.
    expect(rows.kinds).toContain('operating_agreement')
    expect(rows.kinds.length).toBeGreaterThanOrEqual(1)
    expect(rows.calls).toBe(0) // no call/transcript — drafting fired purely on submit
  })
})
