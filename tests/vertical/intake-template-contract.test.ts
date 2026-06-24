// Variable-contract validators (Build-Wizard Phase 2+3) — the token-symmetry that
// is THE POINT of "documents → variables → questionnaire". These are PURE (no DB, no
// model), so they always run: given fixture schemas/bodies they prove the validators
// correctly flag a template token with no question (orphan / missingForTokens) and a
// question no template uses (unusedFields).
import { describe, it, expect } from 'vitest'
import { validateProposedQuestionnaire, validateProposedTemplate } from '@exsto/legal'

describe('validateProposedQuestionnaire — token symmetry (pure)', () => {
  // A well-formed schema collecting company_name + state, against templates that
  // reference company_name + registered_agent. registered_agent is uncovered
  // (missingForTokens); state is collected but no template uses it (unusedFields).
  const schema = {
    title: 'Formation intake',
    sections: [
      {
        id: 'company',
        title: 'Company',
        fields: [
          { id: 'company_name', label: 'Company name', type: 'text', required: true },
          { id: 'state', label: 'State', type: 'text' },
        ],
      },
    ],
  }
  const templateTokens = ['company_name', 'registered_agent']

  it('flags template tokens with no matching field as missingForTokens', () => {
    const res = validateProposedQuestionnaire(schema, templateTokens)
    expect(res.ok).toBe(true) // shape is valid; coverage gaps are not hard errors
    expect(res.missingForTokens).toEqual(['registered_agent'])
  })

  it('flags fields no template references as unusedFields', () => {
    const res = validateProposedQuestionnaire(schema, templateTokens)
    expect(res.unusedFields).toContain('state')
    expect(res.unusedFields).not.toContain('company_name')
  })

  it('reports full coverage when every token has a field', () => {
    const res = validateProposedQuestionnaire(schema, ['company_name'])
    expect(res.missingForTokens).toEqual([])
  })

  it('counts members_repeater member fields toward coverage', () => {
    const repeaterSchema = {
      sections: [
        {
          id: 'members',
          title: 'Members',
          fields: [
            {
              id: 'members',
              label: 'Members',
              type: 'members_repeater',
              memberFields: [{ id: 'member_name', label: 'Name', type: 'text' }],
            },
          ],
        },
      ],
    }
    const res = validateProposedQuestionnaire(repeaterSchema, ['member_name'])
    expect(res.ok).toBe(true)
    expect(res.missingForTokens).toEqual([])
  })

  it('is case-insensitive when matching tokens to field ids', () => {
    const res = validateProposedQuestionnaire(schema, ['Company_Name'])
    expect(res.missingForTokens).toEqual([])
  })

  it('surfaces a shape error (and treats every token as missing) for an invalid schema', () => {
    const res = validateProposedQuestionnaire({ sections: 'nope' }, ['company_name'])
    expect(res.ok).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.missingForTokens).toEqual(['company_name'])
  })

  it('rejects an unknown field type via the wrapped validateIntakeSchema', () => {
    const bad = {
      sections: [{ id: 's', title: 'S', fields: [{ id: 'f', label: 'F', type: 'rainbow' }] }],
    }
    const res = validateProposedQuestionnaire(bad, [])
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/unsupported type/i)
  })
})

describe('validateProposedTemplate — orphan tokens (pure)', () => {
  // A body referencing company_name + registered_agent against a questionnaire that
  // only collects company_name: registered_agent is an ORPHAN (renders [[MISSING]]).
  const body = 'Company: {{company_name}}\nAgent: {{registered_agent}}'
  const fieldIds = ['company_name']

  it('extracts the flat {{tokens}} and flags the orphans', () => {
    const res = validateProposedTemplate(body, fieldIds)
    expect(res.ok).toBe(true)
    expect(res.tokens).toEqual(['company_name', 'registered_agent'])
    expect(res.orphanTokens).toEqual(['registered_agent'])
  })

  it('reports no orphans when every token has a field', () => {
    const res = validateProposedTemplate('Hi {{company_name}}', ['company_name', 'state'])
    expect(res.orphanTokens).toEqual([])
  })

  it('is case-insensitive when matching tokens to field ids', () => {
    const res = validateProposedTemplate('{{Company_Name}}', ['company_name'])
    expect(res.orphanTokens).toEqual([])
  })

  it('does NOT treat {{>includes}} as input tokens', () => {
    const res = validateProposedTemplate('{{>header}} Body {{company_name}}', ['company_name'])
    expect(res.tokens).toEqual(['company_name'])
    expect(res.orphanTokens).toEqual([])
  })

  it('SEES dotted-path tokens (renderer-complete) and flags them as orphans', () => {
    // The merge renderer recognizes {{member.0.name}} but the flat answer map can
    // never fill it (renders [[MISSING]]), and no flat field.id can bind it — so the
    // contract check must catch it. A flat extractor would miss it entirely.
    const res = validateProposedTemplate('{{company_name}} — {{member.0.name}}', ['company_name'])
    expect(res.tokens).toContain('member.0.name')
    expect(res.orphanTokens).toEqual(['member.0.name'])
  })

  it('rejects an empty body via the wrapped validateDocumentTemplate', () => {
    const res = validateProposedTemplate('   ', ['company_name'])
    expect(res.ok).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.tokens).toEqual([])
  })
})

describe('validateProposedTemplate — flow-aware + reuse-aware orphans (Phase 7, pure)', () => {
  // A body whose tokens split three ways against the service's OWN questionnaire
  // (company_name) and the firm-wide library (registered_agent exists elsewhere):
  //   company_name      → covered by this service's question (not an orphan)
  //   registered_agent  → orphan here, but REUSABLE from another service
  //   principal_office  → orphan here, and brand-new (genuinely missing/forward-looking)
  const body = '{{company_name}} — {{registered_agent}} — {{principal_office}}'
  const fieldIds = ['company_name']
  const firmFieldIds = ['registered_agent', 'effective_date'] // effective_date is unused here

  it('computes reusableFromFirm as the subset of orphans defined elsewhere in the firm', () => {
    const res = validateProposedTemplate(body, fieldIds, { hasQuestionnaire: true, firmFieldIds })
    expect(res.orphanTokens).toEqual(['registered_agent', 'principal_office'])
    // Only the orphan that exists firm-wide is reusable; the brand-new one is not.
    expect(res.reusableFromFirm).toEqual(['registered_agent'])
  })

  it('never marks the service’s own covered tokens as orphan or reusable', () => {
    const res = validateProposedTemplate(body, fieldIds, { hasQuestionnaire: true, firmFieldIds })
    expect(res.orphanTokens).not.toContain('company_name')
    expect(res.reusableFromFirm).not.toContain('company_name')
  })

  it('is case-insensitive when matching reusable tokens to the firm library', () => {
    const res = validateProposedTemplate('{{Registered_Agent}}', [], {
      hasQuestionnaire: true,
      firmFieldIds: ['registered_agent'],
    })
    expect(res.reusableFromFirm).toEqual(['registered_agent'])
  })

  it('honors hasQuestionnaire (forward-looking when false) and defaults reuse to empty', () => {
    const before = validateProposedTemplate(body, [], { hasQuestionnaire: false })
    expect(before.hasQuestionnaire).toBe(false)
    expect(before.reusableFromFirm).toEqual([]) // no firm library passed → nothing reusable
    // With no opts at all, hasQuestionnaire infers from whether any field ids were given.
    const inferred = validateProposedTemplate(body, fieldIds)
    expect(inferred.hasQuestionnaire).toBe(true)
    expect(inferred.reusableFromFirm).toEqual([])
  })
})
