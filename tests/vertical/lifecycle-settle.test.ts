// WF-FIX-1 — settleStage: the runtime meaning of blocking:false. A matter landing on
// a non-blocking stage passes through it immediately (recording honest history +
// events), stops at blocking/producing/terminal boundaries, mirrors matter_status
// once at rest, and schedules the producing auto-run for the resting stage. These
// tests drive the real settleStage against a scripted DbClient (no DB): the SQL the
// fake answers is the exact shape binding/instance/common issue; the DB-backed proof
// is the sandbox acceptance harness (demo/service-flow-fix-acceptance.ts).
import { describe, it, expect } from 'vitest'
import { settleStage, type AutoRunCtx, type Lifecycle } from '@exsto/legal'

const TENANT = '00000000-0000-0000-00fe-000000000001'
const MATTER = 'matter-1'
const ACTION = 'action-1'

interface Captured {
  advances: Array<Record<string, unknown>>
  events: Array<{ kind: string; payload: Record<string, unknown> }>
  statusMirrors: Array<unknown>
}

// A scripted client: answers the instance SELECT, kind lookups, and captures every
// write. `instanceState` is null to simulate a matter with no workflow instance.
// The structural shape settleStage needs is just `query` — typed via the first
// parameter of settleStage itself so the fake tracks the real DbClient contract.
type SettleClient = Parameters<typeof settleStage>[0]

function fakeClient(instanceState: string | null): { client: SettleClient; captured: Captured } {
  const captured: Captured = { advances: [], events: [], statusMirrors: [] }
  let currentState = instanceState
  let pendingEventKind: string | null = null
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflow_instance')) {
        if (currentState === null) return { rows: [], rowCount: 0 }
        return {
          rows: [
            {
              id: 'wfi-1',
              workflow_definition_id: 'def-1',
              subject_entity_id: MATTER,
              current_state: currentState,
              state_history: [],
              status: 'active',
              states_override: null,
            },
          ],
          rowCount: 1,
        }
      }
      if (sql.includes('UPDATE workflow_instance')) {
        currentState = params?.[2] as string
        const entry = JSON.parse(params?.[4] as string)
        captured.advances.push(entry)
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('FROM event_kind_definition')) {
        pendingEventKind = params?.[1] as string
        return { rows: [{ id: `ek-${pendingEventKind}` }], rowCount: 1 }
      }
      if (sql.includes('FROM attribute_kind_definition')) {
        return { rows: [{ id: 'ak-matter-status' }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO event')) {
        captured.events.push({
          kind: pendingEventKind ?? 'unknown',
          payload: JSON.parse(params?.[6] as string),
        })
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO attribute')) {
        captured.statusMirrors.push(JSON.parse(params?.[5] as string))
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`fakeClient: unscripted SQL: ${sql.slice(0, 80)}`)
    },
  }
  return { client: client as unknown as SettleClient, captured }
}

function ctxWithQueue(): AutoRunCtx & { afterCommit: Array<() => Promise<void>> } {
  return { tenantId: TENANT, actorId: 'actor-1', afterCommit: [] }
}

// consultation (non-blocking) → notice (non-blocking) → review (producing) → done.
const PASSTHROUGH_GRAPH: Lifecycle = [
  {
    key: 'consultation',
    label: 'Client consultation',
    entry: true,
    blocking: false,
    action: { kind: 'view_consultation' },
    advances_to: [{ to: 'notice', gate: 'system', on: 'transcript.received' }],
  },
  {
    key: 'notice',
    label: 'Heads-up step',
    blocking: false,
    action: { kind: 'manual_task' },
    advances_to: [{ to: 'review', gate: 'attorney', via: 'legal.matter.advance' }],
  },
  {
    key: 'review',
    label: 'AI review',
    action: {
      kind: 'invoke_capability',
      config: { capability_slug: 'ai_document_review', capability_config: { rubric: 'r' } },
    },
    advances_to: [{ to: 'done', gate: 'attorney', via: 'draft.approve' }],
  },
  { key: 'done', label: 'Done', terminal: true, advances_to: [] },
]

describe('settleStage (WF-FIX-1 non-blocking pass-through)', () => {
  it('chains through consecutive non-blocking stages and rests on the producing stage', async () => {
    const { client, captured } = fakeClient('consultation')
    const ctx = ctxWithQueue()
    const final = await settleStage(client, ctx, MATTER, 'consultation', PASSTHROUGH_GRAPH, ACTION)

    expect(final).toBe('review')
    // Two hops, each recording the edge's REAL gate + pass_through marker.
    expect(captured.advances).toHaveLength(2)
    expect(captured.advances[0]).toMatchObject({
      from: 'consultation',
      state: 'notice',
      gate: 'system',
      pass_through: true,
    })
    expect(captured.advances[1]).toMatchObject({
      from: 'notice',
      state: 'review',
      gate: 'attorney',
      pass_through: true,
    })
    const advancedEvents = captured.events.filter((e) => e.kind === 'workflow.advanced')
    expect(advancedEvents).toHaveLength(2)
    expect(advancedEvents.every((e) => e.payload.trigger === 'pass_through:non_blocking')).toBe(
      true,
    )
    // Status mirrored ONCE, at the resting stage.
    expect(captured.statusMirrors).toEqual(['review'])
    // The producing resting stage got exactly one scheduled auto-run.
    expect(ctx.afterCommit).toHaveLength(1)
  })

  it('is a bare schedule on a blocking landing stage (zero hops, no writes)', async () => {
    const { client, captured } = fakeClient('review')
    const ctx = ctxWithQueue()
    const final = await settleStage(client, ctx, MATTER, 'review', PASSTHROUGH_GRAPH, ACTION)

    expect(final).toBe('review')
    expect(captured.advances).toHaveLength(0)
    expect(captured.events).toHaveLength(0)
    expect(captured.statusMirrors).toHaveLength(0)
    expect(ctx.afterCommit).toHaveLength(1) // review is producing → scheduled
  })

  it('never walks past a producing stage, even one explicitly marked non-blocking', async () => {
    const graph: Lifecycle = [
      {
        key: 'auto_review',
        label: 'AI review (marked informational by mistake)',
        blocking: false,
        action: { kind: 'invoke_capability', config: { capability_slug: 'ai_document_review' } },
        advances_to: [{ to: 'later', gate: 'attorney', via: 'legal.matter.advance' }],
      },
      { key: 'later', label: 'Later', advances_to: [], action: { kind: 'manual_task' } },
    ]
    const { client, captured } = fakeClient('auto_review')
    const ctx = ctxWithQueue()
    const final = await settleStage(client, ctx, MATTER, 'auto_review', graph, ACTION)

    expect(final).toBe('auto_review')
    expect(captured.advances).toHaveLength(0)
    expect(ctx.afterCommit).toHaveLength(1) // entered to RUN, not to walk past
  })

  it('refuses to pass through into a terminal stage and records the refusal', async () => {
    const graph: Lifecycle = [
      {
        key: 'fyi',
        label: 'FYI step',
        blocking: false,
        action: { kind: 'view_consultation' },
        advances_to: [{ to: 'done', gate: 'automatic' }],
      },
      { key: 'done', label: 'Done', terminal: true, advances_to: [] },
    ]
    const { client, captured } = fakeClient('fyi')
    const ctx = ctxWithQueue()
    const final = await settleStage(client, ctx, MATTER, 'fyi', graph, ACTION)

    expect(final).toBe('fyi')
    expect(captured.advances).toHaveLength(0)
    const obs = captured.events.filter((e) => e.kind === 'observation')
    expect(obs).toHaveLength(1)
    expect(obs[0].payload).toMatchObject({
      kind: 'pass_through_stopped_at_terminal_edge',
      stage: 'fyi',
      terminal_stage: 'done',
    })
  })

  it('terminates on a cyclic non-blocking graph (loop guard)', async () => {
    const graph: Lifecycle = [
      {
        key: 'a',
        label: 'A',
        blocking: false,
        action: { kind: 'view_consultation' },
        advances_to: [{ to: 'b', gate: 'automatic' }],
      },
      {
        key: 'b',
        label: 'B',
        blocking: false,
        action: { kind: 'view_consultation' },
        advances_to: [{ to: 'a', gate: 'automatic' }],
      },
    ]
    const { client, captured } = fakeClient('a')
    const ctx = ctxWithQueue()
    await settleStage(client, ctx, MATTER, 'a', graph, ACTION)
    // Bounded by graph.length + 1 — it must stop, and quickly.
    expect(captured.advances.length).toBeLessThanOrEqual(graph.length + 1)
  })

  it('still schedules the auto-run when the matter has no workflow instance', async () => {
    const { client, captured } = fakeClient(null)
    const ctx = ctxWithQueue()
    const final = await settleStage(client, ctx, MATTER, 'review', PASSTHROUGH_GRAPH, ACTION)

    expect(final).toBe('review')
    expect(captured.advances).toHaveLength(0)
    expect(ctx.afterCommit).toHaveLength(1)
  })
})
