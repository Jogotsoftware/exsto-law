// CONTEXT-SETTINGS-1 — the pure half of the Context Settings feature.
//
// What these lock down, in order of how expensive it would be to get wrong:
//   1. The universal rules are APPLIED but never live in the per-service prompt
//      box. That is the whole point of the change: a composed prompt must carry
//      "never invent a value" / "no draft banners" / "output the document only"
//      and the three worker slots, without the attorney's instructions layer
//      containing any of them.
//   2. Layer precedence and omission — narrowest guidance last, every optional
//      layer absent when unset (so an unconfigured firm's prompt is minimal).
//   3. The legacy split — an existing service seeded with the old boilerplate
//      prompt moves over with its custom remainder intact, and a genuinely
//      hand-authored prompt is NOT mangled.
//   4. The chat scope router refuses to promote a service-scoped instruction to
//      a firm-wide write when the service is unknown. That is the failure this
//      whole feature exists to prevent.
import { describe, it, expect } from 'vitest'
import {
  resolveAiContextConfigDoc,
  composeContextBlocks,
  effectiveBaseGuidance,
  normalizeInstructionItems,
  normalizeContextMd,
  INSTRUCTION_MAX_ITEMS,
  CONTEXT_MD_CHAR_CAP,
} from '../../verticals/legal/src/api/aiContextConfig.js'
import {
  composeDraftingBasePrompt,
  deriveInstructionsFromLegacyPrompt,
  resolveDraftingPromptDoc,
  completenessFromTransitions,
  REQUIRED_DRAFTING_SLOTS,
} from '../../verticals/legal/src/api/services.js'
import {
  DRAFTING_BASE_GUIDANCE,
  REVIEW_BASE_GUIDANCE,
} from '../../verticals/legal/src/templates/promptDefaults.js'
import { buildContextFilesBlock } from '../../verticals/legal/src/api/assistantPrompt.js'
import {
  AI_INSTRUCTION_SCOPES,
  isAiInstructionScope,
  saveAiInstruction,
} from '../../verticals/legal/src/api/aiInstructionRouting.js'

const EMPTY = resolveAiContextConfigDoc(null)

// The exact phrases that used to sit in the per-service textarea.
const UNIVERSAL_MARKERS = [
  'NEVER INVENT A VALUE',
  'NEVER WRITE REVIEW-STATE TEXT INTO THE DOCUMENT',
  'OUTPUT THE FINAL DOCUMENT ONLY',
]

describe('resolveAiContextConfigDoc', () => {
  it('yields platform defaults for an unconfigured firm rather than throwing', () => {
    for (const input of [null, undefined, 'nonsense', 42, []]) {
      const doc = resolveAiContextConfigDoc(input as unknown)
      expect(doc.documentGeneration.instructions).toEqual([])
      expect(doc.documentGeneration.baseGuidance).toBeNull()
      expect(doc.firmContextMd).toBeNull()
    }
    expect(effectiveBaseGuidance('document_generation', EMPTY)).toBe(DRAFTING_BASE_GUIDANCE)
    expect(effectiveBaseGuidance('document_review', EMPTY)).toBe(REVIEW_BASE_GUIDANCE)
  })

  it('reads a stored config and lets a firm override the base guidance', () => {
    const doc = resolveAiContextConfigDoc({
      version: 3,
      document_generation: { instructions: ['Be formal.'], base_guidance: 'OUR OWN RULES' },
      document_review: { instructions: [] },
      firm_context_md: 'We file in Wake County.',
    })
    expect(doc.version).toBe(3)
    expect(doc.documentGeneration.instructions).toEqual(['Be formal.'])
    expect(effectiveBaseGuidance('document_generation', doc)).toBe('OUR OWN RULES')
    // Overriding generation must not touch review.
    expect(effectiveBaseGuidance('document_review', doc)).toBe(REVIEW_BASE_GUIDANCE)
    expect(doc.firmContextMd).toBe('We file in Wake County.')
  })

  it('caps instruction count and context length, and treats blank as unset', () => {
    const many = normalizeInstructionItems(Array.from({ length: 50 }, (_, i) => `rule ${i}`))
    expect(many).toHaveLength(INSTRUCTION_MAX_ITEMS)
    expect(normalizeInstructionItems(['  ', '', 'real'])).toEqual(['real'])
    // A pre-pills single string still reads as one instruction.
    expect(normalizeInstructionItems('one blob')).toEqual(['one blob'])
    expect(normalizeContextMd('   ')).toBeNull()
    expect(normalizeContextMd('x'.repeat(CONTEXT_MD_CHAR_CAP + 500))).toHaveLength(
      CONTEXT_MD_CHAR_CAP,
    )
  })
})

describe('composeContextBlocks — layer order and omission', () => {
  it('emits only the universal rules when nothing else is configured', () => {
    const out = composeContextBlocks({ capability: 'document_generation', config: EMPTY })
    expect(out).toBe(DRAFTING_BASE_GUIDANCE)
  })

  it('stacks firm context, firm defaults, user context and service instructions in that order', () => {
    const config = resolveAiContextConfigDoc({
      document_generation: { instructions: ['Firm default one.'] },
      firm_context_md: 'FIRMFACT',
    })
    const out = composeContextBlocks({
      capability: 'document_generation',
      config,
      userContextMd: 'USERFACT',
      serviceInstructions: 'SERVICERULE',
    })
    const at = (needle: string): number => out.indexOf(needle)
    expect(at('NEVER INVENT A VALUE')).toBeGreaterThanOrEqual(0)
    expect(at('NEVER INVENT A VALUE')).toBeLessThan(at('FIRMFACT'))
    expect(at('FIRMFACT')).toBeLessThan(at('Firm default one.'))
    expect(at('Firm default one.')).toBeLessThan(at('USERFACT'))
    expect(at('USERFACT')).toBeLessThan(at('SERVICERULE'))
  })

  it('omits the user context on paths that do not know the acting human', () => {
    const out = composeContextBlocks({
      capability: 'document_generation',
      config: EMPTY,
      serviceInstructions: 'SERVICERULE',
    })
    expect(out).not.toContain('Your context')
    expect(out).toContain('SERVICERULE')
  })
})

describe('composeDraftingBasePrompt', () => {
  it('carries every worker slot and every universal rule', () => {
    const prompt = composeDraftingBasePrompt({
      config: EMPTY,
      serviceInstructions: 'Add a buy-sell.',
    })
    for (const slot of REQUIRED_DRAFTING_SLOTS) expect(prompt).toContain(slot)
    for (const marker of UNIVERSAL_MARKERS) expect(prompt).toContain(marker)
    // The output/trace contract the drafting parser depends on must survive.
    expect(prompt).toContain('"conclusion"')
    expect(prompt).toContain('"confidence"')
    expect(prompt).toContain('{{sign:')
    expect(prompt).toContain('Add a buy-sell.')
  })

  it('is valid with no service instructions at all', () => {
    const prompt = composeDraftingBasePrompt({ config: EMPTY, serviceInstructions: '' })
    for (const slot of REQUIRED_DRAFTING_SLOTS) expect(prompt).toContain(slot)
    expect(prompt).not.toContain('Instructions for THIS service')
  })
})

describe('the per-service layer holds no universal boilerplate', () => {
  // The regression this feature exists to prevent: the attorney's editable
  // layer must never contain the platform rules again.
  it('resolves a service to instructions that contain no universal text and no slots', () => {
    const doc = resolveDraftingPromptDoc(
      { instructions: { operating_agreement: 'Always include a buy-sell provision.' } },
      'svc',
      'operating_agreement',
      { config: EMPTY },
    )
    expect(doc.source).toBe('composed')
    expect(doc.instructionsText).toBe('Always include a buy-sell provision.')
    for (const marker of UNIVERSAL_MARKERS) expect(doc.instructionsText).not.toContain(marker)
    for (const slot of REQUIRED_DRAFTING_SLOTS) expect(doc.instructionsText).not.toContain(slot)
    // …while the prompt the worker actually receives carries both.
    for (const marker of UNIVERSAL_MARKERS) expect(doc.promptText).toContain(marker)
    for (const slot of REQUIRED_DRAFTING_SLOTS) expect(doc.promptText).toContain(slot)
  })

  it('lets a firm-wide instruction reach a service that has none of its own', () => {
    const config = resolveAiContextConfigDoc({
      document_generation: { instructions: ['Every document must be well formatted.'] },
    })
    const doc = resolveDraftingPromptDoc(
      { instructions: { operating_agreement: '' } },
      'svc',
      'operating_agreement',
      { config },
    )
    expect(doc.source).toBe('composed')
    expect(doc.instructionsText).toBe('')
    expect(doc.promptText).toContain('Every document must be well formatted.')
  })
})

describe('legacy prompts', () => {
  // Shape of what defaultDraftingPrompt seeded before this change.
  const LEGACY_SCAFFOLD = [
    `You are drafting a operating agreement under North Carolina law (and applicable U.S. federal law). Complete the firm's template below using the client's intake answers; Where a required value is genuinely missing, LEAVE ITS {{token}} IN PLACE UNCHANGED — never invent a value. This is the BASE guidance: if the attorney adds specific instructions for this draft, FOLLOW THEM.`,
    ``,
    `The client's intake answers (use these to fill the document):`,
    `{{questionnaire_responses_json}}`,
    ``,
    `Consultation notes, if any (additional context):`,
    `{{transcript_text}}`,
    ``,
    `The document template to complete:`,
    `{{operating_agreement_template}}`,
  ].join('\n')

  it('splits a seeded prompt down to nothing when the attorney never customized it', () => {
    expect(deriveInstructionsFromLegacyPrompt(LEGACY_SCAFFOLD)).toBe('')
  })

  it('keeps the attorney’s own additions when splitting', () => {
    const withCustom = `${LEGACY_SCAFFOLD}\n\nAlways include a buy-sell provision.`
    expect(deriveInstructionsFromLegacyPrompt(withCustom)).toBe(
      'Always include a buy-sell provision.',
    )
  })

  it('refuses to split a hand-authored prompt, leaving it in full-prompt mode', () => {
    const handAuthored =
      'My own prompt.\n{{questionnaire_responses_json}}\n{{transcript_text}}\n{{operating_agreement_template}}'
    expect(deriveInstructionsFromLegacyPrompt(handAuthored)).toBeNull()
    const doc = resolveDraftingPromptDoc(
      { prompts: { operating_agreement: handAuthored } },
      'svc',
      'operating_agreement',
      { config: EMPTY },
    )
    expect(doc.source).toBe('config')
    expect(doc.promptText).toBe(handAuthored)
    expect(doc.instructionsText).toBeNull()
    expect(doc.hasLegacyPromptOverride).toBe(true)
  })

  it('migrates a seeded service to composed mode on read, keeping its custom line', () => {
    const doc = resolveDraftingPromptDoc(
      { prompts: { operating_agreement: `${LEGACY_SCAFFOLD}\n\nAlways add a buy-sell.` } },
      'svc',
      'operating_agreement',
      { config: EMPTY },
    )
    expect(doc.source).toBe('composed')
    expect(doc.instructionsText).toBe('Always add a buy-sell.')
    expect(doc.hasLegacyPromptOverride).toBe(true)
  })

  it('prefers stored instructions over a legacy prompt when both exist', () => {
    const doc = resolveDraftingPromptDoc(
      {
        prompts: { operating_agreement: LEGACY_SCAFFOLD },
        instructions: { operating_agreement: 'The new layer.' },
      },
      'svc',
      'operating_agreement',
      { config: EMPTY },
    )
    expect(doc.instructionsText).toBe('The new layer.')
  })
})

describe('buildContextFilesBlock', () => {
  it('is empty when neither file is set, so an unconfigured firm’s prompt is unchanged', () => {
    expect(buildContextFilesBlock(null, null)).toBe('')
    expect(buildContextFilesBlock('   ', undefined)).toBe('')
  })

  it('labels each file and puts the firm’s first', () => {
    const out = buildContextFilesBlock('FIRMFACT', 'USERFACT')
    expect(out).toContain('FIRM CONTEXT')
    expect(out).toContain('YOUR CONTEXT')
    expect(out.indexOf('FIRMFACT')).toBeLessThan(out.indexOf('USERFACT'))
  })
})

describe('chat scope routing', () => {
  const ctx = { tenantId: 't', actorId: 'a' } as never

  it('recognizes exactly the eight scopes', () => {
    expect(AI_INSTRUCTION_SCOPES).toHaveLength(8)
    expect(isAiInstructionScope('firm_document_generation')).toBe(true)
    expect(isAiInstructionScope('global')).toBe(false)
  })

  it('rejects an unknown scope instead of guessing one', async () => {
    await expect(
      saveAiInstruction(ctx, { scope: 'whatever' as never, instruction: 'x' }),
    ).rejects.toThrow(/Unknown scope/)
  })

  it('rejects an empty instruction', async () => {
    await expect(
      saveAiInstruction(ctx, { scope: 'firm_document_generation', instruction: '   ' }),
    ).rejects.toThrow(/no instruction text/i)
  })

  // The core safety property: a service-scoped instruction with no service must
  // FAIL, never silently become a firm-wide rule affecting every document.
  it('never promotes a service-scoped instruction to a firm-wide write', async () => {
    await expect(
      saveAiInstruction(ctx, {
        scope: 'service_document_review',
        instruction: 'Watch the non-compete.',
      }),
    ).rejects.toThrow(/serviceKey is required/)
    await expect(
      saveAiInstruction(ctx, {
        scope: 'service_document_generation',
        instruction: 'Add a buy-sell.',
        serviceKey: 'llc',
      }),
    ).rejects.toThrow(/documentKind is required/)
  })
})

describe('the enable gate accepts the new instructions layer', () => {
  // Regression: the completeness gate used to read transitions.drafting
  // .prompts[kind] directly and demand the mustache slots in it. A service
  // configured with instructions only (no legacy full prompt) would have failed
  // with "needs a drafting prompt" and could never be enabled — the gate has to
  // resolve the same way the drafting worker does.
  const INTAKE = {
    sections: [{ id: 's', title: 'S', fields: [{ id: 'f', label: 'F', type: 'text' }] }],
  }

  it('marks an auto service with instructions-only drafting config as ready', () => {
    const c = completenessFromTransitions('svc', {
      route: 'auto',
      documents: ['operating_agreement'],
      intake_schema: INTAKE as never,
      drafting: { instructions: { operating_agreement: 'Add a buy-sell.' } },
    })
    expect(c.missing).toEqual([])
    expect(c.ready).toBe(true)
  })

  it('still refuses a document kind with no drafting config at all', () => {
    const c = completenessFromTransitions('svc', {
      route: 'auto',
      documents: ['operating_agreement'],
      intake_schema: INTAKE as never,
      drafting: {},
    })
    expect(c.ready).toBe(false)
    expect(c.missing.join(' ')).toMatch(/needs a drafting prompt/)
  })

  it('still refuses a hand-authored prompt that dropped a required slot', () => {
    const c = completenessFromTransitions('svc', {
      route: 'auto',
      documents: ['operating_agreement'],
      intake_schema: INTAKE as never,
      drafting: { prompts: { operating_agreement: 'no slots here' } },
    })
    expect(c.ready).toBe(false)
    expect(c.missing.join(' ')).toMatch(/missing slot/)
  })
})
