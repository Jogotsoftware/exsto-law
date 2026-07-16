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
