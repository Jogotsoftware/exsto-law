// P13 — merge-token classification. PURE unit tests (no DB, no model): they pin
// SYSTEM_TOKENS ⊇ MERGE_SLOT_FIELDS (the classification and the merge engine can
// never drift — the recognition-set idiom from template-merge.test.ts), prove the
// questionnaire validator never forces a client question for a system token, and
// prove the code-enforced internal coercion for attorney/firm/system fields.
import { describe, it, expect } from 'vitest'
import {
  SYSTEM_TOKENS,
  isSystemToken,
  isAutoInternalToken,
  MERGE_SLOT_FIELDS,
  buildMergeData,
  renderTemplate,
  validateProposedQuestionnaire,
  coerceSystemFieldsInternal,
} from '@exsto/legal'
import type { MatterDetail } from '@exsto/legal'

describe('SYSTEM_TOKENS (classification contract)', () => {
  it('is a superset of MERGE_SLOT_FIELDS — the merge engine and the classification cannot drift', () => {
    for (const slot of MERGE_SLOT_FIELDS) {
      expect(SYSTEM_TOKENS.has(slot.toLowerCase()), `merge slot "${slot}" missing`).toBe(true)
    }
  })

  it('covers every token the approve-time resolver fills', () => {
    for (const t of [
      'attorney_name',
      'attorney_email',
      'letter_date',
      'today',
      'firm_name',
      'firm_address',
      'firm_phone',
      'firm_email',
    ]) {
      expect(isSystemToken(t), `resolver token "${t}"`).toBe(true)
    }
  })

  it('isSystemToken is case-insensitive and trims', () => {
    expect(isSystemToken('Attorney_Email')).toBe(true)
    expect(isSystemToken('  FIRM_NAME ')).toBe(true)
    expect(isSystemToken('member_name')).toBe(false)
  })

  it('classes render/sign-time artifacts as system (never client questions)', () => {
    expect(isSystemToken('signature')).toBe(true)
    expect(isSystemToken('citation')).toBe(true)
  })
})

describe('isAutoInternalToken (client can never be asked for system data)', () => {
  it('coerces attorney/firm/date/matter tokens', () => {
    for (const t of ['attorney_email', 'attorney_name', 'firm_name', 'letter_date', 'today']) {
      expect(isAutoInternalToken(t), t).toBe(true)
    }
  })

  it('never coerces client-sourced slots (they are legitimately client-facing)', () => {
    expect(isAutoInternalToken('company_name')).toBe(false)
    expect(isAutoInternalToken('business_description')).toBe(false)
    expect(isAutoInternalToken('effective_date')).toBe(false)
  })

  it('never coerces a non-system token', () => {
    expect(isAutoInternalToken('member_name')).toBe(false)
  })
})

const schemaWith = (fields: Array<Record<string, unknown>>) => ({
  sections: [{ id: 'main', title: 'Main', fields }],
})

describe('validateProposedQuestionnaire (system tokens never force a client question)', () => {
  it('excludes system tokens from missingForTokens', () => {
    const v = validateProposedQuestionnaire(
      schemaWith([{ id: 'company_name', label: 'Company name', type: 'text' }]),
      ['company_name', 'attorney_email', 'letter_date', 'firm_address'],
    )
    expect(v.ok).toBe(true)
    // The system tokens are not gaps — only a real client token would be.
    expect(v.missingForTokens).toEqual([])
  })

  it('still reports a genuinely uncovered CLIENT token', () => {
    const v = validateProposedQuestionnaire(
      schemaWith([{ id: 'company_name', label: 'Company name', type: 'text' }]),
      ['company_name', 'member_name', 'attorney_email'],
    )
    expect(v.missingForTokens).toEqual(['member_name'])
  })
})

describe('coerceSystemFieldsInternal (code-enforced, not prose)', () => {
  it('coerces a client-facing system-token field to internal:true + required:false', () => {
    const input = schemaWith([
      { id: 'attorney_email', label: 'Attorney email', type: 'text', required: true },
      { id: 'company_name', label: 'Company name', type: 'text', required: true },
    ])
    const { schema, coerced } = coerceSystemFieldsInternal(input)
    expect(coerced).toEqual(['attorney_email'])
    const fields = (schema as { sections: Array<{ fields: Array<Record<string, unknown>> }> })
      .sections[0]!.fields
    expect(fields[0]).toMatchObject({ id: 'attorney_email', internal: true, required: false })
    // Client-sourced slots stay client-facing.
    expect(fields[1]).toMatchObject({ id: 'company_name', required: true })
    expect(fields[1]!.internal).toBeUndefined()
    // The caller's proposal object is never mutated.
    expect(input.sections[0]!.fields[0]!.internal).toBeUndefined()
  })

  it('leaves an already-internal field alone', () => {
    const { coerced } = coerceSystemFieldsInternal(
      schemaWith([{ id: 'attorney_name', label: 'Attorney', type: 'text', internal: true }]),
    )
    expect(coerced).toEqual([])
  })
})

describe('buildMergeData (P13 firm/attorney/date slots)', () => {
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

  it('fills the new firm/attorney identity slots from options', () => {
    const data = buildMergeData(baseMatter, {
      effectiveDateIso: '2026-06-18T00:00:00Z',
      todayIso: '2026-07-10T00:00:00Z',
      attorneyEmail: 'jp@pacheco.law',
      firmEmail: 'firm@pacheco.law',
      firmPhone: '(919) 555-0100',
      firmAddress: '100 Main St, Raleigh, NC',
    })
    expect(data.attorney_email).toBe('jp@pacheco.law')
    expect(data.firm_email).toBe('firm@pacheco.law')
    expect(data.firm_phone).toBe('(919) 555-0100')
    expect(data.firm_address).toBe('100 Main St, Raleigh, NC')
    expect(data.letter_date).toBe('July 10, 2026') // generation date at merge
    expect(data.client_name).toBe('Maria Gomez') // matter fact, system-resolved
  })

  it('unset firm identity renders MISSING honestly — never a default', () => {
    const data = buildMergeData(baseMatter, { effectiveDateIso: '2026-06-18T00:00:00Z' })
    const { markdown } = renderTemplate('{{firm_address}} / {{attorney_email}}', data)
    expect(markdown).toBe('[[MISSING: firm_address]] / [[MISSING: attorney_email]]')
  })
})
