// B1.1 (item 7 — the intake-edge rewire). Funnel finalize runs
// `intake.submit → matter.open → booking.create`; matter.open (post-#415) emits
// `intake.completed` as a SYSTEM event in the SAME action that opens the matter.
// The OA workflow's stage-1 edge used to be `{gate:'client', via:'booking.create'}`
// — signalEvent (executor.ts) only ever matches system/automatic `on:` edges, so
// dispatching `intake.completed` against that edge was a structural no-op and a
// matter whose booking never independently re-fired dispatchClientDelivery sat
// "Waiting on the client" forever.
//
// Two layers here: (1) a shape assertion pinning the corrected edge literal in both
// NC_SMLLC_AUTHORED (authored.ts) and the derived legacy-backfill graph (derive.ts
// parity), and (2) an executor-level proof — no DB — that dispatching
// `intake.completed` from the entry stage now actually advances the instance, and
// (because `consultation_booked` is `blocking:false`, an existing WF-FIX-1
// settle.ts behavior this test does not change) settles straight through to the
// attorney review stage in the same call, matching what dispatchClientDelivery has
// always done when a real booking landed there.
import { describe, it, expect } from 'vitest'
import {
  NC_SMLLC_AUTHORED,
  deriveLifecycleFromService,
  edgesFrom,
  signalEvent,
  type Lifecycle,
} from '@exsto/legal'

const TENANT = '00000000-0000-0000-00fe-000000000001'
const MATTER = 'matter-1'
const ACTION = 'action-1'

describe('B1.1 shape: stage-1 edge fires on intake.completed (system), not booking.create (client)', () => {
  it('NC_SMLLC_AUTHORED: intake_submitted → consultation_booked is a system edge on intake.completed', () => {
    expect(edgesFrom(NC_SMLLC_AUTHORED, 'intake_submitted')).toEqual([
      { to: 'consultation_booked', gate: 'system', on: 'intake.completed' },
    ])
  })

  it('derive.ts parity: the booking branch of intake_submitted is the same system edge', () => {
    const lc = deriveLifecycleFromService({ route: 'manual', bookingEnabled: true })
    const bookingEdge = edgesFrom(lc, 'intake_submitted').find(
      (e) => e.to === 'consultation_booked',
    )
    expect(bookingEdge).toEqual({
      to: 'consultation_booked',
      gate: 'system',
      on: 'intake.completed',
    })
  })

  it('derive.ts: booking disabled still carries no booking edge at all (unchanged)', () => {
    const lc = deriveLifecycleFromService({ route: 'manual', bookingEnabled: false })
    expect(edgesFrom(lc, 'intake_submitted').some((e) => e.to === 'consultation_booked')).toBe(
      false,
    )
  })
})

// A scripted client mirroring lifecycle-settle.test.ts's fake — extended with the
// `workflow_definition` branch executor.loadInstanceForMatter needs (settleStage's
// own fake never resolves a definition by id; signalEvent does, via
// resolveBoundWorkflowById).
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
        return {
          rows: [{ id: 'def-1', version: 1, states: graph, status: 'active' }],
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
      if (sql.includes('INSERT INTO event')) return { rows: [], rowCount: 1 }
      // WF-FIX-2 #1: matter_status writers close the prior open row (valid_to)
      // before inserting the new one — acknowledge the close.
      if (sql.includes('UPDATE attribute SET valid_to')) return { rows: [], rowCount: 0 }
      if (sql.includes('INSERT INTO attribute')) return { rows: [], rowCount: 1 }
      throw new Error(`fakeClient: unscripted SQL: ${sql.slice(0, 80)}`)
    },
  }
  return {
    client: client as unknown as Parameters<typeof signalEvent>[0],
    captured,
    state: () => currentState,
  }
}

describe('B1.1 executor proof: intake.completed now fires the stage-1 edge (no DB)', () => {
  it('signalEvent(intake.completed) advances past consultation_booked to in_review, same as a real booking always has', async () => {
    const { client, captured, state } = fakeClient(NC_SMLLC_AUTHORED, 'intake_submitted')
    const ctx = { tenantId: TENANT, actorId: 'system-actor' }

    await signalEvent(client, ctx, MATTER, 'intake.completed', ACTION)

    // Two hops recorded: the gated system advance into consultation_booked, then
    // settle's pass-through (blocking:false) into in_review.
    expect(captured.advances.map((a) => a.state)).toEqual(['consultation_booked', 'in_review'])
    expect(captured.advances[0]).toMatchObject({ gate: 'system', from: 'intake_submitted' })
    expect(captured.advances[1]).toMatchObject({ pass_through: true, from: 'consultation_booked' })
    expect(state()).toBe('in_review')
  })

  it('the OLD shape (client/via:booking.create) was a structural no-op for this same dispatch — regression guard', async () => {
    const oldShapeGraph: Lifecycle = NC_SMLLC_AUTHORED.map((s) =>
      s.key === 'intake_submitted'
        ? {
            ...s,
            advances_to: [{ to: 'consultation_booked', gate: 'client', via: 'booking.create' }],
          }
        : s,
    )
    const { client, captured, state } = fakeClient(oldShapeGraph, 'intake_submitted')
    const ctx = { tenantId: TENANT, actorId: 'system-actor' }

    await signalEvent(client, ctx, MATTER, 'intake.completed', ACTION)

    expect(captured.advances).toHaveLength(0)
    expect(state()).toBe('intake_submitted')
  })
})
