// WP A2 — de-hardcode jurisdiction + firm identity in the AI runtime. Every
// prompt-building surface used to hardcode "Pacheco Law" and/or North
// Carolina; now each takes the firm's own facts (name, resolved jurisdiction,
// practice areas) and degrades to an honest, jurisdiction-free description
// when the firm hasn't set one — never a guessed 'NC'. All PURE string
// building (no DB, no live model), so these run with zero fixtures.
import { describe, it, expect } from 'vitest'
import {
  buildBaseSystemPrompt,
  buildBaseSystem,
  buildRevisionPrompt,
  buildFirmJurisdictionLine,
  buildResearchJurisdictionLine,
  jurisdictionDisplayName,
  type AssistantFirmFacts,
} from '@exsto/legal'

const NC = jurisdictionDisplayName('NC') // 'North Carolina'

// ── SNAPSHOT — buildBaseSystemPrompt (attorney chat) across firm-name x
// jurisdiction variants ─────────────────────────────────────────────────────
describe('buildBaseSystemPrompt — snapshots', () => {
  it('a firm with no jurisdiction and no practice areas set', () => {
    const firm: AssistantFirmFacts = { firmName: 'Acme Legal' }
    expect(buildBaseSystemPrompt(firm)).toMatchSnapshot()
  })

  it('Pacheco Law with NC + practice areas set (the original firm, still parametrized)', () => {
    const firm: AssistantFirmFacts = {
      firmName: 'Pacheco Law Firm',
      attorneyName: 'Juan Carlos Pacheco',
      jurisdictionCode: 'NC',
      jurisdictionDisplayName: NC!,
      practiceAreas: ['business law'],
    }
    expect(buildBaseSystemPrompt(firm)).toMatchSnapshot()
  })

  it('a different firm/jurisdiction proves the prompt is truly parametrized, not NC-shaped', () => {
    const firm: AssistantFirmFacts = {
      firmName: 'Rivera & Partners',
      jurisdictionCode: 'TX',
      jurisdictionDisplayName: jurisdictionDisplayName('TX')!,
      practiceAreas: ['immigration', 'family law'],
    }
    expect(buildBaseSystemPrompt(firm)).toMatchSnapshot()
  })
})

describe('buildBaseSystemPrompt — jurisdiction sentence', () => {
  it('names the jurisdiction and defers to the matter when set', () => {
    const system = buildBaseSystemPrompt({
      firmName: 'Pacheco Law Firm',
      jurisdictionCode: 'NC',
      jurisdictionDisplayName: NC!,
    })
    expect(system).toContain(
      "The firm's home jurisdiction is North Carolina; use it as default, but the matter's own governing law wins when it differs.",
    )
  })

  it('tells the model to ask, never assume, when unset', () => {
    const system = buildBaseSystemPrompt({ firmName: 'Acme Legal' })
    expect(system).toContain(
      'The firm has not set a home jurisdiction (Settings → Firm). NEVER assume one — ask.',
    )
  })
})

// ── THE ZERO-LEAK TEST — a fully-unset firm must never surface "Pacheco",
// "NC", or "North Carolina" anywhere in the AI runtime's prompts: the
// attorney chat base prompt, the client-portal chat prompt, the AI-revision
// prompt, and the non-confidential Perplexity research framing. ───────────
describe('a fully-unset firm leaks no Pacheco/NC/North Carolina identity', () => {
  const FORBIDDEN = [/Pacheco/i, /\bNC\b/, /North Carolina/i]

  function assertClean(label: string, text: string): void {
    for (const pattern of FORBIDDEN) {
      expect(text, `${label} matched ${pattern}`).not.toMatch(pattern)
    }
  }

  it('chat prompt (attorney assistant base system prompt)', () => {
    assertClean('chat prompt', buildBaseSystemPrompt({ firmName: 'the firm' }))
  })

  it('portal prompt (client-portal assistant base system prompt)', () => {
    assertClean('portal prompt', buildBaseSystem('the firm'))
  })

  it('revise prompt (AI document revision)', () => {
    const prompt = buildRevisionPrompt({
      currentMarkdown: 'Some document body.',
      documentKind: 'operating_agreement',
      instruction: 'Tighten section 2.',
      jurisdictionDisplayName: null,
    })
    assertClean('revise prompt', prompt)
    // The unset-jurisdiction guidance fires instead of a guess.
    expect(prompt).toContain('the governing jurisdiction is NOT SET — do not assume one')
    expect(prompt).toContain('Governing law to be confirmed')
  })

  it('Perplexity framing (firm-wide and matter-scoped)', () => {
    const unsetFirm = { firmJurisdiction: null, practiceAreas: null }
    assertClean('firm-wide framing', buildFirmJurisdictionLine(unsetFirm))
    assertClean(
      'matter-scoped framing (no matter jurisdiction either)',
      buildResearchJurisdictionLine(null, unsetFirm),
    )
    expect(buildFirmJurisdictionLine(unsetFirm)).toBe('U.S. law firm')
  })
})

// ── Pacheco-with-NC keeps its jurisdiction content — de-hardcoding must not
// mean stripping jurisdiction awareness for the firm that HAS one set. ─────
describe('a firm with NC set keeps full jurisdiction content', () => {
  it('chat prompt names North Carolina as the default', () => {
    const system = buildBaseSystemPrompt({
      firmName: 'Pacheco Law Firm',
      jurisdictionCode: 'NC',
      jurisdictionDisplayName: NC!,
    })
    expect(system).toContain('North Carolina')
  })

  it('revise prompt cites North Carolina law', () => {
    const prompt = buildRevisionPrompt({
      currentMarkdown: 'Some document body.',
      documentKind: 'operating_agreement',
      instruction: 'Tighten section 2.',
      jurisdictionDisplayName: NC!,
    })
    expect(prompt).toContain('under North Carolina law.')
  })

  it('Perplexity framing names North Carolina', () => {
    const line = buildFirmJurisdictionLine({ firmJurisdiction: 'NC', practiceAreas: null })
    expect(line).toBe('U.S. North Carolina business-law firm')
  })

  it('matter-scoped framing prefers the MATTER jurisdiction over the firm default', () => {
    const line = buildResearchJurisdictionLine(
      { code: 'CA', displayName: 'California', source: 'matter' },
      { firmJurisdiction: 'NC', practiceAreas: null },
    )
    expect(line).toBe('U.S. California business-law firm')
  })
})
