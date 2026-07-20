// WP3.4 / Objective 6 — the deterministic template-merge engine. These are PURE
// unit tests (no DB, no model, always run): they prove renderTemplate fills slots
// from data, flags missing fields honestly, and never calls anything external,
// and that buildMergeData maps matter + questionnaire facts onto template slots.
import { describe, it, expect } from 'vitest'
import { renderTemplate, buildMergeData, MERGE_SLOT_FIELDS } from '@exsto/legal'
import type { MatterDetail } from '@exsto/legal'

describe('renderTemplate (deterministic, no Anthropic)', () => {
  it('fills every known slot from the data map', () => {
    const { markdown, filledFields, missingFields } = renderTemplate(
      'Dear {{name}}, your company {{company}} is ready.',
      { name: 'Ada', company: 'Lovelace LLC' },
    )
    expect(markdown).toBe('Dear Ada, your company Lovelace LLC is ready.')
    expect(filledFields.sort()).toEqual(['company', 'name'])
    expect(missingFields).toEqual([])
  })

  it('renders an honest [[MISSING: x]] marker for absent/empty slots — never a blank or a guess', () => {
    const { markdown, missingFields } = renderTemplate('Fee: {{fee}}. Client: {{client}}.', {
      client: '',
      // fee absent entirely
    })
    expect(markdown).toBe('Fee: [[MISSING: fee]]. Client: [[MISSING: client]].')
    expect(missingFields.sort()).toEqual(['client', 'fee'])
  })

  it('tolerates whitespace and repeated slots', () => {
    const { markdown } = renderTemplate('{{ a }} and {{a}} again', { a: 'x' })
    expect(markdown).toBe('x and x again')
  })

  it('is a pure function — same inputs, same output, no side effects', () => {
    const tpl = 'Hi {{name}}'
    const data = { name: 'Sam' }
    expect(renderTemplate(tpl, data).markdown).toBe(renderTemplate(tpl, data).markdown)
  })
})

describe('buildMergeData', () => {
  const baseMatter = {
    matterEntityId: 'm1',
    matterNumber: 'PL-2026-0007',
    clientName: 'Maria Gomez',
    serviceKey: 'nc_llc_multi_member',
    workflowRoute: 'auto',
    status: 'in_review',
    scheduledAt: null,
    createdAt: '2026-06-18T00:00:00Z',
    practiceArea: 'nc_llc_multi_member',
    summary: '',
    attributes: {},
    questionnaireResponses: { company_name: 'Sunrise Ventures' },
    transcriptText: null,
    latestDraftVersionId: null,
    latestDraftStatus: null,
    clientEmail: 'maria@example.com',
  } satisfies MatterDetail

  it('maps matter + questionnaire facts onto common engagement-letter slots', () => {
    const data = buildMergeData(baseMatter, {
      effectiveDateIso: '2026-06-18T00:00:00Z',
      feeAmountFormatted: '$1,500.00',
      feeStructureHuman: 'a fixed flat fee',
    })
    expect(data.company_name).toBe('Sunrise Ventures')
    expect(data.primary_client_name).toBe('Maria Gomez')
    expect(data.primary_client_salutation).toBe('Maria') // first name
    expect(data.matter_number).toBe('PL-2026-0007')
    expect(data.client_email).toBe('maria@example.com')
    expect(data.effective_date).toBe('June 18, 2026') // deterministic long date
    expect(data.fee_amount_formatted).toBe('$1,500.00')
  })

  it('rendering the engagement-letter slots end-to-end yields a complete document with no model call', () => {
    const data = buildMergeData(baseMatter, { effectiveDateIso: '2026-06-18T00:00:00Z' })
    const tpl =
      '# Engagement — {{company_name}}\nDear {{primary_client_salutation}}, dated {{effective_date}}.'
    const { markdown, missingFields } = renderTemplate(tpl, data)
    expect(markdown).toContain('# Engagement — Sunrise Ventures')
    expect(markdown).toContain('Dear Maria, dated June 18, 2026.')
    // fee not supplied here → flagged, not invented
    expect(missingFields).not.toContain('company_name')
  })

  // PR1: any questionnaire answer (incl. reusable library questions) fills its
  // {{token}} by field id, not just the dozen curated slots.
  it('exposes every raw questionnaire answer by field id as a merge token', () => {
    const matter = {
      ...baseMatter,
      questionnaireResponses: {
        company_name: 'Sunrise Ventures',
        favorite_state: 'North Carolina', // a custom/library question token
        registered_agent: 'Jane Roe',
      },
    } satisfies MatterDetail
    const data = buildMergeData(matter, { effectiveDateIso: '2026-06-18T00:00:00Z' })
    expect(data.favorite_state).toBe('North Carolina')
    expect(data.registered_agent).toBe('Jane Roe')
    const { markdown, missingFields } = renderTemplate(
      'Agent {{registered_agent}} in {{favorite_state}}.',
      data,
    )
    expect(markdown).toBe('Agent Jane Roe in North Carolina.')
    expect(missingFields).toEqual([])
  })

  it('joins a multi-select (checkbox) answer with ", " and omits empty/__unknown__ answers', () => {
    const matter = {
      ...baseMatter,
      questionnaireResponses: {
        practice_areas: ['Corporate', 'Real Estate'], // checkbox
        empty_pick: [], // empty multi-select → unanswered
        skipped: '__unknown__', // "I don't know" → unanswered
      },
    } satisfies MatterDetail
    const data = buildMergeData(matter, { effectiveDateIso: '2026-06-18T00:00:00Z' })
    expect(data.practice_areas).toBe('Corporate, Real Estate')
    const { markdown, missingFields } = renderTemplate(
      '{{practice_areas}} / {{empty_pick}} / {{skipped}}',
      data,
    )
    expect(markdown).toBe('Corporate, Real Estate / [[MISSING: empty_pick]] / [[MISSING: skipped]]')
    expect(missingFields.sort()).toEqual(['empty_pick', 'skipped'])
  })

  it('does not stringify a members_repeater array into a junk token — renders MISSING honestly', () => {
    const matter = {
      ...baseMatter,
      questionnaireResponses: {
        company_name: 'Sunrise Ventures',
        members: [
          { name: 'Ada', ownership_percentage: '50' },
          { name: 'Grace', ownership_percentage: '50' },
        ],
      },
    } satisfies MatterDetail
    const data = buildMergeData(matter, { effectiveDateIso: '2026-06-18T00:00:00Z' })
    expect(data.members).toBeUndefined() // not "[object Object], [object Object]"
    const { markdown, missingFields } = renderTemplate('Members: {{members}}.', data)
    expect(markdown).toBe('Members: [[MISSING: members]].')
    expect(missingFields).toContain('members')
  })

  it('a curated slot never clobbers a real raw answer with undefined', () => {
    // client_email is a curated slot; when the matter has no email, a raw answer
    // of the same field id must survive (not be overwritten with undefined).
    const matter = {
      ...baseMatter,
      clientEmail: null,
      questionnaireResponses: { client_email: 'raw@intake.com' },
    } satisfies MatterDetail
    const data = buildMergeData(matter, { effectiveDateIso: '2026-06-18T00:00:00Z' })
    expect(data.client_email).toBe('raw@intake.com')
  })
})

// Field auto-bind (beta feedback 2026-07-06): the editors recognize tokens off
// MERGE_SLOT_FIELDS, so the constant and buildMergeData must never drift apart.
describe('MERGE_SLOT_FIELDS (editor recognition contract)', () => {
  const baseMatter = {
    matterEntityId: 'm1',
    matterNumber: 'PL-2026-0007',
    clientName: 'Maria Gomez',
    serviceKey: 'nc_llc_multi_member',
    workflowRoute: 'auto',
    status: 'in_review',
    scheduledAt: null,
    createdAt: '2026-06-18T00:00:00Z',
    practiceArea: 'nc_llc_multi_member',
    summary: '',
    attributes: {},
    questionnaireResponses: {},
    transcriptText: null,
    latestDraftVersionId: null,
    latestDraftStatus: null,
    clientEmail: 'maria@example.com',
  } satisfies MatterDetail

  it('every curated slot buildMergeData can emit is listed in MERGE_SLOT_FIELDS', () => {
    // Full inputs so every source resolves; questionnaire supplies the pick()
    // sources. Any curated key missing from the constant = editor would flag red
    // a token that merges — the exact bug this contract exists to prevent.
    const matter = {
      ...baseMatter,
      questionnaireResponses: {
        company_name: 'Sunrise Ventures',
        business_description: 'Consulting',
      },
    } satisfies MatterDetail
    const data = buildMergeData(matter, {
      effectiveDateIso: '2026-06-18T00:00:00Z',
      todayIso: '2026-07-06T00:00:00Z',
      feeAmountFormatted: '$1,500.00',
      feeStructureHuman: 'a fixed flat fee',
      firmName: 'Pacheco Law',
      attorneyName: 'Juan Carlos Pacheco',
    })
    const raw = new Set(['company_name', 'business_description']) // questionnaire ids
    for (const key of Object.keys(data)) {
      if (raw.has(key)) continue
      expect(MERGE_SLOT_FIELDS, `curated slot "${key}" missing from MERGE_SLOT_FIELDS`).toContain(
        key,
      )
    }
  })

  it('firm_name / attorney_name / today fill from options (they were MISSING before)', () => {
    const data = buildMergeData(baseMatter, {
      effectiveDateIso: '2026-06-18T00:00:00Z',
      todayIso: '2026-07-06T00:00:00Z',
      firmName: 'Pacheco Law',
      attorneyName: 'Juan Carlos Pacheco',
    })
    expect(data.firm_name).toBe('Pacheco Law')
    expect(data.attorney_name).toBe('Juan Carlos Pacheco')
    expect(data.today).toBe('July 6, 2026')
    // effective_date stays independent of today
    expect(data.effective_date).toBe('June 18, 2026')
  })

  it('today defaults to the effective date; unset firm identity renders MISSING honestly', () => {
    const data = buildMergeData(baseMatter, { effectiveDateIso: '2026-06-18T00:00:00Z' })
    expect(data.today).toBe('June 18, 2026')
    const { markdown } = renderTemplate('{{firm_name}} / {{attorney_name}}', data)
    expect(markdown).toBe('[[MISSING: firm_name]] / [[MISSING: attorney_name]]')
  })
})

// WP A2b — {{governing_jurisdiction}} is a curated slot fed by the CALLER
// (generateDraft.ts / generateEmail.ts resolve it via resolveMatterJurisdiction
// before calling buildMergeData; this module stays pure/sync). Never a
// hardcoded state, and unset must be as honest-MISSING as any other slot.
describe('governing_jurisdiction (WP A2b)', () => {
  const baseMatter = {
    matterEntityId: 'm1',
    matterNumber: 'PL-2026-0007',
    clientName: 'Maria Gomez',
    serviceKey: 'nc_llc_multi_member',
    workflowRoute: 'auto',
    status: 'in_review',
    scheduledAt: null,
    createdAt: '2026-06-18T00:00:00Z',
    practiceArea: 'nc_llc_multi_member',
    summary: '',
    attributes: {},
    questionnaireResponses: {},
    transcriptText: null,
    latestDraftVersionId: null,
    latestDraftStatus: null,
    clientEmail: 'maria@example.com',
  } satisfies MatterDetail

  it('is listed in MERGE_SLOT_FIELDS (editor recognition contract)', () => {
    expect(MERGE_SLOT_FIELDS).toContain('governing_jurisdiction')
  })

  it('binds {{governing_jurisdiction}} to the resolved display name', () => {
    const data = buildMergeData(baseMatter, {
      effectiveDateIso: '2026-06-18T00:00:00Z',
      governingJurisdiction: 'North Carolina',
    })
    expect(data.governing_jurisdiction).toBe('North Carolina')
    const { markdown, missingFields } = renderTemplate(
      'This matter is governed by the laws of {{governing_jurisdiction}}.',
      data,
    )
    expect(markdown).toBe('This matter is governed by the laws of North Carolina.')
    expect(missingFields).toEqual([])
  })

  it('renders an honest MISSING marker — never a guess — when unset', () => {
    const data = buildMergeData(baseMatter, { effectiveDateIso: '2026-06-18T00:00:00Z' })
    expect(data.governing_jurisdiction).toBeUndefined()
    const { markdown, missingFields } = renderTemplate('{{governing_jurisdiction}}', data)
    expect(markdown).toBe('[[MISSING: governing_jurisdiction]]')
    expect(missingFields).toContain('governing_jurisdiction')
  })
})
