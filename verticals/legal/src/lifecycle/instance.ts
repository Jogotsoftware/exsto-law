// The ONLY code in the legal vertical that writes workflow_instance (ADR 0045 PR3).
// Both functions take the action's pg client so every write commits inside the
// action's transaction (invariant 9). They mirror the foundation primitives in
// packages/primitives/src/handlers/governance.ts (workflow.start / workflow.advance)
// rather than re-registering them, because the legal engine needs richer
// state_history entries (from/gate/via) than the generic primitive records, and
// needs to set started_at deterministically per instance. The SQL INSERT/UPDATE
// shape is otherwise identical.
//
// state_history is APPEND-ONLY: a DB trigger (migration 0093) rejects any UPDATE
// that does not keep OLD's elements as a positional prefix of NEW. advance only
// ever appends one entry, so it satisfies that.
import { randomUUID } from 'node:crypto'
import type { DbClient } from '@exsto/shared'
import type { GateKind } from './types.js'

interface Ctx {
  tenantId: string
  actorId: string
}

// Create a fresh instance in `currentState`. state_history starts with the entry
// record, mirroring workflow.start. Returns the new instance id.
export async function createWorkflowInstance(
  client: DbClient,
  ctx: Ctx,
  args: {
    workflowDefinitionId: string
    subjectEntityId: string
    currentState: string
    actionId: string
  },
): Promise<string> {
  const id = randomUUID()
  const history = [
    { state: args.currentState, at: new Date().toISOString(), action_id: args.actionId },
  ]
  await client.query(
    `INSERT INTO workflow_instance
       (id, tenant_id, action_id, workflow_definition_id, subject_entity_id, current_state, state_history)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      id,
      ctx.tenantId,
      args.actionId,
      args.workflowDefinitionId,
      args.subjectEntityId,
      args.currentState,
      JSON.stringify(history),
    ],
  )
  return id
}

// Advance an instance from `fromState` to `toState`, recording WHO/HOW (gate, via)
// and appending a rich history entry. Mirrors workflow.advance's UPDATE shape but
// appends a structured entry (the primitive appends only {state, action_id}).
// `status` defaults to leaving the row's status unchanged.
export async function advanceWorkflowInstance(
  client: DbClient,
  ctx: Ctx,
  args: {
    instanceId: string
    fromState: string
    toState: string
    gate: GateKind
    via?: string
    status?: string
    actionId: string
    // WF-FIX-1: a settle hop through a non-blocking stage. Recorded in the history
    // entry so a pass-through is distinguishable from a gated advance forever after
    // (the 0093 trigger only enforces prefix-append; extra fields are safe).
    passThrough?: boolean
  },
): Promise<void> {
  const entry = {
    state: args.toState,
    from: args.fromState,
    gate: args.gate,
    via: args.via ?? null,
    action_id: args.actionId,
    at: new Date().toISOString(),
    ...(args.passThrough ? { pass_through: true } : {}),
  }
  const r = await client.query(
    `UPDATE workflow_instance
        SET current_state = $3,
            status = COALESCE($4, status),
            state_history = state_history || $5::jsonb
      WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, args.instanceId, args.toState, args.status ?? null, JSON.stringify(entry)],
  )
  if (r.rowCount === 0) throw new Error(`Workflow instance not found: ${args.instanceId}`)
}
