// WP B1 — service digest → drafting injection ("generation gets smarter from
// accepted edits"). The DB-reading half (assembleBriefEvidence over the
// service_digest scope, already proven by brief-evidence.test.ts) is untouched
// by this WP; what's new here is entirely pure and testable without a live DB
// or Claude key (mirrors how multi-member-drafting.test.ts exercises
// assembleDraftingPrompt's no-live-key path):
//   - assembleDraftingPrompt's layering: skills < service digest < guidance,
//     each outranking the one before it, ending with the attorney's own
//     instructions for THIS draft;
//   - shouldAssembleServiceDigest: the AI-path-only, opt-out, has-a-service gate
//     (defensively checks generationMode too, so template_merge can never see
//     AI-sourced context even if a future refactor moves the call site earlier);
//   - renderServiceDigestForDraft: "no signals yet" (empty bundle) renders
//     nothing rather than an empty/misleading header, and the rendered text is
//     honestly char-capped;
//   - buildDraftTraceJson: the reasoning-trace jsonb fold is additive and a
//     no-op for any caller that never sets the new fields (byte-identical to
//     pre-WP-B1 behavior).
import { describe, it, expect } from 'vitest'
import {
  assembleDraftingPrompt,
  buildDraftTraceJson,
  renderServiceDigestForDraft,
  shouldAssembleServiceDigest,
  type EvidenceBundle,
} from '@exsto/legal'

const REQUIRED_SLOTS = [
  '{{questionnaire_responses_json}}',
  '{{transcript_text}}',
  '{{operating_agreement_template}}',
]

function basePrompt(): string {
  return [
    'Draft an NC LLC operating agreement.',
    '## Questionnaire',
    '{{questionnaire_responses_json}}',
    '## Transcript',
    '{{transcript_text}}',
    '## Template',
    '{{operating_agreement_template}}',
  ].join('\n')
}

// ── assembleDraftingPrompt — layering order ─────────────────────────────────

describe('assembleDraftingPrompt — skills < service digest < guidance', () => {
  it('appends in order: base (slots filled) → active skills → service digest → attorney guidance', () => {
    const prompt = assembleDraftingPrompt({
      basePrompt: basePrompt(),
      template: 'TEMPLATE BODY',
      questionnaireResponses: { company_name: 'Acme LLC' },
      transcriptText: 'Members agreed on terms.',
      documentKind: 'operating_agreement',
      activeSkillsText: 'SKILL-MARKER: NC LLC playbook',
      serviceDigestText: 'DIGEST-MARKER: standing preferences',
      guidance: 'GUIDANCE-MARKER: shorten section 4',
    })
    for (const slot of REQUIRED_SLOTS) expect(prompt).not.toContain(slot)

    const skillIdx = prompt.indexOf('SKILL-MARKER')
    const digestIdx = prompt.indexOf('DIGEST-MARKER')
    const guidanceIdx = prompt.indexOf('GUIDANCE-MARKER')
    expect(skillIdx).toBeGreaterThan(-1)
    expect(digestIdx).toBeGreaterThan(-1)
    expect(guidanceIdx).toBeGreaterThan(-1)
    expect(skillIdx).toBeLessThan(digestIdx)
    expect(digestIdx).toBeLessThan(guidanceIdx)
  })

  it('the digest still lands before guidance when no skills were selected', () => {
    const prompt = assembleDraftingPrompt({
      basePrompt: basePrompt(),
      template: 'TEMPLATE BODY',
      questionnaireResponses: {},
      transcriptText: 'x',
      documentKind: 'operating_agreement',
      serviceDigestText: 'DIGEST-MARKER',
      guidance: 'GUIDANCE-MARKER',
    })
    expect(prompt.indexOf('DIGEST-MARKER')).toBeLessThan(prompt.indexOf('GUIDANCE-MARKER'))
  })

  it('digest absent (undefined serviceDigestText): no digest text appears, base/skills/guidance unaffected', () => {
    const withDigest = assembleDraftingPrompt({
      basePrompt: basePrompt(),
      template: 'TEMPLATE BODY',
      questionnaireResponses: {},
      transcriptText: 'x',
      documentKind: 'operating_agreement',
      activeSkillsText: 'SKILL-MARKER',
      guidance: 'GUIDANCE-MARKER',
    })
    expect(withDigest).not.toContain('DIGEST-MARKER')
    expect(withDigest).toContain('SKILL-MARKER')
    expect(withDigest).toContain('GUIDANCE-MARKER')
  })

  it('a whitespace-only serviceDigestText is treated as absent (same trim() convention as guidance/skills)', () => {
    const prompt = assembleDraftingPrompt({
      basePrompt: basePrompt(),
      template: 'TEMPLATE BODY',
      questionnaireResponses: {},
      transcriptText: 'x',
      documentKind: 'operating_agreement',
      serviceDigestText: '   \n  ',
    })
    // No stray blank-section artifact from an all-whitespace digest.
    expect(prompt.trim().endsWith('TEMPLATE BODY')).toBe(true)
  })
})

// ── shouldAssembleServiceDigest — the gate ──────────────────────────────────

describe('shouldAssembleServiceDigest', () => {
  it('is true for the default case: ai_draft, a service key, useServiceDigest unset', () => {
    expect(shouldAssembleServiceDigest('ai_draft', 'nc_llc_single_member', undefined)).toBe(true)
  })

  it('is true when useServiceDigest is explicitly true', () => {
    expect(shouldAssembleServiceDigest('ai_draft', 'nc_llc_single_member', true)).toBe(true)
  })

  it('is false when useServiceDigest is explicitly false (the capability_config opt-out)', () => {
    expect(shouldAssembleServiceDigest('ai_draft', 'nc_llc_single_member', false)).toBe(false)
  })

  it('is false for template_merge regardless of useServiceDigest (deterministic path must never see AI context)', () => {
    expect(shouldAssembleServiceDigest('template_merge', 'nc_llc_single_member', undefined)).toBe(
      false,
    )
    expect(shouldAssembleServiceDigest('template_merge', 'nc_llc_single_member', true)).toBe(false)
  })

  it('is false when the matter has no service key', () => {
    expect(shouldAssembleServiceDigest('ai_draft', '', undefined)).toBe(false)
    expect(shouldAssembleServiceDigest('ai_draft', null, undefined)).toBe(false)
    expect(shouldAssembleServiceDigest('ai_draft', undefined, undefined)).toBe(false)
  })
})

// ── renderServiceDigestForDraft ─────────────────────────────────────────────

function digestBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    sections: [
      {
        source: 'accepted_revisions',
        label: 'Accepted AI revision instructions',
        content: '- [2026-001 · operating_agreement v2] Make the indemnification clause mutual.',
        truncated: false,
      },
    ],
    sourceWatermark: '2026-07-15T10:00:00+00:00',
    assembledAt: '2026-07-17T12:00:00.000Z',
    scope: { kind: 'service_digest', serviceKey: 'nc_llc_single_member' },
    budget: 'lean',
    ...overrides,
  }
}

describe('renderServiceDigestForDraft', () => {
  it('returns null for an empty bundle (service has no signals yet — not a failure)', () => {
    expect(renderServiceDigestForDraft(digestBundle({ sections: [] }))).toBeNull()
  })

  it('renders the framing header + evidence, and reports honest trace metadata', () => {
    const bundle = digestBundle()
    const result = renderServiceDigestForDraft(bundle)
    expect(result).not.toBeNull()
    expect(result!.text).toContain('Standing drafting preferences')
    expect(result!.text).toContain("attorney's instructions for THIS draft")
    expect(result!.text).toContain('Make the indemnification clause mutual')
    expect(result!.meta).toEqual({
      watermark: bundle.sourceWatermark,
      sections: 1,
      chars: result!.text.length,
    })
  })

  it('caps the rendered digest text at ~2.5k chars', () => {
    const bigBundle = digestBundle({
      sections: [
        {
          source: 'accepted_revisions',
          label: 'Accepted AI revision instructions',
          content: 'x'.repeat(10_000),
          truncated: false,
        },
      ],
    })
    const result = renderServiceDigestForDraft(bigBundle)
    expect(result!.text.length).toBeLessThan(2600)
    expect(result!.text).toContain('…[truncated]')
    expect(result!.meta.chars).toBe(result!.text.length)
  })
})

// ── buildDraftTraceJson — reasoning-trace jsonb fold ────────────────────────

describe('buildDraftTraceJson', () => {
  it('returns fullTrace UNCHANGED when neither prompt/template id nor serviceDigest are given (pre-WP-B1 behavior)', () => {
    const fullTrace = { evidence: ['e1'], confidence: 0.8 }
    expect(buildDraftTraceJson(fullTrace, {})).toBe(fullTrace)
  })

  it('folds prompt_config when promptId/templateId are given (unchanged from before)', () => {
    const fullTrace = { evidence: [] as unknown[] }
    const result = buildDraftTraceJson(fullTrace, {
      promptId: 'svc/doc@config-v1',
      templateId: 'doc@template-repo',
    }) as Record<string, unknown>
    expect(result.prompt_config).toEqual({
      prompt_id: 'svc/doc@config-v1',
      template_id: 'doc@template-repo',
    })
  })

  it('folds service_digest: null when the digest was attempted but did not fire', () => {
    const fullTrace = { evidence: [] as unknown[] }
    const result = buildDraftTraceJson(fullTrace, { serviceDigest: null }) as Record<
      string,
      unknown
    >
    expect(result.service_digest).toBeNull()
  })

  it('folds the service_digest metadata object when the digest fired', () => {
    const fullTrace = { evidence: [] as unknown[] }
    const meta = { watermark: '2026-07-15T10:00:00+00:00', sections: 2, chars: 900 }
    const result = buildDraftTraceJson(fullTrace, { serviceDigest: meta }) as Record<
      string,
      unknown
    >
    expect(result.service_digest).toEqual(meta)
  })

  it('folds prompt_config AND service_digest together, alongside the original fields', () => {
    const fullTrace = { evidence: ['e1'], confidence: 0.7 }
    const result = buildDraftTraceJson(fullTrace, {
      promptId: 'p',
      templateId: 't',
      serviceDigest: { watermark: 'w', sections: 1, chars: 10 },
    }) as Record<string, unknown>
    expect(result.evidence).toEqual(['e1'])
    expect(result.confidence).toBe(0.7)
    expect(result.prompt_config).toBeDefined()
    expect(result.service_digest).toBeDefined()
  })

  it('leaves a non-object fullTrace (or none) untouched even when extras are supplied', () => {
    expect(buildDraftTraceJson(undefined, { promptId: 'p' })).toBeUndefined()
    expect(buildDraftTraceJson('not-an-object', { serviceDigest: null })).toBe('not-an-object')
  })
})
