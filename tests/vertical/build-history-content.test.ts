// WP4.1 — the model-facing history record of a card-heavy turn must replay each
// proposal's SUBSTANCE (keys, tokens, field ids, workflow steps), not the old
// flattened "[You presented N proposal card(s)]" stub that made the model forget
// what it had built mid-build.
import { describe, it, expect } from 'vitest'
import { assistantHistoryContent } from '../../apps/legal-demo/lib/buildHistoryContent'

const emptyCards = {
  buildQuestions: [],
  workflowProposals: [],
  serviceProposals: [],
  questionnaireProposals: [],
  templateProposals: [],
  costProposals: [],
  enableProposals: [],
  kindProposals: [],
}

describe('assistantHistoryContent (WP4.1)', () => {
  it('returns undefined for a plain prose turn', () => {
    expect(assistantHistoryContent('Just an answer.', emptyCards)).toBeUndefined()
  })

  it('replays proposal substance, never a flattened count', () => {
    const text = assistantHistoryContent('', {
      ...emptyCards,
      serviceProposals: [
        {
          displayName: 'NC Mutual NDA',
          derivedKey: 'nc_mutual_nda',
          route: 'auto',
          generationMode: 'ai_draft',
        },
      ],
      templateProposals: [
        {
          serviceKey: 'nc_mutual_nda',
          name: 'Mutual NDA',
          docKind: 'mutual_nda',
          tokens: ['disclosing_party_name', 'effective_date'],
          orphanTokens: ['effective_date'],
        },
      ],
      questionnaireProposals: [
        {
          serviceKey: 'nc_mutual_nda',
          schema: {
            sections: [
              {
                fields: [
                  { id: 'disclosing_party_name' },
                  { id: 'members', memberFields: [{ id: 'member_name' }] },
                ],
              },
            ],
          },
          missingForTokens: ['effective_date'],
          unusedFields: [],
        },
      ],
      workflowProposals: [
        {
          serviceKey: 'nc_mutual_nda',
          graph: [
            { key: 'intake', action: { kind: 'view_intake' }, advances_to: [{ gate: 'client' }] },
            { key: 'done', action: { kind: 'complete_matter' }, advances_to: [] },
          ],
        },
      ],
      costProposals: [
        { serviceKey: 'nc_mutual_nda', costType: 'fixed', amount: '350.00', hours: null },
      ],
    })!
    expect(text).toContain('nc_mutual_nda')
    expect(text).toContain('route=auto')
    expect(text).toContain('disclosing_party_name, effective_date')
    expect(text).toContain('not yet covered by a question: effective_date')
    expect(text).toContain('member_name') // repeater member fields bind tokens too
    expect(text).toContain('intake(view_intake/client) → done(complete_matter/terminal)')
    expect(text).toContain('fixed 350.00')
    expect(text).not.toMatch(/presented \d+ proposal card/)
  })

  it('keeps ask_build_question replay and appends notices', () => {
    const text = assistantHistoryContent('One sentence.', {
      ...emptyCards,
      buildQuestions: [{ key: 'kickoff', question: 'Who starts this, and how?' }],
      notices: ['The assistant hit its per-turn tool limit before finishing.'],
    })!
    expect(text).toContain('One sentence.')
    expect(text).toContain('(key "kickoff"): Who starts this, and how?')
    expect(text).toContain(
      '[Notice shown to the attorney: The assistant hit its per-turn tool limit',
    )
  })

  it('caps one runaway card note at ~1500 chars', () => {
    const text = assistantHistoryContent('', {
      ...emptyCards,
      templateProposals: [
        {
          serviceKey: 'k',
          name: 'Huge',
          docKind: 'huge',
          tokens: Array.from({ length: 500 }, (_, i) => `token_${i}`),
          orphanTokens: [],
        },
      ],
    })!
    const line = text.split('\n')[0]!
    expect(line.length).toBeLessThanOrEqual(1505)
  })
})
