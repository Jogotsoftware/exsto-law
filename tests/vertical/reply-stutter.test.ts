// UI-BUILDER-FIX-1 item 8 — reproduction + fix for the duplicate-sentence
// stutter. The reproduction string is the founder-reported one verbatim: two
// round fragments concatenated WITHOUT whitespace, the second restating the
// first with more detail. Pure function, no DB.
import { describe, it, expect } from 'vitest'
import { collapseRoundStutter } from '../../verticals/legal/src/api/replyAssembly.js'

describe('collapseRoundStutter (item 8)', () => {
  it('collapses the reported pricing stutter (glued, no whitespace)', () => {
    const raw =
      "Here's the pricing to approve.Here's the flat $450 pricing to approve — review the card below."
    const out = collapseRoundStutter(raw)
    expect(out).toBe("Here's the flat $450 pricing to approve — review the card below.")
  })

  it('collapses a paragraph-broken restatement (streaming shape)', () => {
    const raw =
      "Here's the workflow to review.\n\nHere's the five-step workflow to review — approve it below."
    expect(collapseRoundStutter(raw)).toBe(
      "Here's the five-step workflow to review — approve it below.",
    )
  })

  it('keeps ordinary consecutive paragraphs that are not restatements', () => {
    const raw =
      'The lease has a two-month deposit clause.\n\nSeparately, the termination notice is 60 days.'
    expect(collapseRoundStutter(raw)).toBe(raw)
  })

  it('never collapses long substantive content', () => {
    const long = `This paragraph lays out the analysis in detail: ${'point after point, '.repeat(12)}and a conclusion.`
    const raw = `${long}\n\n${long} Plus one more sentence.`
    // Over the stutter-token cap — left alone even though it IS a repeat.
    expect(collapseRoundStutter(raw)).toContain(long)
    expect(collapseRoundStutter(raw).length).toBeGreaterThan(long.length)
  })

  it('passes through empty and single-fragment replies', () => {
    expect(collapseRoundStutter('')).toBe('')
    expect(collapseRoundStutter('One clean reply.')).toBe('One clean reply.')
  })
})

// AI-CONTEXT A4 — the two prod shapes the item-8 comment documents as
// verifiably missed by forward-only adjacent matching: a short fragment
// restated by a LATER, richer fragment separated by OTHER text (not the
// immediate next one), and a TRAILING fragment that verbatim-repeats an
// EARLIER fragment, also separated by other text.
describe('collapseRoundStutter (A4 — non-adjacent shapes)', () => {
  it('drops a short paragraph restated by a later fragment separated by other text', () => {
    const raw = [
      'Let me check the termination clause.',
      "Here's what the calendar shows for next week — Tuesday at 2pm is open.",
      'Let me check the termination clause — it requires 60 days written notice before either party can end the agreement.',
    ].join('\n\n')
    expect(collapseRoundStutter(raw)).toBe(
      [
        "Here's what the calendar shows for next week — Tuesday at 2pm is open.",
        'Let me check the termination clause — it requires 60 days written notice before either party can end the agreement.',
      ].join('\n\n'),
    )
  })

  it('drops a trailing fragment that verbatim-repeats an earlier fragment separated by other text', () => {
    const raw = [
      'The retainer is due at signing — $2,500, refundable against unused hours.',
      "I'll also prep the engagement letter for your signature.",
      'The retainer is due at signing — $2,500, refundable against unused hours.',
    ].join('\n\n')
    expect(collapseRoundStutter(raw)).toBe(
      [
        'The retainer is due at signing — $2,500, refundable against unused hours.',
        "I'll also prep the engagement letter for your signature.",
      ].join('\n\n'),
    )
  })

  it('keeps a deliberate two-line answer where the second line shares words but adds substance', () => {
    const raw = [
      'The deposit is due at signing.',
      'Signing also requires the deposit receipt to be countersigned by both parties.',
    ].join('\n\n')
    expect(collapseRoundStutter(raw)).toBe(raw)
  })

  it('keeps a list whose items share a prefix but diverge (not a restatement)', () => {
    const raw = [
      'Review the signature page for completeness.',
      'Review the notary block for a valid commission date.',
    ].join('\n\n')
    expect(collapseRoundStutter(raw)).toBe(raw)
  })
})
