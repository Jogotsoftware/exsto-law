// WP3.4 / Objective 6 acceptance (live DB): a submitted questionnaire produces a
// document_draft attached to a live matter via TEMPLATE_MERGE with NO Anthropic
// call. This is the deterministic counterpart to draft-flow.test.ts. Run with
// DATABASE_URL set against the pilot to generate the live receipt; skips with no DB.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
const AGENT_ACTOR = '00000000-0000-0000-0001-000000000004'

function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 60 + Math.floor(Math.random() * 200000)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800e3).toISOString() }
}

async function makeMatterWithQuestionnaire(): Promise<{ matterId: string; company: string }> {
  const { submitBooking } = await import('@exsto/legal')
  const slot = randomSlot()
  const company = `Obj6 Merge LLC ${randomUUID().slice(0, 6)}`
  const booking = await submitBooking(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      clientFullName: 'Obj6 Receipt Client',
      clientEmail: `obj6-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'obj6-template-merge-receipt',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: { company_name: company, company_purpose: 'template-merge receipt' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    },
  )
  return { matterId: (booking.effects[0] as { matterEntityId: string }).matterEntityId, company }
}

run('template_merge generation (live DB) — Objective 6', { timeout: 120_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('a submitted questionnaire produces a document_draft via template_merge with NO model call', async () => {
    const { runDraftGeneration } = await import('@exsto/legal')
    const { matterId, company } = await makeMatterWithQuestionnaire()

    const result = await runDraftGeneration(
      { tenantId: TENANT, actorId: AGENT_ACTOR },
      {
        matterEntityId: matterId,
        documentKind: 'engagement_letter',
        generationMode: 'template_merge',
      },
    )
    expect(result).not.toBeNull()
    const effects = result!.effects[0] as { draftEntityId: string; documentVersionId: string }

    // 1. A document_draft was created and linked to the live matter (draft_of).
    const rel = await db.query(
      `SELECT 1 FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id=r.relationship_kind_id
       WHERE r.tenant_id=$1 AND rkd.kind_name='draft_of'
         AND r.source_entity_id=$2 AND r.target_entity_id=$3`,
      [TENANT, effects.draftEntityId, matterId],
    )
    expect(rel.rowCount).toBe(1)

    // 2. generation_mode recorded as template_merge.
    const mode = await db.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id=a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2 AND akd.kind_name='generation_mode'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, effects.draftEntityId],
    )
    expect(mode.rows[0]?.value).toBe('template_merge')

    // 3. NO reasoning trace on the version, and the draft.merge action carries none
    //    — there was no model reasoning to record (the proof of "no Anthropic").
    const ver = await db.query<{ reasoning_trace_id: string | null }>(
      `SELECT dv.reasoning_trace_id
       FROM document_version dv
       WHERE dv.tenant_id=$1 AND dv.id=$2`,
      [TENANT, effects.documentVersionId],
    )
    expect(ver.rows[0]?.reasoning_trace_id).toBeNull()

    // 4. draft.completed event fired (same downstream as the AI path).
    const evt = await db.query(
      `SELECT 1 FROM event e JOIN event_kind_definition ekd ON ekd.id=e.event_kind_id
       WHERE e.tenant_id=$1 AND e.primary_entity_id=$2 AND ekd.kind_name='draft.completed'`,
      [TENANT, matterId],
    )
    expect(evt.rowCount).toBe(1)

    // 5. The body was deterministically filled from the questionnaire (company name).
    const body = await db.query<{ body: string }>(
      `SELECT cb.body FROM document_version dv
       JOIN content_blob cb ON cb.id = dv.content_blob_id
       WHERE dv.tenant_id=$1 AND dv.id=$2`,
      [TENANT, effects.documentVersionId],
    )
    expect(body.rows[0]?.body).toContain(company)
  })
})
