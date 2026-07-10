// ADR 0046 — the capability runtime's PURE surface: the invoke_capability step kind
// is in the closed catalog (so validateLifecycle accepts a stage that runs a
// capability, and rejects a made-up kind), and the handler registry knows exactly
// which capabilities are executable today. The DB-backed paths (the authoring
// validator against the live registry, the executor, the client-delivery dispatch)
// are proven by the sandbox end-to-end receipts in the decision log.
import { describe, it, expect, vi } from 'vitest'
// PROD-DRAFT-OFFLOAD-1: the generate_document autorun now ENQUEUES the manual-path
// legal.draft.run worker_job instead of drafting inline in the request. Mock the queue
// (and the action layer the enqueue records its draft.requested receipt through) so the
// wiring is asserted without a DB — spread the real modules so every other export stays
// intact.
vi.mock('@exsto/worker-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exsto/worker-runtime')>()
  return { ...actual, enqueueJob: vi.fn(async () => 'job-1') }
})
vi.mock('@exsto/substrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exsto/substrate')>()
  return { ...actual, submitAction: vi.fn(async () => ({ actionId: 'a', effects: [] })) }
})
import { enqueueJob } from '@exsto/worker-runtime'
import { submitAction } from '@exsto/substrate'
import {
  STEP_ACTION_KINDS,
  validateLifecycle,
  validateLinearLifecycle,
  isHandlerImplemented,
  scheduleProducingAutoRun,
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

describe('scheduleProducingAutoRun — WP1 auto-run scheduling (ADR 0046)', () => {
  const base = { tenantId: 't', actorId: 'a' }

  it('enqueues a post-commit callback when the landed stage runs a capability', () => {
    const afterCommit: Array<() => Promise<void>> = []
    scheduleProducingAutoRun({ ...base, afterCommit }, 'matter-1', 'review', REVIEW_GRAPH)
    expect(afterCommit).toHaveLength(1)
  })

  it('enqueues NOTHING when the landed stage is a normal (non-capability) step', () => {
    const afterCommit: Array<() => Promise<void>> = []
    scheduleProducingAutoRun({ ...base, afterCommit }, 'matter-1', 'intake_submitted', REVIEW_GRAPH)
    scheduleProducingAutoRun({ ...base, afterCommit }, 'matter-1', 'done', REVIEW_GRAPH)
    expect(afterCommit).toHaveLength(0)
  })

  it('is a safe no-op when there is no post-commit queue (never runs inline)', () => {
    // No afterCommit array → cannot schedule safely → does nothing, no throw.
    expect(() => scheduleProducingAutoRun(base, 'matter-1', 'review', REVIEW_GRAPH)).not.toThrow()
  })
})

// RUNTIME-AUTORUN-2 — the producing-autorun generalizes past invoke_capability: a
// generate_document stage auto-runs on entry too, and the dispatch is CLASS-BASED
// (producing kind + automatic advancing edge), not a hardcoded 'generate_document'.
const WILL_GRAPH: Lifecycle = [
  {
    key: 'client_intake',
    label: 'Client intake',
    entry: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'generate_will', gate: 'client', via: 'document.upload' }],
  },
  {
    key: 'generate_will',
    label: 'Generate the will',
    action: { kind: 'generate_document' },
    documents: [{ docKind: 'will' }],
    // Producing + AUTOMATIC → auto-runs on entry.
    advances_to: [{ to: 'review_send_will', gate: 'automatic', on: 'draft.completed' }],
  },
  {
    key: 'review_send_will',
    label: 'Review & send the will',
    action: { kind: 'review_send_document' },
    // Attorney gate → a human step; must NOT auto-run.
    advances_to: [{ to: 'complete', gate: 'attorney', via: 'draft.approve' }],
  },
  {
    key: 'complete',
    label: 'Complete',
    terminal: true,
    action: { kind: 'complete_matter' },
    advances_to: [],
  },
]

describe('generate_document producing auto-run — RUNTIME-AUTORUN-2', () => {
  const base = { tenantId: 't', actorId: 'a' }

  it('enqueues a post-commit run when a matter enters a generate_document + automatic stage', () => {
    const afterCommit: Array<() => Promise<void>> = []
    scheduleProducingAutoRun({ ...base, afterCommit }, 'matter-1', 'generate_will', WILL_GRAPH)
    expect(afterCommit).toHaveLength(1)
  })

  it('does NOT auto-run the attorney-gated review step (human gates still wait)', () => {
    const afterCommit: Array<() => Promise<void>> = []
    scheduleProducingAutoRun({ ...base, afterCommit }, 'matter-1', 'review_send_will', WILL_GRAPH)
    expect(afterCommit).toHaveLength(0)
  })

  it('does NOT auto-run a generate_document stage whose advancing edge is NOT automatic', () => {
    // The "producing + automatic" rule: a producing step an attorney advances by hand
    // (attorney gate) does not autofire.
    const manualGen: Lifecycle = [
      {
        key: 'gen',
        label: 'Generate (attorney-triggered)',
        entry: true,
        action: { kind: 'generate_document' },
        documents: [{ docKind: 'will' }],
        advances_to: [{ to: 'done', gate: 'attorney', via: 'draft.approve' }],
      },
      {
        key: 'done',
        label: 'Done',
        terminal: true,
        action: { kind: 'complete_matter' },
        advances_to: [],
      },
    ]
    const afterCommit: Array<() => Promise<void>> = []
    scheduleProducingAutoRun({ ...base, afterCommit }, 'matter-1', 'gen', manualGen)
    expect(afterCommit).toHaveLength(0)
  })

  it('dispatch is class-based: both producing kinds route through the same scheduler', () => {
    // invoke_capability (REVIEW_GRAPH 'review') and generate_document (WILL_GRAPH
    // 'generate_will') both enqueue through the ONE scheduler — no kind is special-cased
    // in the caller. A future producing kind slots in by adding a registry entry.
    const a: Array<() => Promise<void>> = []
    const b: Array<() => Promise<void>> = []
    scheduleProducingAutoRun({ ...base, afterCommit: a }, 'm', 'review', REVIEW_GRAPH)
    scheduleProducingAutoRun({ ...base, afterCommit: b }, 'm', 'generate_will', WILL_GRAPH)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })
})

describe('generate_document autorun OFFLOAD — drafting leaves the request (PROD-DRAFT-OFFLOAD-1)', () => {
  const base = { tenantId: 't1', actorId: 'a1' }

  it('the scheduled callback ENQUEUES the manual-path legal.draft.run job (never drafts inline)', async () => {
    const afterCommit: Array<() => Promise<void>> = []
    scheduleProducingAutoRun({ ...base, afterCommit }, 'matter-1', 'generate_will', WILL_GRAPH)
    expect(afterCommit).toHaveLength(1)
    vi.mocked(enqueueJob).mockClear()
    await afterCommit[0]!()
    expect(enqueueJob).toHaveBeenCalledTimes(1)
    expect(enqueueJob).toHaveBeenCalledWith({
      tenantId: 't1',
      jobKind: 'legal.draft.run',
      payload: { matter_entity_id: 'matter-1', document_kind: 'will', producing_autorun: true },
    })
  })

  it('records draft.requested with the job id (manual-path parity, queryable on the matter)', async () => {
    const afterCommit: Array<() => Promise<void>> = []
    scheduleProducingAutoRun({ ...base, afterCommit }, 'matter-1', 'generate_will', WILL_GRAPH)
    vi.mocked(submitAction).mockClear()
    await afterCommit[0]!()
    expect(submitAction).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
      expect.objectContaining({
        actionKindName: 'event.record',
        payload: expect.objectContaining({
          event_kind_name: 'draft.requested',
          primary_entity_id: 'matter-1',
          data: expect.objectContaining({
            document_kind: 'will',
            job_id: 'job-1',
            producing_autorun: true,
          }),
        }),
      }),
    )
  })
})

describe('capability handler registry (ADR 0046)', () => {
  it('knows the REAL handler keys', () => {
    expect(isHandlerImplemented('legal.capability.ai_document_review.run')).toBe(true)
    expect(isHandlerImplemented('legal.capability.request_client_materials.run')).toBe(true)
    // ESIGN-BLOCK-1 (WP2): esignature joined the real handlers — send via the
    // existing native e-sign engine, park at the system gate until esign.completed.
    expect(isHandlerImplemented('legal.capability.esignature.run')).toBe(true)
  })

  it('reports a contracted-but-unbuilt capability as NOT implemented', () => {
    expect(isHandlerImplemented(undefined)).toBe(false)
    expect(isHandlerImplemented('nope')).toBe(false)
  })
})
