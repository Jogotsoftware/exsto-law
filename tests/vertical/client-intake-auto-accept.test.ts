// WF-FIX-2 #6 — a matter opened BY the client's OWN funnel intake auto-completes
// the entry intake stage: the submission IS the client's acceptance, so matter.open
// dispatches the client delivery for the intake stage's CLIENT-accept edge
// (via 'legal.client_request.accept') — advancing intake → drafting with zero
// attorney clicks. An attorney-opened matter omits the flag and PARKS at intake so
// the manual "Record client acceptance / Skip" card still governs.
//
// Executor-level proof (no DB), mirroring intake-edge-fix.test.ts's fake client:
//   • funnel path  → dispatchClientDelivery('legal.client_request.accept') advances
//     the entry stage's client-accept edge (and settles onward);
//   • attorney/pre-fix path → the SYSTEM intake.completed dispatch matter.open
//     always emits is a structural NO-OP against a CLIENT edge, so the matter parks
//     at intake (the M-MRUVEIH0 repro) — only the client-accept dispatch moves it.
import { describe, it, expect, beforeAll } from 'vitest'
import { signalEvent, type Lifecycle } from '@exsto/legal'
import { dispatchClientDelivery } from '../../verticals/legal/src/handlers/clientDelivery.js'

const TENANT = '00000000-0000-0000-00fe-000000000001'
const MATTER = 'matter-1'
const ACTION = 'action-1'
const CLIENT_ACTOR = 'client-portal-actor'

// dispatchClientDelivery is flag-gated (workflowEngineEnabled) exactly like the
// live engine seam — enable it for this suite.
beforeAll(() => {
  process.env.LEGAL_WORKFLOW_ENGINE = '1'
})

// The entry intake stage carries a CLIENT-accept edge — the shape that parked
// M-MRUVEIH0 "Waiting on the client" until someone fired legal.client_request.accept.
const CLIENT_ACCEPT_GRAPH: Lifecycle = [
  {
    key: 'client_intake',
    label: 'Client intake',
    client_label: 'Client intake',
    entry: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'drafting', gate: 'client', via: 'legal.client_request.accept' }],
  },
  {
    key: 'drafting',
    label: 'Draft the document',
    action: { kind: 'generate_document' },
    documents: [{ docKind: 'operating_agreement' }],
    advances_to: [{ to: 'done', gate: 'attorney', via: 'draft.approve' }],
  },
  { key: 'done', label: 'Done', terminal: true, advances_to: [] },
]

interface Captured {
  advances: Array<Record<string, unknown>>
}
function fakeClient(graph: Lifecycle, startState: string) {
  const captured: Captured = { advances: [] }
  let currentState = startState
  let pendingEventKind: string | null = null
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflow_instance')) {
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
      if (sql.includes('FROM workflow_definition')) {
        return { rows: [{ id: 'def-1', version: 1, states: graph, status: 'active' }], rowCount: 1 }
      }
      if (sql.includes('UPDATE workflow_instance')) {
        currentState = params?.[2] as string
        captured.advances.push(JSON.parse(params?.[4] as string))
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('FROM event_kind_definition')) {
        pendingEventKind = params?.[1] as string
        return { rows: [{ id: `ek-${pendingEventKind}` }], rowCount: 1 }
      }
      if (sql.includes('FROM attribute_kind_definition')) {
        return { rows: [{ id: 'ak-matter-status' }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO event')) return { rows: [], rowCount: 1 }
      if (sql.includes('UPDATE attribute SET valid_to')) return { rows: [], rowCount: 0 }
      if (sql.includes('INSERT INTO attribute')) return { rows: [], rowCount: 1 }
      throw new Error(`fakeClient: unscripted SQL: ${sql.slice(0, 80)}`)
    },
  }
  return { client, captured, state: () => currentState }
}

describe('WF-FIX-2 #6: client-created matter auto-accepts the intake stage', () => {
  it('funnel path: the client-accept dispatch advances intake → drafting (no attorney click)', async () => {
    const { client, captured, state } = fakeClient(CLIENT_ACCEPT_GRAPH, 'client_intake')
    const ctx = { tenantId: TENANT, actorId: CLIENT_ACTOR }

    const moved = await dispatchClientDelivery(
      client as unknown as Parameters<typeof dispatchClientDelivery>[0],
      ctx,
      MATTER,
      'legal.client_request.accept',
      ACTION,
    )

    expect(moved).toEqual({ from: 'client_intake', to: 'drafting' })
    expect(state()).toBe('drafting')
    // The client-accept advance is the recorded hop out of the intake stage.
    expect(captured.advances[0]).toMatchObject({ from: 'client_intake', state: 'drafting' })
  })

  it('attorney/pre-fix path: the system intake.completed dispatch is a no-op on a CLIENT edge — the matter PARKS at intake', async () => {
    const { client, captured, state } = fakeClient(CLIENT_ACCEPT_GRAPH, 'client_intake')
    const ctx = { tenantId: TENANT, actorId: 'system-actor' }

    // matter.open always emits intake.completed (SYSTEM). Against a CLIENT-accept
    // edge it matches nothing — the matter stays put until the client-accept
    // dispatch (funnel) or the manual acceptance card (attorney) fires.
    await signalEvent(
      client as unknown as Parameters<typeof signalEvent>[0],
      ctx,
      MATTER,
      'intake.completed',
      ACTION,
    )

    expect(captured.advances).toHaveLength(0)
    expect(state()).toBe('client_intake')
  })
})
