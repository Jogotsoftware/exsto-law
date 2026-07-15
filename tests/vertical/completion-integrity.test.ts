// HOTFIX-P17 (L1 composition) — a BLOCKING step must be UNSKIPPABLE. These pin the
// pure reachability invariant the save/authoring paths compose: no route to a terminal
// may bypass a required step. Pure (no DB) — the runtime guard (advance handler) and
// the completion gate are proven separately against the live database.
import { describe, it, expect } from 'vitest'
import { validateBlockingReachability, isBlockingStage, type Lifecycle } from '@exsto/legal'

// A legal linear attorney-letter-shaped graph: intake → draft → review/send → complete.
function linearGraph(): Lifecycle {
  return [
    {
      key: 'intake',
      entry: true,
      label: 'Client intake',
      action: { kind: 'view_intake' },
      advances_to: [{ to: 'draft', gate: 'attorney', via: 'legal.matter.advance' }],
    },
    {
      key: 'draft',
      label: 'Draft the letter',
      action: { kind: 'invoke_capability' },
      advances_to: [{ to: 'review', gate: 'attorney', via: 'legal.matter.advance' }],
    },
    {
      key: 'review',
      label: 'Review & send letter',
      action: { kind: 'review_send_document' },
      advances_to: [{ to: 'complete', gate: 'attorney', via: 'draft.approve' }],
    },
    {
      key: 'complete',
      label: 'Complete matter',
      terminal: true,
      action: { kind: 'complete_matter' },
      advances_to: [],
    },
  ]
}

describe('isBlockingStage', () => {
  it('a review/send step is blocking by catalog default', () => {
    expect(isBlockingStage(linearGraph()[2]!)).toBe(true)
  })
  it('a terminal is never blocking', () => {
    expect(isBlockingStage(linearGraph()[3]!)).toBe(false)
  })
  it('an explicit blocking:false override wins', () => {
    expect(
      isBlockingStage({
        key: 'x',
        label: 'X',
        blocking: false,
        action: { kind: 'review_send_document' },
        advances_to: [],
      }),
    ).toBe(false)
  })
  it('an informational consultation step is not blocking', () => {
    expect(
      isBlockingStage({
        key: 'c',
        label: 'Consult',
        action: { kind: 'view_consultation' },
        advances_to: [],
      }),
    ).toBe(false)
  })
})

describe('validateBlockingReachability', () => {
  it('accepts a linear graph — every step is on the only path', () => {
    expect(validateBlockingReachability(linearGraph()).ok).toBe(true)
  })

  it('rejects a shortcut that skips a blocking step on the way to completion', () => {
    const g = linearGraph()
    // Add a bypass edge draft → complete, skipping the blocking review/send step.
    g[1]!.advances_to.push({ to: 'complete', gate: 'attorney', via: 'legal.matter.advance' })
    const res = validateBlockingReachability(g)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toContain('Review & send letter')
  })

  it('allows a shortcut around a NON-blocking (informational) step', () => {
    const g = linearGraph()
    g[2]!.blocking = false // review step marked informational
    g[1]!.advances_to.push({ to: 'complete', gate: 'attorney', via: 'legal.matter.advance' })
    expect(validateBlockingReachability(g).ok).toBe(true)
  })

  it('is a no-op on an empty or terminal-less graph (validateLifecycle owns those)', () => {
    expect(validateBlockingReachability([]).ok).toBe(true)
  })
})
