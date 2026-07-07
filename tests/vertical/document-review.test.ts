// AI document review — pure unit contracts (no DB, no model, no Storage):
// config parsing (opt-in only), prompt validation ({{document_text}} required),
// prompt assembly (slots + skills-then-guidance precedence), and the text
// extraction dispatch (plain text, truncation, unsupported/empty ⇒ the typed
// non-retryable error the runner converts into document.review.failed).
import { describe, it, expect } from 'vitest'
import {
  parseReviewConfig,
  validateReviewPrompt,
  assembleReviewPrompt,
  extractDocumentText,
  UnreviewableDocumentError,
  REVIEW_MEMO_DOCUMENT_KIND,
} from '@exsto/legal'

describe('parseReviewConfig — review is opt-in, garbage means disabled', () => {
  it('absent config ⇒ disabled', () => {
    expect(parseReviewConfig(null).enabled).toBe(false)
    expect(parseReviewConfig(undefined).enabled).toBe(false)
  })
  it('garbage values never enable', () => {
    expect(parseReviewConfig({ enabled: 'true' }).enabled).toBe(false)
    expect(parseReviewConfig({ enabled: 1 }).enabled).toBe(false)
  })
  it('parses a full config', () => {
    const c = parseReviewConfig({
      enabled: true,
      prompt: 'Review: {{document_text}}',
      prompt_version: 3,
      redline: true,
      skill_slugs: ['nc-lease-review', '', 42],
    })
    expect(c).toEqual({
      enabled: true,
      prompt: 'Review: {{document_text}}',
      promptVersion: 3,
      redline: true,
      skillSlugs: ['nc-lease-review'],
    })
  })
  it('blank prompt reads as null (bundled default)', () => {
    expect(parseReviewConfig({ enabled: true, prompt: '   ' }).prompt).toBeNull()
  })
})

describe('validateReviewPrompt — {{document_text}} is mandatory', () => {
  it('rejects a prompt without the slot', () => {
    expect(() => validateReviewPrompt('Review the attached document.')).toThrow(/document_text/)
  })
  it('rejects empty/non-string', () => {
    expect(() => validateReviewPrompt('')).toThrow()
    expect(() => validateReviewPrompt(42)).toThrow()
  })
  it('accepts a prompt with the slot', () => {
    expect(validateReviewPrompt('Review this:\n{{document_text}}')).toContain('{{document_text}}')
  })
})

describe('assembleReviewPrompt — slot fill + precedence', () => {
  const base =
    'Service: {{service_label}} File: {{original_filename}}\nAnswers: {{intake_responses_json}}\nDoc:\n{{document_text}}'

  it('fills every slot', () => {
    const out = assembleReviewPrompt({
      basePrompt: base,
      documentText: 'THE DOCUMENT',
      intakeResponses: { company_name: 'Acme LLC' },
      originalFilename: 'lease.pdf',
      serviceLabel: 'Document review',
    })
    expect(out).toContain('THE DOCUMENT')
    expect(out).toContain('lease.pdf')
    expect(out).toContain('Document review')
    expect(out).toContain('"company_name": "Acme LLC"')
    expect(out).not.toMatch(/\{\{\w+\}\}/)
  })

  it('inserts document text literally — $ special replacement patterns are not interpreted', () => {
    // Raw-string replaceAll would treat these as $&/$`/$'/$$ replacement
    // patterns and splice the prompt into itself; the function replacer must not.
    const hostile = "clause A $$ $& $` $' clause B"
    const out = assembleReviewPrompt({
      basePrompt: 'Doc:\n{{document_text}}',
      documentText: hostile,
      intakeResponses: null,
      originalFilename: 'f.pdf',
      serviceLabel: 's',
    })
    expect(out).toBe(`Doc:\n${hostile}`)
    expect(out).toContain(hostile)
  })

  it('appends skills before guidance (guidance carries the most weight, LAST)', () => {
    const out = assembleReviewPrompt({
      basePrompt: '{{document_text}}',
      documentText: 'DOC',
      intakeResponses: null,
      originalFilename: 'f.pdf',
      serviceLabel: 's',
      activeSkillsText: 'SKILLS-BLOCK',
      guidance: 'FOCUS ON THE INDEMNITY CAP',
    })
    const skillsIdx = out.indexOf('SKILLS-BLOCK')
    const guidanceIdx = out.indexOf('FOCUS ON THE INDEMNITY CAP')
    expect(skillsIdx).toBeGreaterThan(-1)
    expect(guidanceIdx).toBeGreaterThan(skillsIdx)
  })
})

describe('extractDocumentText — dispatch on the sniffed content type', () => {
  it('plain text passes through', async () => {
    const out = await extractDocumentText(Buffer.from('hello contract'), 'text/plain')
    expect(out).toBe('hello contract')
  })

  it('truncates over the window with an explicit marker', async () => {
    const big = 'x'.repeat(250_000)
    const out = await extractDocumentText(Buffer.from(big), 'text/plain')
    expect(out.length).toBeLessThan(big.length)
    expect(out).toContain('[TRUNCATED')
  })

  it('unsupported type ⇒ UnreviewableDocumentError (non-retryable)', async () => {
    await expect(extractDocumentText(Buffer.from('x'), 'image/png')).rejects.toBeInstanceOf(
      UnreviewableDocumentError,
    )
    // Legacy .doc (OLE2) is deliberately unsupported (mammoth is docx-only).
    await expect(
      extractDocumentText(Buffer.from('x'), 'application/msword'),
    ).rejects.toBeInstanceOf(UnreviewableDocumentError)
  })

  it('empty text ⇒ UnreviewableDocumentError (likely a scan)', async () => {
    await expect(extractDocumentText(Buffer.from('   '), 'text/plain')).rejects.toBeInstanceOf(
      UnreviewableDocumentError,
    )
  })
})

describe('memo document kind', () => {
  it('is the stable label the queue humanizes', () => {
    expect(REVIEW_MEMO_DOCUMENT_KIND).toBe('document_review_memo')
  })
})
