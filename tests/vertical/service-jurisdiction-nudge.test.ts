// WP A2b — the governing_jurisdiction completeness NUDGE
// (verticals/legal/src/api/serviceAuthoringTools.ts). PURE unit test (no DB):
// jurisdictionSuggestions never affects `ready`/`missing` (computeCompleteness
// stays untouched) — it only ever adds a non-blocking suggestion string when a
// document-drafting service's intake doesn't already ask for governing law.
import { describe, it, expect } from 'vitest'
import { jurisdictionSuggestions, GOVERNING_JURISDICTION_FIELD_ID } from '@exsto/legal'
import type { IntakeSchema } from '@exsto/legal'

const schemaWith = (fieldIds: string[]): IntakeSchema => ({
  sections: [
    {
      id: 'main',
      title: 'Main',
      fields: fieldIds.map((id) => ({ id, label: id, type: 'text' })),
    },
  ],
})

describe('jurisdictionSuggestions', () => {
  it('nudges an auto-route, document-drafting service with no governing_jurisdiction field', () => {
    const suggestions = jurisdictionSuggestions({
      route: 'auto',
      documents: ['engagement_letter'],
      intakeSchema: schemaWith(['company_name']),
    })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toContain(GOVERNING_JURISDICTION_FIELD_ID)
  })

  it('is silent once the service already asks the reusable question', () => {
    const suggestions = jurisdictionSuggestions({
      route: 'auto',
      documents: ['engagement_letter'],
      intakeSchema: schemaWith(['company_name', GOVERNING_JURISDICTION_FIELD_ID]),
    })
    expect(suggestions).toEqual([])
  })

  it('is silent for a manual-route service (no auto-drafted document to merge into)', () => {
    const suggestions = jurisdictionSuggestions({
      route: 'manual',
      documents: [],
      intakeSchema: schemaWith(['company_name']),
    })
    expect(suggestions).toEqual([])
  })

  it('is silent for an auto-route service with no documents', () => {
    const suggestions = jurisdictionSuggestions({
      route: 'auto',
      documents: [],
      intakeSchema: schemaWith(['company_name']),
    })
    expect(suggestions).toEqual([])
  })

  it('is a nudge, never a block — it does not appear under missing/ready anywhere in this shape', () => {
    const suggestions = jurisdictionSuggestions({
      route: 'auto',
      documents: ['engagement_letter'],
      intakeSchema: undefined,
    })
    // Only ever a `suggestions`-shaped array of strings — never thrown, never a
    // { ready, missing } object a caller could accidentally treat as a gate.
    expect(Array.isArray(suggestions)).toBe(true)
    expect(suggestions.every((s) => typeof s === 'string')).toBe(true)
  })
})
