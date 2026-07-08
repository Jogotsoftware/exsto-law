// BUILD BRIEF (BUILDER-HARDENING-1 WP4.2) — the formatter is PURE (the DB loads
// live in loadBuildBriefParts), so the brief's content contract is testable with
// no database: every approved artifact and every open item must be readable back,
// and a pre-shell build must say so instead of inventing state.
import { describe, it, expect } from 'vitest'
import { formatBuildBrief, type BuildBriefParts } from '@exsto/legal'

const base: BuildBriefParts = {
  serviceKey: 'nc_mutual_nda',
  service: {
    displayName: 'NC Mutual NDA',
    description: 'A mutual non-disclosure agreement prepared under North Carolina law.',
    route: 'auto',
    generationMode: 'ai_draft',
    cost: { type: 'fixed', amount: '350.00', hours: null },
    isActive: false,
  },
  questionnaireFieldIds: ['disclosing_party_name', 'receiving_party_name', 'effective_date'],
  templates: [{ documentKind: 'mutual_nda', tokens: ['disclosing_party_name', 'effective_date'] }],
  lifecycle: {
    version: 1,
    graph: [
      {
        key: 'intake_submitted',
        label: 'Client intake',
        entry: true,
        action: { kind: 'view_intake' },
        advances_to: [{ to: 'draft_ready', gate: 'client' }],
      },
      {
        key: 'draft_ready',
        label: 'Review & send',
        terminal: true,
        action: { kind: 'review_send_document' },
        advances_to: [],
      },
    ],
  },
  completeness: { serviceKey: 'nc_mutual_nda', ready: false, missing: ['needs a price'] },
}

describe('formatBuildBrief (WP4.2)', () => {
  it('renders every approved artifact with its substance, not a count', () => {
    const text = formatBuildBrief(base)
    expect(text).toContain('nc_mutual_nda')
    expect(text).toContain('route=auto')
    expect(text).toContain('generation_mode=ai_draft')
    expect(text).toContain('disclosing_party_name, receiving_party_name, effective_date')
    expect(text).toContain('mutual_nda — tokens: disclosing_party_name, effective_date')
    expect(text).toContain('intake_submitted(view_intake/client)')
    expect(text).toContain('draft_ready(review_send_document/terminal)')
    expect(text).toContain('fixed 350.00')
    expect(text).toContain('Open items before Enable: needs a price')
    expect(text).toContain('never re-ask')
  })

  it('says READY at the enable gate when completeness passes', () => {
    const text = formatBuildBrief({
      ...base,
      completeness: { serviceKey: 'nc_mutual_nda', ready: true, missing: [] },
    })
    expect(text).toContain('READY')
    expect(text).not.toContain('Open items')
  })

  it('reports a pre-shell build honestly instead of inventing state', () => {
    const text = formatBuildBrief({
      serviceKey: 'nc_mutual_nda',
      service: null,
      questionnaireFieldIds: [],
      templates: [],
      lifecycle: null,
      completeness: null,
    })
    expect(text).toContain('shell does not exist yet')
    expect(text).not.toContain('Workflow')
  })

  it('marks missing artifacts as "none yet" so the model knows the next step', () => {
    const text = formatBuildBrief({
      ...base,
      templates: [],
      questionnaireFieldIds: [],
      lifecycle: null,
    })
    expect(text).toContain('Templates: none yet.')
    expect(text).toContain('Questionnaire: none yet.')
    expect(text).toContain('Workflow: none yet.')
  })

  it('caps a pathological brief instead of blowing the prompt', () => {
    const huge = formatBuildBrief({
      ...base,
      questionnaireFieldIds: Array.from({ length: 2000 }, (_, i) => `field_${i}`),
    })
    expect(huge.length).toBeLessThanOrEqual(4000 + 20)
    expect(huge).toContain('…[truncated]')
  })
})
