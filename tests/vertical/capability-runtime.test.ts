// ADR 0046 — the capability runtime's PURE surface: the invoke_capability step kind
// is in the closed catalog (so validateLifecycle accepts a stage that runs a
// capability, and rejects a made-up kind), and the handler registry knows exactly
// which capabilities are executable today. The DB-backed paths (the authoring
// validator against the live registry, the executor, the client-delivery dispatch)
// are proven by the sandbox end-to-end receipts in the decision log.
import { describe, it, expect } from 'vitest'
import {
  STEP_ACTION_KINDS,
  validateLifecycle,
  validateLinearLifecycle,
  isHandlerImplemented,
  scheduleCapabilityAutoRun,
  type Lifecycle,
} from '@exsto/legal'

const REVIEW_GRAPH: Lifecycle = [
  {
    key: 'intake_submitted',
    label: 'Client intake',
    entry: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'review', gate: 'attorney', via: 'legal.matter.advance' }],
  },
  {
    key: 'review',
    label: 'AI review of the contract',
    action: {
      kind: 'invoke_capability',
      config: { capability_slug: 'ai_document_review', capability_config: { rubric: 'check X' } },
    },
    advances_to: [{ to: 'materials', gate: 'attorney', via: 'draft.approve' }],
  },
  {
    key: 'materials',
    label: 'Ask the client for the signed form',
    action: {
      kind: 'invoke_capability',
      config: {
        capability_slug: 'request_client_materials',
        capability_config: { message: 'Please send the signed form.' },
      },
    },
    // A CLIENT-gated stage: the client's own delivery advances it.
    advances_to: [{ to: 'done', gate: 'client', via: 'document.upload' }],
  },
  {
    key: 'done',
    label: 'Complete',
    terminal: true,
    action: { kind: 'complete_matter' },
    advances_to: [],
  },
]

describe('invoke_capability step kind (ADR 0046)', () => {
  it('is in the closed step-action catalog', () => {
    expect(STEP_ACTION_KINDS).toContain('invoke_capability')
  })

  it('validateLifecycle accepts a graph with invoke_capability stages', () => {
    const res = validateLifecycle(REVIEW_GRAPH)
    expect(res.errors).toEqual([])
    expect(res.ok).toBe(true)
  })

  it('the graph is linear (each non-terminal stage has one outgoing edge)', () => {
    expect(validateLinearLifecycle(REVIEW_GRAPH).ok).toBe(true)
  })

  it('still rejects a made-up action kind', () => {
    const bad: Lifecycle = [
      {
        key: 'a',
        label: 'A',
        entry: true,
        action: { kind: 'invoke_frobnicate' as never },
        advances_to: [{ to: 'b', gate: 'attorney', via: 'x' }],
      },
      {
        key: 'b',
        label: 'B',
        terminal: true,
        action: { kind: 'complete_matter' },
        advances_to: [],
      },
    ]
    const res = validateLifecycle(bad)
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes('unknown action kind'))).toBe(true)
  })
})

describe('scheduleCapabilityAutoRun — WP1 auto-run scheduling (ADR 0046)', () => {
  const base = { tenantId: 't', actorId: 'a' }

  it('enqueues a post-commit callback when the landed stage runs a capability', () => {
    const afterCommit: Array<() => Promise<void>> = []
    scheduleCapabilityAutoRun({ ...base, afterCommit }, 'matter-1', 'review', REVIEW_GRAPH)
    expect(afterCommit).toHaveLength(1)
  })

  it('enqueues NOTHING when the landed stage is a normal (non-capability) step', () => {
    const afterCommit: Array<() => Promise<void>> = []
    scheduleCapabilityAutoRun(
      { ...base, afterCommit },
      'matter-1',
      'intake_submitted',
      REVIEW_GRAPH,
    )
    scheduleCapabilityAutoRun({ ...base, afterCommit }, 'matter-1', 'done', REVIEW_GRAPH)
    expect(afterCommit).toHaveLength(0)
  })

  it('is a safe no-op when there is no post-commit queue (never runs inline)', () => {
    // No afterCommit array → cannot schedule safely → does nothing, no throw.
    expect(() => scheduleCapabilityAutoRun(base, 'matter-1', 'review', REVIEW_GRAPH)).not.toThrow()
  })
})

describe('capability handler registry (ADR 0046)', () => {
  it('knows the two REAL handler keys', () => {
    expect(isHandlerImplemented('legal.capability.ai_document_review.run')).toBe(true)
    expect(isHandlerImplemented('legal.capability.request_client_materials.run')).toBe(true)
  })

  it('reports a contracted-but-unbuilt capability as NOT implemented', () => {
    // esignature is contracted (step_invocable) but has no runtime handler yet — the
    // executor raises a clear "not yet executable" error, never a simulated success.
    expect(isHandlerImplemented('legal.capability.esignature.run')).toBe(false)
    expect(isHandlerImplemented(undefined)).toBe(false)
    expect(isHandlerImplemented('nope')).toBe(false)
  })
})
