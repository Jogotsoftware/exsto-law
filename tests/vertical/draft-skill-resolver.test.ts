// Jurisdiction-skill resolver (fast-follow to the Build-Wizard) — the AI drafter
// auto-applies the RIGHT legal playbook for a document kind even when the attorney
// picked none. rankSkillsForDraft is PURE (it scores a supplied catalog, no DB), so
// these run always. They prove the match is STRONG-ONLY: jurisdiction or a single
// generic word never alone pulls a skill in, and a poor match returns nothing (so a
// draft is unchanged).
import { describe, it, expect } from 'vitest'
import { rankSkillsForDraft, buildSkillCatalogText } from '@exsto/legal'

type Entry = {
  slug: string
  name: string
  practiceArea: string
  description: string
  whenToUse: string
  userInvocable: boolean
  // WP A5 — optional US jurisdiction this skill is SPECIFIC to. Absent on every
  // entry below except the ones built specifically to exercise the negative
  // filter (jurisdiction-neutral is the default for everything else).
  jurisdiction?: string
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

// ── WP A5 — intent vocabulary (real keys for review/email auto-resolve) ──────
//
// Pre-A5, reviewDocument.ts/generateEmail.ts keyed the auto-resolve on the
// OUTPUT document's own sentinel kind (REVIEW_MEMO_DOCUMENT_KIND =
// 'document_review_memo', CLIENT_EMAIL_DOCUMENT_KIND = 'client_email') — words
// no seeded skill's when-to-use ever matched, making the auto-resolve a
// near-no-op. The fix: an `intent` param whose fixed vocabulary is tried
// ALONGSIDE the caller's own (now correct) documentKind phrase — 'draft' (the
// default) carries none, so drafting is byte-for-byte unchanged.
describe('rankSkillsForDraft — intent vocabulary (WP A5)', () => {
  const INTENT_CATALOG: Entry[] = [
    skill({
      slug: 'commercial.contract-review',
      name: 'Contract Review',
      whenToUse: 'Review any commercial agreement for risk.',
    }),
    skill({
      slug: 'commercial.lease-review',
      name: 'Lease Review',
      whenToUse:
        'Review a commercial lease before signing — rent, term, renewal, and termination provisions.',
    }),
    skill({
      slug: 'firm.client-voice',
      name: 'Client Communication Voice',
      whenToUse: 'Apply firm voice guidelines to any client email or client letter.',
    }),
    skill({
      slug: 'corporate.nc-operating-agreement',
      name: 'NC LLC Operating Agreement',
      whenToUse: 'When drafting an operating agreement for a North Carolina LLC.',
    }),
  ]

  it('review intent matches the generic Contract Review skill via review vocabulary even off a generic upload label', () => {
    // 'uploaded' is the generic default document_kind label a plain upload gets
    // (documentUpload.ts) — no real kind words of its own to match on.
    const res = rankSkillsForDraft(INTENT_CATALOG, { documentKind: 'uploaded', intent: 'review' })
    expect(res).toEqual(['commercial.contract-review'])
  })

  it("review intent still matches on the reviewed document's OWN kind text when it is specific", () => {
    const res = rankSkillsForDraft(INTENT_CATALOG, {
      documentKind: 'lease',
      intent: 'review',
      limit: 5,
    })
    expect(res).toContain('commercial.lease-review')
  })

  it('email intent matches client-email/letter vocabulary even off a free-text purpose with no strong kind words', () => {
    const res = rankSkillsForDraft(INTENT_CATALOG, {
      documentKind: 'send a quick update to the client',
      intent: 'email',
    })
    expect(res).toEqual(['firm.client-voice'])
  })

  it('draft intent (the default) does NOT pick up review/email vocabulary — unchanged pre-A5 behavior', () => {
    expect(rankSkillsForDraft(INTENT_CATALOG, { documentKind: 'uploaded' })).toEqual([])
    expect(
      rankSkillsForDraft(INTENT_CATALOG, { documentKind: 'send a quick update to the client' }),
    ).toEqual([])
  })

  it('does not spuriously pick up an unrelated intent vocabulary skill for an ordinary draft', () => {
    const res = rankSkillsForDraft(INTENT_CATALOG, {
      documentKind: 'operating_agreement',
      jurisdiction: 'NC',
    })
    expect(res).toEqual(['corporate.nc-operating-agreement'])
  })
})

// ── WP A5 — negative jurisdiction filter ──────────────────────────────────────
//
// A skill EXPLICITLY tagged to one jurisdiction (skill_jurisdiction attribute)
// is excluded outright when the resolved jurisdiction differs — never auto-load
// a Delaware playbook onto a North Carolina matter. Untagged is neutral.
describe('rankSkillsForDraft — negative jurisdiction filter (WP A5)', () => {
  const JURISDICTION_CATALOG: Entry[] = [
    skill({
      slug: 'corporate.de-llc-playbook',
      name: 'Delaware LLC Playbook',
      jurisdiction: 'DE',
      whenToUse: 'General Delaware LLC formation and governance playbook.',
    }),
    skill({
      slug: 'corporate.llc-playbook-neutral',
      name: 'LLC Playbook',
      whenToUse: 'General LLC formation and governance playbook, jurisdiction-neutral.',
    }),
  ]

  it('excludes a jurisdiction-tagged skill when the resolved jurisdiction differs (DE-tagged, NC matter)', () => {
    const res = rankSkillsForDraft(JURISDICTION_CATALOG, {
      documentKind: 'llc_formation',
      jurisdiction: 'NC',
      limit: 5,
    })
    expect(res).not.toContain('corporate.de-llc-playbook')
  })

  it('includes the tagged skill when the resolved jurisdiction matches (DE-tagged, DE matter)', () => {
    const res = rankSkillsForDraft(JURISDICTION_CATALOG, {
      documentKind: 'llc_formation',
      jurisdiction: 'DE',
      limit: 5,
    })
    expect(res).toContain('corporate.de-llc-playbook')
  })

  it('never excludes an untagged skill regardless of the resolved jurisdiction', () => {
    const nc = rankSkillsForDraft(JURISDICTION_CATALOG, {
      documentKind: 'llc_formation',
      jurisdiction: 'NC',
      limit: 5,
    })
    const de = rankSkillsForDraft(JURISDICTION_CATALOG, {
      documentKind: 'llc_formation',
      jurisdiction: 'DE',
      limit: 5,
    })
    expect(nc).toContain('corporate.llc-playbook-neutral')
    expect(de).toContain('corporate.llc-playbook-neutral')
  })

  it('does not exclude a tagged skill when there is no resolved jurisdiction to compare against', () => {
    const res = rankSkillsForDraft(JURISDICTION_CATALOG, {
      documentKind: 'llc_formation',
      limit: 5,
    })
    expect(res).toContain('corporate.de-llc-playbook')
    expect(res).toContain('corporate.llc-playbook-neutral')
  })
})

// ── WP A5 — practice-area catalog scoping ────────────────────────────────────
//
// buildSkillCatalogText (the system-prompt DISCOVERY surface) scopes to the
// firm's own practice_areas plus a small always-on set every firm needs
// regardless of practice mix. An unset firm gets the full catalog (honest
// default). load_skill by slug is UNAFFECTED — this only filters what the
// system prompt advertises.
describe('buildSkillCatalogText — practice-area catalog scoping (WP A5)', () => {
  const SCOPE_CATALOG: Entry[] = [
    skill({ slug: 'corporate.x', name: 'Corp X', practiceArea: 'corporate', whenToUse: 'x' }),
    skill({
      slug: 'employment.y',
      name: 'Employment Y',
      practiceArea: 'employment',
      whenToUse: 'y',
    }),
    skill({
      slug: 'firm-admin.z',
      name: 'Firm Admin Z',
      practiceArea: 'firm-admin',
      whenToUse: 'z',
    }),
    skill({ slug: 'research.w', name: 'Research W', practiceArea: 'research', whenToUse: 'w' }),
    skill({
      slug: 'client-portal.v',
      name: 'Client Portal V',
      practiceArea: 'client-portal',
      whenToUse: 'v',
    }),
  ]

  it('returns the full catalog when the firm has no practice areas set (honest default)', () => {
    const unset = buildSkillCatalogText(SCOPE_CATALOG, null)
    const empty = buildSkillCatalogText(SCOPE_CATALOG, [])
    for (const s of SCOPE_CATALOG) {
      expect(unset).toContain(s.slug)
      expect(empty).toContain(s.slug)
    }
  })

  it('scopes to the firm practice areas plus the always-on set when the firm has set practice areas', () => {
    const text = buildSkillCatalogText(SCOPE_CATALOG, ['corporate'])
    expect(text).toContain('corporate.x')
    expect(text).not.toContain('employment.y')
    // Always-on set — survives regardless of the firm's own configured areas.
    expect(text).toContain('firm-admin.z')
    expect(text).toContain('research.w')
    expect(text).toContain('client-portal.v')
  })

  it('returns "" when the firm has practice areas set and none of the catalog matches (no always-on skills present)', () => {
    const text = buildSkillCatalogText(
      [skill({ slug: 'employment.only', practiceArea: 'employment', whenToUse: 'only' })],
      ['corporate'],
    )
    expect(text).toBe('')
  })
})
