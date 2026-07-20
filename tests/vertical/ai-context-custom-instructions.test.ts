// WP FB-B — custom instructions (firm + per-attorney), injected into the
// attorney chat's stable system half and the email-drafting prompt. Every
// assertion here is PURE string building (no DB, no live model): the composer
// (buildCustomInstructionsBlock / buildFirmInstructionsBlock) and its wiring
// into buildClaudeSystem, plus the email-prompt slot the same firm block fills
// (generateEmail.ts). The client portal never receives either block —
// client-facing, and firm instructions could leak internal guidance.
// WP FB-B2 — a THIRD, independent slot: portal_assistant_instructions, a
// SEPARATE client-safe field read ONLY by the client portal chat
// (buildPortalInstructionsBlock / buildBaseSystem's portalInstructions param).
// The tests below assert it is present/absent/clipped on the portal prompt the
// same way the internal blocks are on the attorney prompt, AND that the two
// internal fences (FIRM_HEADER / ATTORNEY_HEADER) never appear on the portal
// side while the portal-only fence never appears on the attorney side.
import { describe, it, expect } from 'vitest'
import {
  buildClaudeSystem,
  buildCustomInstructionsBlock,
  buildFirmInstructionsBlock,
  buildPortalInstructionsBlock,
  buildBaseSystem,
  loadEmailDraftingPrompt,
  type AssistantFirmFacts,
} from '@exsto/legal'

const FIRM_HEADER =
  '--- FIRM INSTRUCTIONS (standing guidance from this firm; follow unless it conflicts with the accuracy, no-invented-facts, or jurisdiction rules above) ---'
const ATTORNEY_HEADER = "--- YOUR ATTORNEY'S INSTRUCTIONS ---"
const PORTAL_HEADER =
  '--- FIRM GUIDANCE FOR CLIENT CONVERSATIONS (standing guidance from this firm for talking with its clients; follow unless it conflicts with the accuracy or no-invented-facts rules) ---'

describe('buildCustomInstructionsBlock — presence/absence', () => {
  it('empty string when both are unset', () => {
    expect(buildCustomInstructionsBlock()).toBe('')
    expect(buildCustomInstructionsBlock(undefined, undefined)).toBe('')
    expect(buildCustomInstructionsBlock('', '')).toBe('')
    expect(buildCustomInstructionsBlock('   ', '   ')).toBe('')
  })

  it('firm-only', () => {
    const out = buildCustomInstructionsBlock('Always CC my paralegal.', undefined)
    expect(out).toContain(FIRM_HEADER)
    expect(out).toContain('Always CC my paralegal.')
    expect(out).not.toContain(ATTORNEY_HEADER)
  })

  it('attorney-only', () => {
    const out = buildCustomInstructionsBlock(undefined, 'Keep drafts short.')
    expect(out).toContain(ATTORNEY_HEADER)
    expect(out).toContain('Keep drafts short.')
    expect(out).not.toContain(FIRM_HEADER)
  })

  it('both present, firm block first', () => {
    const out = buildCustomInstructionsBlock('Firm rule.', 'Attorney rule.')
    expect(out.indexOf(FIRM_HEADER)).toBeLessThan(out.indexOf(ATTORNEY_HEADER))
    expect(out).toContain('Firm rule.')
    expect(out).toContain('Attorney rule.')
  })
})

describe('buildCustomInstructionsBlock — clipped at 2,000 chars with a truncation marker', () => {
  it('clips firm instructions and adds a marker', () => {
    const long = 'x'.repeat(2500)
    const out = buildFirmInstructionsBlock(long)
    expect(out).toContain('x'.repeat(2000))
    expect(out).not.toContain('x'.repeat(2001))
    expect(out).toContain('…[truncated at 2000 characters]')
  })

  it('clips attorney instructions independently', () => {
    const longAttorney = 'y'.repeat(2500)
    const out = buildCustomInstructionsBlock(undefined, longAttorney)
    expect(out).toContain('y'.repeat(2000))
    expect(out).not.toContain('y'.repeat(2001))
    expect(out).toContain('…[truncated at 2000 characters]')
  })

  it('text at or under the cap is not marked truncated', () => {
    const exact = 'z'.repeat(2000)
    const out = buildFirmInstructionsBlock(exact)
    expect(out).toContain(exact)
    expect(out).not.toContain('truncated')
  })
})

describe('buildClaudeSystem — FB-B injection into the attorney chat stable half', () => {
  const firm: AssistantFirmFacts = { firmName: 'Acme Legal' }

  it('omitted entirely when unset — byte-identical to the pre-FB-B call shape', () => {
    const withoutParam = buildClaudeSystem('global', null, null, firm)
    const withExplicitEmpty = buildClaudeSystem('global', null, null, firm, '', '', '')
    expect(withoutParam).toBe(withExplicitEmpty)
    expect(withoutParam).not.toContain('FIRM INSTRUCTIONS')
    expect(withoutParam).not.toContain(ATTORNEY_HEADER)
  })

  it('present when the firm has set instructions', () => {
    const firmWithInstructions: AssistantFirmFacts = {
      ...firm,
      firmInstructions: 'Always CC my paralegal.',
    }
    const system = buildClaudeSystem('global', null, null, firmWithInstructions)
    expect(system).toContain(FIRM_HEADER)
    expect(system).toContain('Always CC my paralegal.')
  })

  it('present when the attorney has set instructions', () => {
    const system = buildClaudeSystem('global', null, null, firm, '', '', 'Keep drafts short.')
    expect(system).toContain(ATTORNEY_HEADER)
    expect(system).toContain('Keep drafts short.')
  })

  it('lands AFTER the base prompt\'s accuracy/no-invented-facts/jurisdiction rules (the fence says "above")', () => {
    const firmWithInstructions: AssistantFirmFacts = {
      ...firm,
      firmInstructions: 'Always CC my paralegal.',
    }
    const system = buildClaudeSystem('global', null, null, firmWithInstructions)
    expect(system.indexOf('ACCURACY OVER COMPLETENESS')).toBeLessThan(system.indexOf(FIRM_HEADER))
    expect(system.indexOf('NO INVENTED MATTER FACTS')).toBeLessThan(system.indexOf(FIRM_HEADER))
    expect(system.indexOf('JURISDICTION BEFORE YOU DRAFT')).toBeLessThan(
      system.indexOf(FIRM_HEADER),
    )
  })
})

describe('the client portal never carries either INTERNAL instructions block', () => {
  it('buildBaseSystem (portal) with no portal instructions never emits the internal fences', () => {
    const portal = buildBaseSystem('Acme Legal')
    expect(portal).not.toContain('FIRM INSTRUCTIONS')
    expect(portal).not.toContain(ATTORNEY_HEADER)
  })

  it('buildBaseSystem (portal) with portal instructions SET still never emits the internal fences', () => {
    // The internal FIRM INSTRUCTIONS / attorney-instructions fences must never
    // reach the portal even when the (separate, client-safe) portal block is
    // populated — buildBaseSystem structurally has no parameter for the
    // internal blocks at all, so this proves the wiring, not just the string.
    const portal = buildBaseSystem('Acme Legal', undefined, 'Always mention our office hours.')
    expect(portal).not.toContain('FIRM INSTRUCTIONS')
    expect(portal).not.toContain(ATTORNEY_HEADER)
    expect(portal).toContain(PORTAL_HEADER)
  })
})

describe('buildPortalInstructionsBlock — WP FB-B2, presence/absence/clipping', () => {
  it('empty string when unset', () => {
    expect(buildPortalInstructionsBlock()).toBe('')
    expect(buildPortalInstructionsBlock(undefined)).toBe('')
    expect(buildPortalInstructionsBlock('')).toBe('')
    expect(buildPortalInstructionsBlock('   ')).toBe('')
  })

  it('present when set', () => {
    const out = buildPortalInstructionsBlock('Mention our office closes at 5pm.')
    expect(out).toContain(PORTAL_HEADER)
    expect(out).toContain('Mention our office closes at 5pm.')
  })

  it('clipped at 2,000 chars with a truncation marker', () => {
    const long = 'p'.repeat(2500)
    const out = buildPortalInstructionsBlock(long)
    expect(out).toContain('p'.repeat(2000))
    expect(out).not.toContain('p'.repeat(2001))
    expect(out).toContain('…[truncated at 2000 characters]')
  })

  it('text at or under the cap is not marked truncated', () => {
    const exact = 'q'.repeat(2000)
    const out = buildPortalInstructionsBlock(exact)
    expect(out).toContain(exact)
    expect(out).not.toContain('truncated')
  })
})

describe('buildBaseSystem (portal) — WP FB-B2 injection', () => {
  it('omitted entirely when unset — byte-identical to the pre-FB-B2 call shape', () => {
    const withoutParam = buildBaseSystem('Acme Legal')
    const withExplicitEmpty = buildBaseSystem('Acme Legal', undefined, '')
    expect(withoutParam).toBe(withExplicitEmpty)
    expect(withoutParam).not.toContain(PORTAL_HEADER)
  })

  it('present when the firm has set portal instructions', () => {
    const portal = buildBaseSystem('Acme Legal', undefined, 'Mention our office closes at 5pm.')
    expect(portal).toContain(PORTAL_HEADER)
    expect(portal).toContain('Mention our office closes at 5pm.')
  })

  it('lands after the ask-vs-guess / no-invented-facts rules (the fence says "the accuracy or no-invented-facts rules")', () => {
    const portal = buildBaseSystem('Acme Legal', undefined, 'Mention our office closes at 5pm.')
    expect(portal.indexOf('NO INVENTED MATTER FACTS')).toBeLessThan(portal.indexOf(PORTAL_HEADER))
    expect(portal.indexOf("ASK, DON'T GUESS")).toBeLessThan(portal.indexOf(PORTAL_HEADER))
  })
})

describe('attorney chat never carries the portal-only instructions block', () => {
  it('buildClaudeSystem has no portal-instructions parameter and never emits the portal fence', () => {
    const firm: AssistantFirmFacts = {
      firmName: 'Acme Legal',
      firmInstructions: 'Always CC my paralegal.',
    }
    const system = buildClaudeSystem('global', null, null, firm, '', '', 'Keep drafts short.')
    expect(system).not.toContain(PORTAL_HEADER)
    expect(system).not.toContain('FOR CLIENT CONVERSATIONS')
  })
})

describe('email-drafting-prompt.md {{firm_instructions}} slot — filled/empty-safe', () => {
  it('the raw template carries the slot, untouched by loader-time composition', () => {
    // loadEmailDraftingPrompt only composes {{house_voice_doctrine}} at load
    // time (STYLE-FIX-2); {{firm_instructions}} is per-call DATA, filled by
    // composeEmailDraft (generateEmail.ts) the same way {{purpose}} is.
    const prompt = loadEmailDraftingPrompt()
    expect(prompt).toContain('{{firm_instructions}}')
  })

  it('empty-safe: filling with buildFirmInstructionsBlock(undefined) leaves no stray header', () => {
    const filled = loadEmailDraftingPrompt().replaceAll('{{firm_instructions}}', () =>
      buildFirmInstructionsBlock(undefined),
    )
    expect(filled).not.toContain('{{firm_instructions}}')
    expect(filled).not.toContain('FIRM INSTRUCTIONS')
  })

  it('filled: the firm block lands in the prompt when set, so "always CC my paralegal" bites', () => {
    const filled = loadEmailDraftingPrompt().replaceAll('{{firm_instructions}}', () =>
      buildFirmInstructionsBlock('Always CC my paralegal, paralegal@ourfirm.com.'),
    )
    expect(filled).toContain(FIRM_HEADER)
    expect(filled).toContain('Always CC my paralegal, paralegal@ourfirm.com.')
  })
})
