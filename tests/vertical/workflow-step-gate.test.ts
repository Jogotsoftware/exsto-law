// TASK-QUEUE-2 — the attorney-gate + dedup logic that decides whether a matter's
// current workflow step surfaces as a Workflow Step row. Tested PURELY against a
// synthetic stage graph fed to the shared resolver (no DB), mirroring
// attorney-task-queue.test.ts's approach for the pure normalizers.
import { describe, expect, it } from 'vitest'
import { surfacedAttorneyTransitions, currentStateSince, type Lifecycle } from '@exsto/legal'

// A small linear-ish graph exercising each gate kind out of a stage:
//   review    --attorney:draft.request-->  approve      (attorney, non-dedup)
//   approve   --attorney:draft.approve-->  esign        (attorney, DEDUP → Document Review)
//   esign     --system:esign.completed-->  done         (system, never attorney)
//   auto_only --automatic:some.event-->    done         (automatic, never attorney)
//   done      (terminal)
const graph: Lifecycle = [
  {
    key: 'review',
    label: 'Attorney review',
    entry: true,
    advances_to: [{ to: 'approve', gate: 'attorney', via: 'draft.request' }],
  },
  {
    key: 'approve',
    label: 'Approve draft',
    advances_to: [{ to: 'esign', gate: 'attorney', via: 'draft.approve' }],
  },
  {
    key: 'esign',
    label: 'eSign',
    action: { kind: 'esign', config: { document_kind: 'engagement_letter' } },
    advances_to: [{ to: 'done', gate: 'system', on: 'esign.completed' }],
  },
  {
    key: 'auto_only',
    label: 'Automatic hop',
    advances_to: [{ to: 'done', gate: 'automatic', on: 'some.event' }],
  },
  { key: 'done', label: 'Done', terminal: true, advances_to: [] },
]

describe('surfacedAttorneyTransitions (attorney gate + dedup)', () => {
  it('includes an attorney-gated step whose action is NOT draft.approve', () => {
    const edges = surfacedAttorneyTransitions(graph, 'review')
    expect(edges).toHaveLength(1)
    expect(edges[0]!.via).toBe('draft.request')
  })

  it('skips a draft.approve-only step (already a Document Review row)', () => {
    // The only attorney transition out of `approve` is via draft.approve, so it
    // must be deduped away entirely.
    expect(surfacedAttorneyTransitions(graph, 'approve')).toHaveLength(0)
  })

  it('never surfaces a system-gated e-sign step (already an E-Sign row)', () => {
    expect(surfacedAttorneyTransitions(graph, 'esign')).toHaveLength(0)
  })

  it('never surfaces an automatic step (the worker advances it)', () => {
    expect(surfacedAttorneyTransitions(graph, 'auto_only')).toHaveLength(0)
  })

  it('returns nothing for a terminal or unknown stage', () => {
    expect(surfacedAttorneyTransitions(graph, 'done')).toHaveLength(0)
    expect(surfacedAttorneyTransitions(graph, 'no_such_stage')).toHaveLength(0)
  })

  it('dedups a hand-authored attorney-gated e-sign edge (via starts with "esign")', () => {
    const g: Lifecycle = [
      {
        key: 's',
        label: 'Send for signature',
        entry: true,
        advances_to: [{ to: 't', gate: 'attorney', via: 'esign.send' }],
      },
      { key: 't', label: 'Done', terminal: true, advances_to: [] },
    ]
    expect(surfacedAttorneyTransitions(g, 's')).toHaveLength(0)
  })
})

describe('currentStateSince', () => {
  const history = [
    { state: 'review', at: '2026-07-10T10:00:00+00:00' },
    { state: 'approve', at: '2026-07-11T12:00:00+00:00' },
    { state: 'review', at: '2026-07-12T09:00:00+00:00' }, // re-entered review
  ]

  it('returns the "at" of the LAST entry landing in the current state', () => {
    expect(currentStateSince(history, 'review', 'FALLBACK')).toBe('2026-07-12T09:00:00+00:00')
    expect(currentStateSince(history, 'approve', 'FALLBACK')).toBe('2026-07-11T12:00:00+00:00')
  })

  it('falls back when the state is absent from history', () => {
    expect(currentStateSince(history, 'esign', 'FALLBACK')).toBe('FALLBACK')
  })

  it('falls back for a non-array / malformed history', () => {
    expect(currentStateSince(null, 'review', 'FALLBACK')).toBe('FALLBACK')
    expect(currentStateSince([{ state: 'review' }], 'review', 'FALLBACK')).toBe('FALLBACK')
  })
})
