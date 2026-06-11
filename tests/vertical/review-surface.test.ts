// WP5 vertical acceptance: the attorney review surface's read paths on a live
// DB — pending-draft queue, draft detail with trace, matter action history.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'

function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 1000 + Math.floor(Math.random() * 200)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(17, Math.random() < 0.5 ? 0 : 30, 0, 0)
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800e3).toISOString() }
}

run('review surface (live DB)', { timeout: 120_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('pending queue lists the draft; detail carries trace; history shows the audited chain', async () => {
    const {
      submitBooking,
      loadCall,
      cacheDraft,
      listPendingDraftVersions,
      getDraftVersion,
      getMatterHistory,
    } = await import('@exsto/legal')
    const ctxPublic = { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR }
    const ctxAttorney = { tenantId: TENANT, actorId: ATTORNEY_ACTOR }
    const slot = randomSlot()

    const booking = await submitBooking(ctxPublic, {
      clientFullName: 'WP5 Review Client',
      clientEmail: `wp5-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: { company_name: 'WP5 Review LLC' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    })
    const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId

    await loadCall(ctxPublic, {
      matterEntityId: matterId,
      externalCallId: `wp5-call-${randomUUID().slice(0, 8)}`,
      startedAt: slot.startIso,
      endedAt: slot.endIso,
      transcriptText: 'WP5 transcript content.',
      transcriptSource: 'manual',
    })

    const draft = await cacheDraft(ctxAttorney, {
      matterEntityId: matterId,
      documentKind: 'operating_agreement',
      documentMarkdown: '# OA\n\nWP5 review body.',
      prompt: 'WP5 prompt',
      reasoningTrace: {
        evidence: [`entity:${matterId}`],
        alternatives_considered: [],
        conclusion: 'WP5 conclusion',
        confidence: 0.8,
        ambiguities: ['none'],
      },
      modelIdentity: 'cached-demo-draft',
    })
    const draftEffects = draft.effects[0] as { documentVersionId: string }

    // Pending review queue includes it with the matter reference.
    const pending = await listPendingDraftVersions(ctxAttorney)
    const mine = pending.find((p) => p.documentVersionId === draftEffects.documentVersionId)
    expect(mine).toBeTruthy()
    expect(mine!.matterEntityId).toBe(matterId)
    expect(mine!.documentKind).toBe('operating_agreement')

    // Draft detail carries body + trace + confidence for the review screen.
    const detail = await getDraftVersion(ctxAttorney, draftEffects.documentVersionId)
    expect(detail!.bodyMarkdown).toContain('WP5 review body')
    expect(detail!.confidence).toBeCloseTo(0.8, 5)
    expect(detail!.conclusion).toBe('WP5 conclusion')
    expect(detail!.reasoningTrace).toBeTruthy()

    // Action history: the full audited chain in order, with the AI action
    // trace-flagged.
    const history = await getMatterHistory(ctxAttorney, matterId)
    const kinds = history.actions.map((a) => a.kindName)
    expect(kinds).toEqual(
      expect.arrayContaining([
        'intake.submit',
        'matter.open',
        'booking.create',
        'call.ingest',
        'draft.generate',
      ]),
    )
    const draftAction = history.actions.find((a) => a.kindName === 'draft.generate')
    expect(draftAction!.hasReasoningTrace).toBe(true)
    expect(history.events.map((e) => e.kindName)).toEqual(
      expect.arrayContaining([
        'matter.opened',
        'consultation.booked',
        'transcript.received',
        'draft.completed',
      ]),
    )
  })
})
