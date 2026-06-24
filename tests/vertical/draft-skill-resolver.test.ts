// Jurisdiction-skill resolver (fast-follow to the Build-Wizard) — the AI drafter
// auto-applies the RIGHT legal playbook for a document kind even when the attorney
// picked none. rankSkillsForDraft is PURE (it scores a supplied catalog, no DB), so
// these run always. They prove the match is STRONG-ONLY: jurisdiction or a single
// generic word never alone pulls a skill in, and a poor match returns nothing (so a
// draft is unchanged).
import { describe, it, expect } from 'vitest'
import { rankSkillsForDraft } from '@exsto/legal'

type Entry = {
  slug: string
  name: string
  practiceArea: string
  description: string
  whenToUse: string
  userInvocable: boolean
}
const skill = (s: Partial<Entry> & { slug: string }): Entry => ({
  name: s.slug,
  practiceArea: 'corporate',
  description: '',
  whenToUse: '',
  userInvocable: true,
  ...s,
})

const CATALOG: Entry[] = [
  skill({
    slug: 'corporate.nc-operating-agreement',
    name: 'NC LLC Operating Agreement',
    whenToUse: 'When drafting an operating agreement for a North Carolina LLC.',
  }),
  skill({
    slug: 'corporate.de-operating-agreement',
    name: 'Delaware LLC Operating Agreement',
    whenToUse: 'When drafting an operating agreement for a Delaware LLC.',
  }),
  skill({
    slug: 'firm.engagement-letter',
    name: 'Engagement Letter',
    whenToUse: 'When opening a new matter and sending the client an engagement letter.',
  }),
  skill({
    slug: 'commercial.mutual-nda',
    name: 'Mutual NDA',
    whenToUse: 'When two parties exchange confidential information under a mutual NDA.',
  }),
  skill({
    slug: 'commercial.contract-review',
    name: 'Contract Review',
    whenToUse: 'Review any commercial agreement for risk.',
  }),
  skill({
    slug: 'helper.not-invocable',
    name: 'Internal helper',
    whenToUse: 'operating agreement engagement letter nda', // would match, but hidden
    userInvocable: false,
  }),
]

describe('rankSkillsForDraft — jurisdiction skill resolution (pure)', () => {
  it('picks the jurisdiction-specific skill when the kind phrase + state match', () => {
    const res = rankSkillsForDraft(CATALOG, {
      documentKind: 'operating_agreement',
      jurisdiction: 'NC',
    })
    expect(res).toEqual(['corporate.nc-operating-agreement'])
  })

  it('prefers the matching state over another state with the same document kind', () => {
    const nc = rankSkillsForDraft(CATALOG, {
      documentKind: 'operating_agreement',
      jurisdiction: 'NC',
    })
    const de = rankSkillsForDraft(CATALOG, {
      documentKind: 'operating_agreement',
      jurisdiction: 'DE',
    })
    expect(nc).toEqual(['corporate.nc-operating-agreement'])
    expect(de).toEqual(['corporate.de-operating-agreement'])
  })

  it('resolves a multi-word kind by requiring ALL its words (engagement letter)', () => {
    const res = rankSkillsForDraft(CATALOG, { documentKind: 'engagement_letter' })
    expect(res).toEqual(['firm.engagement-letter'])
  })

  it('resolves a single-word kind (nda)', () => {
    const res = rankSkillsForDraft(CATALOG, { documentKind: 'mutual_nda' })
    expect(res).toEqual(['commercial.mutual-nda'])
  })

  it('returns nothing when no skill strongly matches the kind (no draft pollution)', () => {
    // "lease agreement" — no catalog skill is about leases; the generic Contract Review
    // has "agreement" but not "lease", so ALL-words fails and it does not qualify.
    const res = rankSkillsForDraft(CATALOG, { documentKind: 'lease_agreement', jurisdiction: 'NC' })
    expect(res).toEqual([])
  })

  it('never qualifies a skill on jurisdiction alone', () => {
    // A North Carolina mention with a kind no skill matches → nothing.
    const res = rankSkillsForDraft(CATALOG, {
      documentKind: 'will_and_testament',
      jurisdiction: 'NC',
    })
    expect(res).toEqual([])
  })

  it('excludes non-invocable helper skills even when they would match', () => {
    const res = rankSkillsForDraft(CATALOG, { documentKind: 'operating_agreement', limit: 5 })
    expect(res).not.toContain('helper.not-invocable')
  })

  it('honors the limit', () => {
    const res = rankSkillsForDraft(CATALOG, { documentKind: 'operating_agreement', limit: 2 })
    expect(res.length).toBeLessThanOrEqual(2)
    expect(res[0]).toBe('corporate.de-operating-agreement') // tie on score → slug order (de < nc)
  })

  it('returns [] for an empty document kind', () => {
    expect(rankSkillsForDraft(CATALOG, { documentKind: '' })).toEqual([])
  })
})
