// WP4.1 + 1.1 WP2 — the model-facing history record of a card-heavy turn.
// 1.1 reframe: notes are now TERSE and wrapped in the ⟦…⟧ machinery sentinel (the
// live BUILD BRIEF carries the substance), so the model can no longer imitate a rich
// bracketed "[You asked via ask_build_question …]" stub as visible prose. The record
// still exists (a card-only turn is never empty in history), just non-imitable.
import { describe, it, expect } from 'vitest'
import { assistantHistoryContent } from '../../apps/legal-demo/lib/buildHistoryContent'
import {
  stripMachinery,
  MACHINERY_OPEN,
  MACHINERY_CLOSE,
} from '../../apps/legal-demo/lib/assistantText'

const emptyCards = {
  buildQuestions: [],
  workflowProposals: [],
  serviceProposals: [],
  questionnaireProposals: [],
  templateProposals: [],
  costProposals: [],
  enableProposals: [],
  kindProposals: [],
}

describe('assistantHistoryContent (1.1 reframe)', () => {
  it('returns undefined for a plain prose turn', () => {
    expect(assistantHistoryContent('Just an answer.', emptyCards)).toBeUndefined()
  })

  it('records card turns as a SENTINEL-wrapped note, never imitable bracket prose', () => {
    const text = assistantHistoryContent('Here is the shell to approve.', {
      ...emptyCards,
      serviceProposals: [{ derivedKey: 'nc_mutual_nda', displayName: 'NC Mutual NDA' }],
      buildQuestions: [{ key: 'kickoff', question: 'Who starts this?' }],
    })!
    // The model's own framing prose is preserved.
    expect(text).toContain('Here is the shell to approve.')
    // The note is wrapped in the machinery sentinel.
    expect(text).toContain(MACHINERY_OPEN)
    expect(text).toContain(MACHINERY_CLOSE)
    // It records THAT cards were shown, referencing the brief — NOT the old imitable
    // "[You asked via ask_build_question (key …): <verbatim>]" stub.
    expect(text).not.toContain('[You asked via ask_build_question')
    expect(text).not.toContain('Who starts this?') // no verbatim question to parrot
    expect(text).toContain('nc_mutual_nda')
  })

  it('the whole note strips out of rendered text (nothing leaks to the attorney)', () => {
    const text = assistantHistoryContent('One sentence.', {
      ...emptyCards,
      questionnaireProposals: [{ serviceKey: 'k' }],
    })!
    // What the attorney would see after the render sanitizer: only the prose.
    expect(stripMachinery(text)).toBe('One sentence.')
  })
})

describe('stripMachinery (1.1 render guarantee)', () => {
  it('removes ⟦…⟧ spans, including multi-line', () => {
    expect(stripMachinery('Hello ⟦internal note⟧ world')).toBe('Hello  world'.trim())
    expect(stripMachinery('a\n⟦line one\nline two⟧\nb')).toBe('a\n\nb')
  })

  it('hides a trailing UNCLOSED sentinel (mid-stream token) so it never flashes', () => {
    expect(stripMachinery('Real answer.\n⟦do the next step…')).toBe('Real answer.')
  })

  it('drops legacy bracketed machinery lines the model might parrot', () => {
    const leaked =
      'After you send that email back — then what happens?\n[You asked via ask_build_question (key "then_what_2"): …]'
    expect(stripMachinery(leaked)).toBe('After you send that email back — then what happens?')
    expect(stripMachinery('[You proposed a service]\nkept line')).toBe('kept line')
  })

  it('never touches ordinary prose, markdown links, or normal square brackets', () => {
    const prose = 'See [the service](/attorney/services/x) — it is live. Note [1] applies.'
    expect(stripMachinery(prose)).toBe(prose)
  })
})
