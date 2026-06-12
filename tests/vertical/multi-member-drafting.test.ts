// Multi-member auto-drafting acceptance (migration 0013). Verifies the
// multi-member NC LLC service is at parity with single-member: route='auto',
// on_transcript='draft.generate', documents=['operating_agreement'], a config
// drafting prompt with all required slots, and that the service passes the
// Service Library completeness gate. Also verifies the multi-member document-BODY
// template resolves with multi-member-specific markers and that
// assembleDraftingPrompt fills every slot for the multi-member service — without a
// live Claude key (mirrors how draft-flow.test.ts exercises the no-live-key path).
// Regression guards: single-member drafting is UNCHANGED; 'something_else' stays
// manual.
//
// DB-gated like tests/invariants: the pure sections always run; the live-DB
// sections skip (not fail) when no DB URL is wired.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'

const REQUIRED_SLOTS = [
  '{{questionnaire_responses_json}}',
  '{{transcript_text}}',
  '{{operating_agreement_template}}',
]

// ── Pure coverage (no DB) ───────────────────────────────────────────────────
// The body-template resolver and prompt assembly are synchronous and key off the
// service kind only, so they are testable without a database. Generous timeout:
// the first dynamic import('@exsto/legal') cold-loads the whole package.
describe('multi-member body + prompt assembly (pure)', { timeout: 90_000 }, () => {
  it('resolves the MULTI-MEMBER operating-agreement body for the multi-member service', async () => {
    const { resolveOperatingAgreementTemplate, loadOperatingAgreementTemplate } =
      await import('@exsto/legal')
    const multi = resolveOperatingAgreementTemplate('nc_llc_multi_member')
    expect(multi.trim().length).toBeGreaterThan(0)
    // Multi-member-specific markers absent from / distinct in the single-member body.
    expect(multi).toContain('Multi-Member')
    expect(multi).toContain('Ownership Percentages')
    expect(multi).toContain('Right of First Refusal')
    expect(multi).toContain('Capital Accounts')
    expect(multi).toContain('Deadlock')
    // The body keeps the FIXED mustache slot contract the prompt fills.
    expect(multi).toContain('{{company_name}}')
    expect(multi).toContain('{{members_schedule_table}}')

    // It is genuinely a DIFFERENT body than single-member (not a fallback).
    const single = loadOperatingAgreementTemplate()
    expect(multi).not.toBe(single)
  })

  it('single-member / unknown services keep the single-member body (no break)', async () => {
    const { resolveOperatingAgreementTemplate, loadOperatingAgreementTemplate } =
      await import('@exsto/legal')
    const single = loadOperatingAgreementTemplate()
    expect(resolveOperatingAgreementTemplate('nc_llc_single_member')).toBe(single)
    expect(resolveOperatingAgreementTemplate('something_else')).toBe(single)
    expect(resolveOperatingAgreementTemplate(null)).toBe(single)
    expect(resolveOperatingAgreementTemplate(undefined)).toBe(single)
  })

  it('assembleDraftingPrompt fills every slot for the multi-member service', async () => {
    const { assembleDraftingPrompt, resolveOperatingAgreementTemplate } =
      await import('@exsto/legal')
    const basePrompt = [
      'Draft a multi-member NC LLC operating agreement.',
      '## Questionnaire',
      '{{questionnaire_responses_json}}',
      '## Transcript',
      '{{transcript_text}}',
      '## Template',
      '{{operating_agreement_template}}',
    ].join('\n')

    const prompt = assembleDraftingPrompt({
      basePrompt,
      template: resolveOperatingAgreementTemplate('nc_llc_multi_member'),
      questionnaireResponses: { company_name: 'Acme Partners', member_count: '2' },
      transcriptText: 'Members agreed on a 60/40 ownership split, member-managed.',
      documentKind: 'operating_agreement',
    })

    // No slot left unfilled.
    for (const slot of REQUIRED_SLOTS) {
      expect(prompt).not.toContain(slot)
    }
    // The inputs landed in the assembled prompt.
    expect(prompt).toContain('Acme Partners')
    expect(prompt).toContain('60/40 ownership split')
    // The multi-member body was embedded (multi-member marker present).
    expect(prompt).toContain('Right of First Refusal')
  })

  it('the completeness gate passes for an auto multi-member transitions shape', async () => {
    const { completenessFromTransitions } = await import('@exsto/legal')
    const multiMemberPrompt = REQUIRED_SLOTS.join('\n')
    const result = completenessFromTransitions('nc_llc_multi_member', {
      route: 'auto',
      documents: ['operating_agreement'],
      intake_schema: {
        sections: [
          {
            id: 'company',
            title: 'About',
            fields: [{ id: 'company_name', label: 'Name', type: 'text' }],
          },
        ],
      },
      drafting: { prompt_version: 1, prompts: { operating_agreement: multiMemberPrompt } },
    })
    expect(result.ready).toBe(true)
    expect(result.missing).toEqual([])
  })
})

// ── Live-DB coverage ────────────────────────────────────────────────────────
run('multi-member auto-drafting (live DB)', { timeout: 120_000 }, () => {
  const ctx = { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR }
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('multi-member service is route=auto + on_transcript=draft.generate after 0013', async () => {
    const t = await db.query<{ route: string; on_transcript: string; documents: string }>(
      `SELECT transitions->>'route' AS route,
              transitions->>'on_transcript' AS on_transcript,
              transitions->'documents' AS documents
         FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = 'nc_llc_multi_member' AND valid_to IS NULL`,
      [TENANT],
    )
    expect(t.rows[0]?.route).toBe('auto')
    expect(t.rows[0]?.on_transcript).toBe('draft.generate')
    expect(t.rows[0]?.documents).toEqual(['operating_agreement'])

    // And it surfaces as auto through the public service API.
    const { getService } = await import('@exsto/legal')
    const svc = await getService(ctx, 'nc_llc_multi_member')
    expect(svc?.route).toBe('auto')
    expect(svc?.documents).toEqual(['operating_agreement'])
  })

  it('multi-member service passes the Service Library completeness gate', async () => {
    const { serviceCompleteness } = await import('@exsto/legal')
    const result = await serviceCompleteness(ctx, 'nc_llc_multi_member')
    expect(result.missing).toEqual([])
    expect(result.ready).toBe(true)
  })

  it('multi-member config drafting prompt resolves with all required slots', async () => {
    const { getDraftingPrompt } = await import('@exsto/legal')
    const doc = await getDraftingPrompt(ctx, 'nc_llc_multi_member', 'operating_agreement')
    expect(doc?.source).toBe('config')
    expect(doc?.promptText).toBeTruthy()
    for (const slot of REQUIRED_SLOTS) {
      expect(doc!.promptText).toContain(slot)
    }
    // Multi-member-specific prompt (not the single-member one).
    expect(doc!.promptText).toContain('MULTI-MEMBER')
  })

  it('requestDraft now ACCEPTS a multi-member matter (was refused as manual before)', async () => {
    const { submitBooking, loadCall, requestDraft } = await import('@exsto/legal')
    const daysAhead = 60 + Math.floor(Math.random() * 200000)
    const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
    start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
    const startIso = start.toISOString()
    const endIso = new Date(start.getTime() + 1800e3).toISOString()

    const booking = await submitBooking(ctx, {
      clientFullName: 'Multi Member Client',
      clientEmail: `mm-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_multi_member',
      intakeResponses: { company_name: 'MM Draft LLC', member_count: '2' },
      scheduledAtIso: startIso,
      scheduledEndIso: endIso,
    })
    const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId
    await loadCall(ctx, {
      matterEntityId: matterId,
      externalCallId: `mm-call-${randomUUID().slice(0, 8)}`,
      startedAt: startIso,
      endedAt: endIso,
      transcriptText: 'Two members confirmed a 50/50 split and member-managed structure.',
      transcriptSource: 'manual',
    })

    const { jobId } = await requestDraft(ctx, {
      matterEntityId: matterId,
      documentKind: 'operating_agreement',
    })
    const job = await db.query<{ job_kind: string }>(
      `SELECT job_kind FROM worker_job WHERE tenant_id=$1 AND id=$2`,
      [TENANT, jobId],
    )
    expect(job.rows[0]?.job_kind).toBe('legal.draft.run')
  })

  it("'something else' STAYS manual (regression guard)", async () => {
    const t = await db.query<{ route: string }>(
      `SELECT transitions->>'route' AS route FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = 'something_else' AND valid_to IS NULL`,
      [TENANT],
    )
    expect(t.rows[0]?.route).toBe('manual')
  })

  it('single-member service is UNCHANGED (regression guard)', async () => {
    const t = await db.query<{ route: string; on_transcript: string; documents: string }>(
      `SELECT transitions->>'route' AS route,
              transitions->>'on_transcript' AS on_transcript,
              transitions->'documents' AS documents
         FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = 'nc_llc_single_member' AND valid_to IS NULL`,
      [TENANT],
    )
    expect(t.rows[0]?.route).toBe('auto')
    expect(t.rows[0]?.on_transcript).toBe('draft.generate')
    expect(t.rows[0]?.documents).toEqual(['operating_agreement', 'engagement_letter'])
  })
})
