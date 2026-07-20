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
  ASK_DONT_GUESS,
  NO_INVENTED_MATTER_FACTS,
  REPLY_LANGUAGE,
  CHAT_VOICE,
  JURISDICTION_DRAFT_DISCIPLINE,
  portalLocaleLine,
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

// ── WP A3 — the five shared/attorney discipline blocks land on the right
// surface(s), and the portal locale hint renders for Spanish. The snapshots
// above already lock the FULL attorney prompt wording; these pin which block
// belongs where (attorney vs portal) and the per-request locale behaviour. ──
describe('WP A3 — discipline blocks are present on the right surface(s)', () => {
  const attorney = buildBaseSystemPrompt({ firmName: 'Acme Legal' })
  const portal = buildBaseSystem('Acme Legal')

  it('attorney chat carries all five blocks (jurisdiction discipline is attorney-only)', () => {
    expect(attorney).toContain(JURISDICTION_DRAFT_DISCIPLINE)
    expect(attorney).toContain(ASK_DONT_GUESS)
    expect(attorney).toContain(NO_INVENTED_MATTER_FACTS)
    expect(attorney).toContain(REPLY_LANGUAGE)
    expect(attorney).toContain(CHAT_VOICE)
  })

  it('portal chat carries the four shared blocks but NOT jurisdiction discipline', () => {
    expect(portal).toContain(ASK_DONT_GUESS)
    expect(portal).toContain(NO_INVENTED_MATTER_FACTS)
    expect(portal).toContain(REPLY_LANGUAGE)
    expect(portal).toContain(CHAT_VOICE)
    // The portal bot does not draft or state law, so the drafting-jurisdiction
    // rule must not leak onto the client surface.
    expect(portal).not.toContain(JURISDICTION_DRAFT_DISCIPLINE)
  })

  it('CHAT VOICE stays formatting-neutral so it never overrides attorney bullets', () => {
    // The attorney surface keeps its STRUCTURED READ-OUTS ARE BULLETS rule; the
    // shared voice block must not itself dictate bullet vs prose.
    expect(CHAT_VOICE).not.toMatch(/bullet/i)
    expect(attorney).toContain('STRUCTURED READ-OUTS ARE BULLETS')
  })
})

describe('WP A3 — portal locale hint', () => {
  it("renders the Spanish default line only for 'es'", () => {
    expect(portalLocaleLine('es')).toContain('default to Spanish')
    expect(portalLocaleLine('en')).toBe('')
    expect(portalLocaleLine(undefined)).toBe('')
  })

  it("threads into the portal prompt for 'es' and is absent otherwise", () => {
    expect(buildBaseSystem('Acme Legal', 'es')).toContain('default to Spanish')
    expect(buildBaseSystem('Acme Legal', 'en')).not.toContain('default to Spanish')
    expect(buildBaseSystem('Acme Legal')).not.toContain('default to Spanish')
  })
})

// Snapshot the portal base prompt too — like the attorney prompt above, its
// wording is a reviewed artifact, so a change to any shared block or the locale
// hint shows up as a deliberate snapshot diff.
describe('buildBaseSystem (portal) — snapshots', () => {
  it('firm portal prompt, no locale hint', () => {
    expect(buildBaseSystem('Acme Legal')).toMatchSnapshot()
  })

  it('firm portal prompt with the Spanish locale hint', () => {
    expect(buildBaseSystem('Acme Legal', 'es')).toMatchSnapshot()
  })
})
