// Generation integrity — jurisdiction + system facts into AI drafting,
// unresolved-token surfacing, brief jurisdiction grounding. All PURE (no DB,
// no live model), mirroring service-digest-drafting.test.ts's approach to
// assembleDraftingPrompt and brief-evidence.test.ts's material-faking approach
// to buildMatterEvidence. What this file pins:
//   - buildSystemFactsBlock: the jurisdiction-set (matter/firm rung), the
//     honest-unset instruction, today's date, and the firm name (present only
//     when known — anti-forgery, never a demo default);
//   - assembleDraftingPrompt: the system-facts block lands BEFORE the base
//     prompt (snapshots for set + unset), and its absence leaves the prompt
//     byte-identical to the pre-fix behavior;
//   - findUnresolvedTokens: the deterministic scan of a produced body — found,
//     de-duplicated/sorted, empty on a clean body, render-state/e-sign markers
//     excluded;
//   - buildDraftTraceJson: unresolved_tokens folds into the stored trace (an
//     empty array is recorded honestly; undefined stays a no-op);
//   - buildMatterEvidence: the "Governing jurisdiction:" FACT line in the
//     matter-core section for set (matter/firm) and unset;
//   - buildBriefSynthesisPrompt: carries BRIEF_JURISDICTION_RULE (never infer
//     jurisdiction from an address).
import { describe, it, expect } from 'vitest'
import {
  assembleDraftingPrompt,
  buildSystemFactsBlock,
  buildDraftTraceJson,
  findUnresolvedTokens,
  buildMatterEvidence,
  buildBriefSynthesisPrompt,
  BRIEF_JURISDICTION_RULE,
  FORMATTING_DIRECTIVES,
  buildRevisionPrompt,
  renderEvidenceBundle,
  type BriefScope,
  type EvidenceBundle,
  type ResolvedJurisdiction,
} from '@exsto/legal'
import type { MatterDetail, MatterHistory } from '@exsto/legal'

const NC: ResolvedJurisdiction = { code: 'NC', displayName: 'North Carolina', source: 'matter' }
const GA_FIRM: ResolvedJurisdiction = { code: 'GA', displayName: 'Georgia', source: 'firm' }

// ── buildSystemFactsBlock ────────────────────────────────────────────────────

describe('buildSystemFactsBlock', () => {
  it('names the jurisdiction with its matter-fact source rung', () => {
    const block = buildSystemFactsBlock({
      jurisdiction: NC,
      todayIso: '2026-07-20T00:00:00Z',
      firmName: 'Pacheco Law Firm',
    })
    expect(block).toContain('Governing jurisdiction: North Carolina (source: matter fact)')
    expect(block).toContain("Today's date: July 20, 2026")
    expect(block).toContain('Firm name: Pacheco Law Firm')
  })

  it('names the firm-default source rung when the jurisdiction fell through to the firm', () => {
    const block = buildSystemFactsBlock({ jurisdiction: GA_FIRM, todayIso: '2026-07-20T00:00:00Z' })
    expect(block).toContain('Governing jurisdiction: Georgia (source: firm default)')
  })

  it('unset jurisdiction: the explicit NOT SET instruction, never a silent omission or a guessed state', () => {
    const block = buildSystemFactsBlock({ jurisdiction: null, todayIso: '2026-07-20T00:00:00Z' })
    expect(block).toContain(
      'Governing jurisdiction: NOT SET — do not assume any state; write "Governing law to be confirmed"',
    )
  })

  it('omits the firm-name line when the firm has none on file (honest unset, never a default)', () => {
    const unset = buildSystemFactsBlock({ jurisdiction: NC, todayIso: '2026-07-20T00:00:00Z' })
    expect(unset).not.toContain('Firm name:')
    const blank = buildSystemFactsBlock({
      jurisdiction: NC,
      todayIso: '2026-07-20T00:00:00Z',
      firmName: '   ',
    })
    expect(blank).not.toContain('Firm name:')
  })

  // EDITOR-FIX-1 (item 5): the shared formatting/drafting standards ride the
  // system-facts block, so every path that assembles a draft through the
  // system-facts seam carries them.
  it('carries the shared formatting/drafting standards', () => {
    const block = buildSystemFactsBlock({ jurisdiction: NC, todayIso: '2026-07-20T00:00:00Z' })
    expect(block).toContain(FORMATTING_DIRECTIVES)
  })
})

// ── FORMATTING_DIRECTIVES (item 5) ───────────────────────────────────────────
describe('FORMATTING_DIRECTIVES — the one formatting block in every generation', () => {
  it('states the founder-priority standards (snapshot)', () => {
    // Title Case / correct capitalization, bolding, robust register, and the
    // hard ban on underscore/dash signature+date lines (canonical markers only).
    expect(FORMATTING_DIRECTIVES).toContain('Title Case')
    expect(FORMATTING_DIRECTIVES).toContain('bold')
    expect(FORMATTING_DIRECTIVES).toContain('NEVER draw signature, date, or execution lines')
    expect(FORMATTING_DIRECTIVES).toContain('{{sign:key}}')
    expect(FORMATTING_DIRECTIVES).toContain('{{date:key}}')
    expect(FORMATTING_DIRECTIVES).toMatchSnapshot()
  })

  it('lands in the AI draft path (via the system-facts seam)', () => {
    const prompt = assembleDraftingPrompt({
      basePrompt: basePrompt(),
      template: 'TEMPLATE BODY',
      questionnaireResponses: { company_name: 'Acme LLC' },
      transcriptText: 'Members agreed on terms.',
      documentKind: 'operating_agreement',
      systemFactsText: buildSystemFactsBlock({ jurisdiction: NC, todayIso: '2026-07-20T00:00:00Z' }),
    })
    expect(prompt).toContain(FORMATTING_DIRECTIVES)
  })

  it('lands in the Edit-with-AI revision path', () => {
    const prompt = buildRevisionPrompt({
      currentMarkdown: 'The Agreement.',
      documentKind: 'operating_agreement',
      instruction: 'Make the tone firmer.',
      jurisdictionDisplayName: 'North Carolina',
    })
    expect(prompt).toContain(FORMATTING_DIRECTIVES)
  })
})

// ── assembleDraftingPrompt + system facts ────────────────────────────────────

const REQUIRED_SLOTS = [
  '{{questionnaire_responses_json}}',
  '{{transcript_text}}',
  '{{operating_agreement_template}}',
]

function basePrompt(): string {
  return [
    'Draft an LLC operating agreement.',
    '## Questionnaire',
    '{{questionnaire_responses_json}}',
    '## Transcript',
    '{{transcript_text}}',
    '## Template',
    '{{operating_agreement_template}}',
  ].join('\n')
}

describe('assembleDraftingPrompt — system facts land first', () => {
  const args = {
    basePrompt: basePrompt(),
    template: 'TEMPLATE BODY',
    questionnaireResponses: { company_name: 'Acme LLC' },
    transcriptText: 'Members agreed on terms.',
    documentKind: 'operating_agreement',
  }

  it('jurisdiction SET: the prompt opens with the system-facts block, slots still fill (snapshot)', () => {
    const prompt = assembleDraftingPrompt({
      ...args,
      systemFactsText: buildSystemFactsBlock({
        jurisdiction: NC,
        todayIso: '2026-07-20T00:00:00Z',
        firmName: 'Pacheco Law Firm',
      }),
    })
    for (const slot of REQUIRED_SLOTS) expect(prompt).not.toContain(slot)
    expect(prompt.startsWith('--- System facts')).toBe(true)
    expect(prompt.indexOf('North Carolina')).toBeLessThan(prompt.indexOf('Draft an LLC'))
    expect(prompt).toMatchSnapshot()
  })

  it('jurisdiction UNSET: the honest-unset instruction opens the prompt (snapshot)', () => {
    const prompt = assembleDraftingPrompt({
      ...args,
      systemFactsText: buildSystemFactsBlock({
        jurisdiction: null,
        todayIso: '2026-07-20T00:00:00Z',
      }),
    })
    expect(prompt.startsWith('--- System facts')).toBe(true)
    expect(prompt).toContain('NOT SET — do not assume any state')
    expect(prompt).toMatchSnapshot()
  })

  it('system facts precede skills/digest/guidance — platform facts outrank nothing, they open the read', () => {
    const prompt = assembleDraftingPrompt({
      ...args,
      systemFactsText: 'FACTS-MARKER',
      activeSkillsText: 'SKILL-MARKER',
      serviceDigestText: 'DIGEST-MARKER',
      guidance: 'GUIDANCE-MARKER',
    })
    expect(prompt.indexOf('FACTS-MARKER')).toBe(0)
    expect(prompt.indexOf('SKILL-MARKER')).toBeLessThan(prompt.indexOf('DIGEST-MARKER'))
    expect(prompt.indexOf('DIGEST-MARKER')).toBeLessThan(prompt.indexOf('GUIDANCE-MARKER'))
  })

  it('no systemFactsText: byte-identical to the pre-fix assembly (existing callers unaffected)', () => {
    expect(assembleDraftingPrompt(args)).toBe(assembleDraftingPrompt({ ...args }))
    expect(assembleDraftingPrompt(args).startsWith('Draft an LLC')).toBe(true)
  })
})

// ── findUnresolvedTokens ─────────────────────────────────────────────────────

describe('findUnresolvedTokens', () => {
  it('finds every distinct raw token, de-duplicated, lower-cased, sorted', () => {
    const body =
      'This Agreement of {{company_name}} is effective {{effective_date}}.\n' +
      'Dissolution: {{ dissolution_terms }}. Again: {{Company_Name}}.'
    expect(findUnresolvedTokens(body)).toEqual([
      'company_name',
      'dissolution_terms',
      'effective_date',
    ])
  })

  it('returns [] for a fully-resolved body (the common case)', () => {
    expect(findUnresolvedTokens('This Agreement of Acme LLC is effective July 20, 2026.')).toEqual(
      [],
    )
    expect(findUnresolvedTokens('')).toEqual([])
  })

  it('excludes render-state artifacts and e-sign markers — they belong in the text', () => {
    const body =
      'Executed below.\n{{sign:client}}\nName: **Jane**\n{{date:client}}\n{{signature}}\n{{citation}}'
    expect(findUnresolvedTokens(body)).toEqual([])
  })
})

// ── buildDraftTraceJson — unresolved_tokens fold ─────────────────────────────

describe('buildDraftTraceJson — unresolved_tokens', () => {
  it('folds the token list into the stored trace even when the model reported no ambiguities', () => {
    const fullTrace = { evidence: [] as unknown[], ambiguities: [] as unknown[] }
    const result = buildDraftTraceJson(fullTrace, {
      unresolvedTokens: ['company_name', 'effective_date'],
    }) as Record<string, unknown>
    expect(result.unresolved_tokens).toEqual(['company_name', 'effective_date'])
    expect(result.ambiguities).toEqual([])
  })

  it('records an empty array honestly (scanned, nothing found) — distinct from never scanned', () => {
    const result = buildDraftTraceJson({ evidence: [] }, { unresolvedTokens: [] }) as Record<
      string,
      unknown
    >
    expect(result.unresolved_tokens).toEqual([])
  })

  it('stays a no-op when unresolvedTokens is not passed (pre-fix callers byte-identical)', () => {
    const fullTrace = { evidence: ['e1'], confidence: 0.8 }
    expect(buildDraftTraceJson(fullTrace, {})).toBe(fullTrace)
  })
})

// ── buildMatterEvidence — the jurisdiction FACT line ─────────────────────────

const ASSEMBLED_AT = '2026-07-20T12:00:00.000Z'
const MATTER_SCOPE: Extract<BriefScope, { kind: 'matter' }> = {
  kind: 'matter',
  matterEntityId: 'matter-1',
}
const EMPTY_HISTORY: MatterHistory = { actions: [], events: [] }

function matterMaterial(
  jurisdiction: ResolvedJurisdiction | null,
): Parameters<typeof buildMatterEvidence>[0] {
  const matter: MatterDetail = {
    matterEntityId: 'matter-1',
    matterNumber: '2026-001',
    clientName: 'Acme LLC',
    serviceKey: 'llc_formation',
    workflowRoute: 'manual',
    status: 'in_review',
    scheduledAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    practiceArea: 'llc_formation',
    summary: '',
    attributes: {},
    questionnaireResponses: null,
    transcriptText: null,
    latestDraftVersionId: null,
    latestDraftStatus: null,
    clientEmail: 'client@acme.test',
    clientEntityId: 'client-1',
    workflow: null,
    workflowRepairAvailable: false,
  }
  return {
    matter,
    history: EMPTY_HISTORY,
    notes: [],
    commBodies: [],
    commThreads: [],
    portalThread: [],
    draftDocs: [],
    uploadedDocs: [],
    tasks: [],
    meetings: [],
    invoiced: { items: [], currency: 'USD' },
    envelopes: [],
    research: [],
    jurisdiction,
  }
}

describe('buildMatterEvidence — governing-jurisdiction fact line', () => {
  it('states the resolved jurisdiction and its matter-fact source in the matter-core section', () => {
    const bundle = buildMatterEvidence(matterMaterial(NC), MATTER_SCOPE, 'balanced', ASSEMBLED_AT)
    const core = bundle.sections.find((s) => s.source === 'matter')
    expect(core!.content).toContain('Governing jurisdiction: North Carolina (source: matter fact).')
  })

  it('states the firm-default source when the matter fell through to the firm rung', () => {
    const bundle = buildMatterEvidence(
      matterMaterial(GA_FIRM),
      MATTER_SCOPE,
      'balanced',
      ASSEMBLED_AT,
    )
    const core = bundle.sections.find((s) => s.source === 'matter')
    expect(core!.content).toContain('Governing jurisdiction: Georgia (source: firm default).')
  })

  it('unset: says so plainly — the model grounds on "not set", never on a street address', () => {
    const bundle = buildMatterEvidence(matterMaterial(null), MATTER_SCOPE, 'balanced', ASSEMBLED_AT)
    const core = bundle.sections.find((s) => s.source === 'matter')
    expect(core!.content).toContain('Governing jurisdiction: not set — never asked at intake.')
  })
})

// ── buildBriefSynthesisPrompt — the never-infer rule ─────────────────────────

describe('buildBriefSynthesisPrompt — jurisdiction grounding rule', () => {
  const bundle: EvidenceBundle = {
    sections: [
      {
        source: 'matter',
        label: 'Matter core',
        content:
          'Matter 2026-001 — status: open.\nGoverning jurisdiction: North Carolina (source: firm default).',
        truncated: false,
      },
    ],
    sourceWatermark: '2026-07-15T10:00:00+00:00',
    assembledAt: ASSEMBLED_AT,
    scope: MATTER_SCOPE,
    budget: 'balanced',
  }

  it('carries BRIEF_JURISDICTION_RULE verbatim, in the rules list before the evidence fence', () => {
    const prompt = buildBriefSynthesisPrompt(bundle)
    expect(prompt).toContain(`- ${BRIEF_JURISDICTION_RULE}`)
    expect(prompt.indexOf(BRIEF_JURISDICTION_RULE)).toBeLessThan(
      prompt.indexOf(renderEvidenceBundle(bundle)),
    )
    expect(BRIEF_JURISDICTION_RULE).toMatch(/platform fact/)
    expect(BRIEF_JURISDICTION_RULE).toMatch(/never infer/)
    expect(BRIEF_JURISDICTION_RULE).toMatch(/address/)
  })
})
