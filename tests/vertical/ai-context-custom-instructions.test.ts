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
import { normalizeFirmProfileFieldValue } from '../../verticals/legal/src/handlers/firmProfile.js'

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

// ITEM-12 WP-2 — instructions as pills. Joe: "the instructions for each chat
// need [to] save as pills when you put an instruction in and hit enter."
// customInstructions / assistant_instructions / portal_assistant_instructions
// are now saved as string[] (one item per pill) instead of one free-text
// blob. Every block builder above already accepts `string | string[]` — these
// tests lock in: an array renders as bullet lines, a legacy plain string
// (pre-WP-2 data) still renders verbatim, the 2,000-char clip still bites on
// the combined bulleted text, and the portal/attorney fence isolation proven
// above for string input still holds for array input.
describe('instructions as pills — array input renders as bullet lines', () => {
  it('buildFirmInstructionsBlock: one "- item" bullet per array entry', () => {
    const out = buildFirmInstructionsBlock([
      'Always CC my paralegal.',
      'Flag anything touching immigration status.',
    ])
    expect(out).toContain(FIRM_HEADER)
    expect(out).toContain('- Always CC my paralegal.')
    expect(out).toContain('- Flag anything touching immigration status.')
  })

  it('buildCustomInstructionsBlock: bullets on both the firm and attorney halves independently', () => {
    const out = buildCustomInstructionsBlock(
      ['Firm rule one.', 'Firm rule two.'],
      ['Attorney rule one.', 'Attorney rule two.'],
    )
    expect(out).toContain('- Firm rule one.')
    expect(out).toContain('- Firm rule two.')
    expect(out).toContain('- Attorney rule one.')
    expect(out).toContain('- Attorney rule two.')
    expect(out.indexOf(FIRM_HEADER)).toBeLessThan(out.indexOf(ATTORNEY_HEADER))
  })

  it('buildPortalInstructionsBlock: bullets, same as the internal blocks', () => {
    const out = buildPortalInstructionsBlock([
      'Mention our office closes at 5pm.',
      'Never quote a fee over chat.',
    ])
    expect(out).toContain(PORTAL_HEADER)
    expect(out).toContain('- Mention our office closes at 5pm.')
    expect(out).toContain('- Never quote a fee over chat.')
  })

  it('an empty array behaves exactly like unset — no header, no bullets', () => {
    expect(buildFirmInstructionsBlock([])).toBe('')
    expect(buildPortalInstructionsBlock([])).toBe('')
    expect(buildCustomInstructionsBlock([], [])).toBe('')
  })

  it('array items are trimmed and blank entries dropped before bulleting', () => {
    const out = buildFirmInstructionsBlock(['  Always CC my paralegal.  ', '   ', ''])
    expect(out).toContain('- Always CC my paralegal.')
    // No stray bullet for the blank/whitespace-only entries.
    expect(out.match(/^- /gm)?.length).toBe(1)
  })
})

describe('instructions as pills — a legacy plain string (pre-WP-2 data) still renders verbatim', () => {
  it('buildFirmInstructionsBlock: no bullet prefix for a bare string', () => {
    const out = buildFirmInstructionsBlock('Always CC my paralegal.')
    expect(out).toContain(FIRM_HEADER)
    expect(out).toContain('Always CC my paralegal.')
    expect(out).not.toContain('- Always CC my paralegal.')
  })

  it('buildPortalInstructionsBlock: no bullet prefix for a bare string', () => {
    const out = buildPortalInstructionsBlock('Mention our office closes at 5pm.')
    expect(out).toContain(PORTAL_HEADER)
    expect(out).not.toContain('- Mention our office closes at 5pm.')
  })

  it('buildCustomInstructionsBlock: a string firm block and a string attorney block mix freely', () => {
    const out = buildCustomInstructionsBlock('Firm rule.', 'Attorney rule.')
    expect(out).toContain('Firm rule.')
    expect(out).toContain('Attorney rule.')
    expect(out).not.toContain('- Firm rule.')
  })
})

describe('instructions as pills — the 2,000-char clip still bites on array input', () => {
  it('clips a single over-long pill (defensive backstop even though the UI caps items at 500 chars)', () => {
    const out = buildFirmInstructionsBlock(['x'.repeat(2500)])
    expect(out).toContain('- ' + 'x'.repeat(1998))
    expect(out).toContain('…[truncated at 2000 characters]')
  })

  it('clips the COMBINED bulleted text of many short pills once it crosses 2,000 chars', () => {
    // 25 items × ~90 chars each (with the "- " prefix and newline) comfortably
    // crosses the 2,000-char cap on the joined text.
    const items = Array.from({ length: 25 }, (_, i) => `Instruction number ${i}: `.padEnd(90, 'x'))
    const out = buildFirmInstructionsBlock(items)
    expect(out).toContain('…[truncated at 2000 characters]')
  })

  it('a short array under the cap is not marked truncated', () => {
    const out = buildFirmInstructionsBlock(['Always CC my paralegal.'])
    expect(out).not.toContain('truncated')
  })
})

describe('instructions as pills — portal/attorney fence isolation holds for array input too', () => {
  it('buildBaseSystem (portal) with array portal instructions never emits the internal fences', () => {
    const portal = buildBaseSystem('Acme Legal', undefined, [
      'Always mention our office hours.',
      'Never promise a case outcome.',
    ])
    expect(portal).not.toContain('FIRM INSTRUCTIONS')
    expect(portal).not.toContain(ATTORNEY_HEADER)
    expect(portal).toContain(PORTAL_HEADER)
    expect(portal).toContain('- Always mention our office hours.')
  })

  it('buildClaudeSystem (attorney) with array firm/attorney instructions never emits the portal fence', () => {
    const firm: AssistantFirmFacts = {
      firmName: 'Acme Legal',
      firmInstructions: ['Always CC my paralegal.'],
    }
    const system = buildClaudeSystem('global', null, null, firm, '', '', ['Keep drafts short.'])
    expect(system).not.toContain(PORTAL_HEADER)
    expect(system).not.toContain('FOR CLIENT CONVERSATIONS')
    expect(system).toContain('- Always CC my paralegal.')
    expect(system).toContain('- Keep drafts short.')
  })
})

describe('instructions as pills — round-trip through each store', () => {
  // FIRM STORE (firm_profile.assistant_instructions / portal_assistant_instructions):
  // the handler's array normalizer (firmProfile.ts) is the write path; the
  // block builders (assistantPrompt.ts) are the read/render path. Piping one
  // straight into the other proves the two agree on shape without a live DB.
  it('firm store: normalizeFirmProfileFieldValue output renders correctly through buildFirmInstructionsBlock', () => {
    const normalized = normalizeFirmProfileFieldValue('assistant_instructions', [
      '  Always CC my paralegal.  ',
      'Always CC my paralegal.', // duplicate, case-identical — deduped by the normalizer
      'Flag immigration matters.',
    ]) as string[]
    expect(normalized).toEqual(['Always CC my paralegal.', 'Flag immigration matters.'])
    const rendered = buildFirmInstructionsBlock(normalized)
    expect(rendered).toContain('- Always CC my paralegal.')
    expect(rendered).toContain('- Flag immigration matters.')
    // The duplicate never reaches the prompt twice.
    expect(rendered.match(/Always CC my paralegal\./g)?.length).toBe(1)
  })

  it('firm store: a cleared field ([] from the normalizer) renders as the pre-WP-2 unset prompt', () => {
    const normalized = normalizeFirmProfileFieldValue(
      'portal_assistant_instructions',
      [],
    ) as string[]
    expect(normalized).toEqual([])
    expect(buildPortalInstructionsBlock(normalized)).toBe('')
  })

  // ATTORNEY STORE (assistant_settings.customInstructions): persisted as one
  // JSON attribute value (api/assistantSettings.ts setAssistantSettings does
  // JSON.stringify(settings)); round-trip that exact serialize/deserialize
  // step for both the new array shape and a pre-WP-2 legacy string, then
  // render — proving parseSettings' "tolerant of both" contract end to end.
  it('attorney store: an array survives a JSON stringify/parse round trip and renders as bullets', () => {
    const saved = { customInstructions: ['Keep drafts short.', 'Flag immigration matters.'] }
    const reloaded = JSON.parse(JSON.stringify(saved)) as typeof saved
    const rendered = buildCustomInstructionsBlock(undefined, reloaded.customInstructions)
    expect(rendered).toContain(ATTORNEY_HEADER)
    expect(rendered).toContain('- Keep drafts short.')
    expect(rendered).toContain('- Flag immigration matters.')
  })

  it('attorney store: a legacy string payload survives the same round trip and renders verbatim', () => {
    const saved = { customInstructions: 'Keep drafts short.' }
    const reloaded = JSON.parse(JSON.stringify(saved)) as typeof saved
    const rendered = buildCustomInstructionsBlock(undefined, reloaded.customInstructions)
    expect(rendered).toContain(ATTORNEY_HEADER)
    expect(rendered).toContain('Keep drafts short.')
    expect(rendered).not.toContain('- Keep drafts short.')
  })
})
