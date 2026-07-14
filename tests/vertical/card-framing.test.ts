// BUILDER-UX-3 — pure doctrine checks for wizard card turns. No DB.
//   framingSentenceForCards (P5): the persisted framing sentence must MATCH the
//     card the turn actually emitted — the model's own line survives only when it
//     plausibly names an emitted card kind; otherwise the card's deterministic
//     label replaces it (the stale-"workflow"-framing-above-a-billing-card bug).
//   workflowSummaryViolation (P6): the workflow card summary is WHY only — never
//     a billing restate (the billing card owns that), never a step enumeration
//     (the card lists the steps itself).
import { describe, it, expect } from 'vitest'
import { framingSentenceForCards } from '../../verticals/legal/src/api/replyAssembly.js'
import { workflowSummaryViolation } from '../../verticals/legal/src/api/workflowAuthoringTools.js'
import type { Lifecycle } from '../../verticals/legal/src/lifecycle/index.js'

describe('framingSentenceForCards (P5)', () => {
  it('substitutes the card label when the framing names a card that never emitted', () => {
    // The incident shape: "workflow" framing spoken, propose_workflow failed,
    // the model recovered with a cost card — the stale line must not survive.
    const out = framingSentenceForCards(["Here's the workflow to approve."], { cost: 1 })
    expect(out).toBe("Here's the pricing to approve.")
  })

  it('keeps the model sentence when it names the emitted card', () => {
    expect(framingSentenceForCards(["Here's the workflow to approve."], { workflow: 1 })).toBe(
      "Here's the workflow to approve.",
    )
    expect(framingSentenceForCards(['The pricing is ready for your review.'], { cost: 1 })).toBe(
      'The pricing is ready for your review.',
    )
  })

  it('keeps only the FIRST sentence of the first non-empty round', () => {
    const out = framingSentenceForCards(
      ['', "Here's the questionnaire to review. It covers every template token."],
      { questionnaire: 1 },
    )
    expect(out).toBe("Here's the questionnaire to review.")
  })

  it('frames the doctrine-order-LAST kind on a multi-kind turn', () => {
    // Cost + workflow in one turn, framing names neither → the workflow (the
    // furthest build step reached) provides the label.
    const out = framingSentenceForCards(['All set for the next piece.'], { cost: 1, workflow: 1 })
    expect(out).toBe("Here's the workflow to approve.")
  })

  it('keeps an honest sentence naming ANY emitted kind on a multi-kind turn', () => {
    const out = framingSentenceForCards(["Here's the pricing to approve."], {
      cost: 1,
      workflow: 1,
    })
    expect(out).toBe("Here's the pricing to approve.")
  })

  it('substitutes the label when the turn produced no framing text at all', () => {
    expect(framingSentenceForCards(['', '  '], { enable: 1 })).toBe(
      'Approve to make the service live.',
    )
  })

  it('keeps conversational framing on a question-only turn', () => {
    const opener = 'Tell me how this works in your practice.'
    expect(framingSentenceForCards([opener], { question: 3 })).toBe(opener)
  })
})

describe('workflowSummaryViolation (P6)', () => {
  const graph = [
    { key: 'intake', label: 'Client intake', action: { kind: 'view_intake' }, advances_to: [] },
    { key: 'draft', label: 'Draft the NDA', action: { kind: 'manual_task' }, advances_to: [] },
    { key: 'review', label: 'Attorney review', action: { kind: 'manual_task' }, advances_to: [] },
    { key: 'done', label: 'Complete matter', action: { kind: 'complete_matter' }, advances_to: [] },
  ] as unknown as Lifecycle

  it('rejects a money token (billing restate)', () => {
    expect(
      workflowSummaryViolation('Maps your process; the client is charged $500.', graph),
    ).toMatch(/billing/)
    expect(workflowSummaryViolation('A $ 450 flat fee accrues at completion.', graph)).toMatch(
      /billing/,
    )
  })

  it('rejects the billing read-out phrasing', () => {
    expect(workflowSummaryViolation('Total per matter: five hundred.', graph)).toMatch(/billing/)
    expect(workflowSummaryViolation('See the billing read-out below.', graph)).toMatch(/billing/)
  })

  it('rejects three or more step labels verbatim (an enumeration)', () => {
    expect(
      workflowSummaryViolation(
        'Client intake, then Draft the NDA, then Attorney review — done.',
        graph,
      ),
    ).toMatch(/enumerates/)
  })

  it('allows a WHY-only summary, including one that mentions up to two steps', () => {
    expect(
      workflowSummaryViolation(
        'Mirrors your walkthrough: drafting waits for Attorney review because the send is a judgment point.',
        graph,
      ),
    ).toBeNull()
    expect(workflowSummaryViolation('', graph)).toBeNull()
  })
})

describe('BUILDER-UX-3 review fixes', () => {
  it('replaces a stale card-naming sentence on a question-only turn', () => {
    const out = framingSentenceForCards(["Here's the workflow to approve."], { question: 1 })
    expect(out).toBe('A few quick questions.')
  })

  it('does not count single-word step labels as enumeration', () => {
    const graph = [
      { key: 'a', label: 'Intake' },
      { key: 'b', label: 'Review' },
      { key: 'c', label: 'Complete' },
    ] as never
    const summary =
      'Mirrors how you work: after intake you review everything before the matter is complete.'
    expect(workflowSummaryViolation(summary, graph)).toBeNull()
  })

  it('still rejects a real multi-word enumeration', () => {
    const graph = [
      { key: 'a', label: 'Client intake' },
      { key: 'b', label: 'Client consultation' },
      { key: 'c', label: 'Draft letter review' },
    ] as never
    const summary = 'Added Client intake, Client consultation, and Draft letter review in order.'
    expect(workflowSummaryViolation(summary, graph)).not.toBeNull()
  })
})
