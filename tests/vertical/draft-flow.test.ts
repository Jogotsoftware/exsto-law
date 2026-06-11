// WP4 vertical acceptance: async drafting pipeline on a live DB. The model
// call itself is exercised via cacheDraft (same draft.generate action path,
// synthetic trace) — live Claude receipts require ANTHROPIC_API_KEY and are
// reported separately. Covers: trace linkage (invariant 20), enqueue path,
// manual-route refusal, review outcomes, edit-as-new-version (invariant 14).
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'

function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 700 + Math.floor(Math.random() * 200)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(16, Math.random() < 0.5 ? 0 : 30, 0, 0)
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800e3).toISOString() }
}

async function makeConsultedMatter(serviceKey: string): Promise<string> {
  const { submitBooking, loadCall } = await import('@exsto/legal')
  const slot = randomSlot()
  const booking = await submitBooking(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      clientFullName: 'WP4 Draft Client',
      clientEmail: `wp4-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'vertical-test',
      serviceKey,
      intakeResponses: { company_name: 'WP4 Draft LLC', company_purpose: 'drafting test' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    },
  )
  const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId
  await loadCall(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      matterEntityId: matterId,
      externalCallId: `wp4-call-${randomUUID().slice(0, 8)}`,
      startedAt: slot.startIso,
      endedAt: slot.endIso,
      transcriptText: 'Attorney and client confirmed the operating agreement terms.',
      transcriptSource: 'manual',
    },
  )
  return matterId
}

run('draft pipeline (live DB)', { timeout: 120_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('draft.generate persists trace-linked action, draft entity, version, event; review + edit chain works', async () => {
    const { cacheDraft, approveDraft } = await import('@exsto/legal')
    const matterId = await makeConsultedMatter('nc_llc_single_member')

    const result = await cacheDraft(
      { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
      {
        matterEntityId: matterId,
        documentKind: 'operating_agreement',
        documentMarkdown: '# Operating Agreement\n\nWP4 cached draft body.',
        prompt: 'WP4 test prompt',
        reasoningTrace: {
          evidence: [`entity:${matterId}`],
          alternatives_considered: ['member-managed vs manager-managed'],
          conclusion: 'Drafted per questionnaire + transcript.',
          confidence: 0.86,
          ambiguities: [],
        },
        modelIdentity: 'cached-demo-draft',
      },
    )
    const effects = result.effects[0] as { draftEntityId: string; documentVersionId: string }

    // Action ↔ trace linkage (exsto-ai-operation verify, invariant 20).
    const linked = await db.query<{ confidence: string; model_identity: string }>(
      `SELECT r.confidence, r.model_identity FROM action a
       JOIN reasoning_trace r ON r.id = a.reasoning_trace_id
       WHERE a.tenant_id=$1 AND a.id=$2`,
      [TENANT, result.actionId],
    )
    expect(linked.rowCount).toBe(1)
    expect(Number(linked.rows[0].confidence)).toBeLessThan(1.0)

    // draft_of relationship + draft.completed event + matter in_review.
    const rel = await db.query(
      `SELECT 1 FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id=r.relationship_kind_id
       WHERE r.tenant_id=$1 AND rkd.kind_name='draft_of'
         AND r.source_entity_id=$2 AND r.target_entity_id=$3`,
      [TENANT, effects.draftEntityId, matterId],
    )
    expect(rel.rowCount).toBe(1)
    const evt = await db.query(
      `SELECT 1 FROM event e JOIN event_kind_definition ekd ON ekd.id=e.event_kind_id
       WHERE e.tenant_id=$1 AND e.primary_entity_id=$2 AND ekd.kind_name='draft.completed'`,
      [TENANT, matterId],
    )
    expect(evt.rowCount).toBe(1)

    // Approve: version status, outcome row (positive), matter approved.
    await approveDraft(
      { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
      { documentVersionId: effects.documentVersionId, reviewNotes: 'looks right' },
    )
    const ver = await db.query<{ status: string }>(
      `SELECT status FROM document_version WHERE tenant_id=$1 AND id=$2`,
      [TENANT, effects.documentVersionId],
    )
    expect(ver.rows[0].status).toBe('approved')
    const outcome = await db.query<{ polarity: string }>(
      `SELECT o.polarity FROM outcome o
       JOIN outcome_kind_definition okd ON okd.id=o.outcome_kind_id
       WHERE o.tenant_id=$1 AND o.subject_entity_id=$2 AND okd.kind_name='draft_approved'`,
      [TENANT, effects.draftEntityId],
    )
    expect(outcome.rows[0]?.polarity).toBe('positive')

    // Inline edit on the approved draft → NEW version row, original intact.
    const { submitAction } = await import('@exsto/substrate')
    const edit = await submitAction(
      { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
      {
        actionKindName: 'document.edit',
        intentKind: 'correction',
        payload: {
          document_version_id: effects.documentVersionId,
          document_markdown: '# Operating Agreement\n\nWP4 edited body.',
          note: 'attorney inline edit',
        },
      },
    )
    const editEffects = edit.effects[0] as { documentVersionId: string; versionNumber: number }
    expect(editEffects.versionNumber).toBe(2)
    const versions = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM document_version
       WHERE tenant_id=$1 AND document_entity_id=$2`,
      [TENANT, effects.draftEntityId],
    )
    expect(Number(versions.rows[0].n)).toBe(2)
  })

  it('draft.generate without a reasoning trace is rejected (invariant 20)', async () => {
    const { submitAction } = await import('@exsto/substrate')
    const matterId = await makeConsultedMatter('nc_llc_single_member')
    await expect(
      submitAction(
        { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
        {
          actionKindName: 'draft.generate',
          intentKind: 'enforcement',
          payload: {
            matter_entity_id: matterId,
            document_kind: 'operating_agreement',
            document_markdown: 'no trace',
            model_identity: 'test',
            reasoning_trace_id: null,
            jurisdiction: 'NC',
          },
        },
      ),
    ).rejects.toThrow(/reasoning/i)
  })

  it('requestDraft enqueues the worker job + draft.requested; manual route refuses', async () => {
    const { requestDraft } = await import('@exsto/legal')
    const autoMatter = await makeConsultedMatter('nc_llc_single_member')
    const { jobId } = await requestDraft(
      { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
      { matterEntityId: autoMatter, documentKind: 'operating_agreement' },
    )
    const job = await db.query<{ job_kind: string; status: string }>(
      `SELECT job_kind, status FROM worker_job WHERE tenant_id=$1 AND id=$2`,
      [TENANT, jobId],
    )
    expect(job.rows[0].job_kind).toBe('legal.draft.run')
    const evt = await db.query(
      `SELECT 1 FROM event e JOIN event_kind_definition ekd ON ekd.id=e.event_kind_id
       WHERE e.tenant_id=$1 AND e.primary_entity_id=$2 AND ekd.kind_name='draft.requested'`,
      [TENANT, autoMatter],
    )
    expect(evt.rowCount).toBe(1)

    const manualMatter = await makeConsultedMatter('nc_llc_multi_member')
    await expect(
      requestDraft(
        { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
        { matterEntityId: manualMatter, documentKind: 'operating_agreement' },
      ),
    ).rejects.toThrow(/manual workflow/)
  })
})
