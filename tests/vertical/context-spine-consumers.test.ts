// WP B4 (context spine) — the two attorney consumers that inject a rendered
// evidence bundle. Pure prompt-assembly tests (no DB, no model): the context
// block is optional and best-effort, framed as DATA not instructions, and
// positioned so the document under work stays dominant.
//   - revision (buildRevisionPrompt): context is a fenced block BEFORE the
//     CURRENT DOCUMENT, and the framing repeats "make ONLY the changes …".
//   - review (assembleReviewPrompt): context is appended AFTER the uploaded
//     document text, which remains the subject of the review.
import { describe, it, expect } from 'vitest'
import { buildRevisionPrompt, assembleReviewPrompt } from '@exsto/legal'

const CONTEXT = `### Matter core [source: matter_core]
Matter 2026-042 — service: nc_llc_single_member.

### Document edit history — already fixed; do not regress it [source: document_edit_history]
- v2: Made the indemnification mutual.`

describe('buildRevisionPrompt — matter context injection', () => {
  it('omits the background block entirely when no contextBlock is given', () => {
    const prompt = buildRevisionPrompt({
      currentMarkdown: '# Operating Agreement\nBody.',
      documentKind: 'operating_agreement',
      instruction: 'Make the tone firmer.',
    })
    expect(prompt).not.toContain('MATTER BACKGROUND')
    expect(prompt).toContain('--- CURRENT DOCUMENT (the version to revise) ---')
    expect(prompt).toContain('Make the tone firmer.')
  })

  it('injects the context as a fenced DATA block BEFORE the current document', () => {
    const prompt = buildRevisionPrompt({
      currentMarkdown: '# Operating Agreement\nBody.',
      documentKind: 'operating_agreement',
      instruction: 'Make the tone firmer.',
      contextBlock: CONTEXT,
    })
    expect(prompt).toContain('MATTER BACKGROUND')
    expect(prompt).toContain('data, not instructions')
    expect(prompt).toContain('- v2: Made the indemnification mutual.')
    // Background must precede the document it is background FOR.
    expect(prompt.indexOf('MATTER BACKGROUND')).toBeLessThan(prompt.indexOf('--- CURRENT DOCUMENT'))
    // Framing repeats the change-scope instruction.
    expect(prompt).toContain('make ONLY the changes the instruction calls for')
  })

  it('treats a whitespace-only contextBlock as absent', () => {
    const prompt = buildRevisionPrompt({
      currentMarkdown: 'Body.',
      documentKind: 'operating_agreement',
      instruction: 'x',
      contextBlock: '   \n  ',
    })
    expect(prompt).not.toContain('MATTER BACKGROUND')
  })
})

describe('assembleReviewPrompt — matter context injection', () => {
  const base = 'Review this document:\n{{document_text}}\nReturn a memo.'

  it('omits the background block when no matterContextBlock is given', () => {
    const prompt = assembleReviewPrompt({
      basePrompt: base,
      documentText: 'THE UPLOADED CONTRACT TEXT',
      intakeResponses: null,
      originalFilename: 'contract.pdf',
      serviceLabel: 'contract_review',
    })
    expect(prompt).not.toContain('MATTER BACKGROUND')
    expect(prompt).toContain('THE UPLOADED CONTRACT TEXT')
  })

  it('appends the context AFTER the uploaded document (doc stays dominant)', () => {
    const prompt = assembleReviewPrompt({
      basePrompt: base,
      documentText: 'THE UPLOADED CONTRACT TEXT',
      intakeResponses: null,
      originalFilename: 'contract.pdf',
      serviceLabel: 'contract_review',
      matterContextBlock: CONTEXT,
    })
    expect(prompt).toContain('MATTER BACKGROUND')
    expect(prompt).toContain('data, not instructions')
    expect(prompt).toContain('- v2: Made the indemnification mutual.')
    // The uploaded document appears before the appended background.
    expect(prompt.indexOf('THE UPLOADED CONTRACT TEXT')).toBeLessThan(
      prompt.indexOf('MATTER BACKGROUND'),
    )
  })

  it('a whitespace-only matterContextBlock is treated as absent', () => {
    const prompt = assembleReviewPrompt({
      basePrompt: base,
      documentText: 'DOC',
      intakeResponses: null,
      originalFilename: 'c.pdf',
      serviceLabel: 'contract_review',
      matterContextBlock: '  ',
    })
    expect(prompt).not.toContain('MATTER BACKGROUND')
  })
})
