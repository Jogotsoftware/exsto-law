// legal.matter.set_workflow (ADR 0045 PR6) — the auditable action that customizes
// ONE matter's workflow graph WITHOUT touching the service's default lifecycle. It
// writes the tailored graph to workflow_instance.states_override (migration 0108),
// which the executor/handler/matter read path already prefer over the bound graph
// when present (invariant 17). The service's workflow_definition.states is NEVER
// written here — that is the whole point: per-matter tailoring is local to the one
// matter. It:
//   1. resolves the matter's running workflow_instance (errors if there is none),
//   2. VALIDATES the proposed graph (validateLifecycle + validateLinearLifecycle):
//      an out-of-catalog action.kind or a non-linear graph is rejected — the same
//      closed-vocabulary + linear rules the AI/manual service authoring path obeys,
//   3. CONSISTENCY GUARD: the instance's current_state must still exist as a stage
//      key in the new graph — a customization that would orphan the matter's current
//      step is rejected (the critical safety check),
//   4. writes states_override on the instance through the action layer (UPDATE on the
//      passed client — same pattern as advanceWorkflowInstance; the UPDATE touches
//      only states_override, so it passes both 0093 BEFORE UPDATE triggers),
//   5. emits workflow.customized on the matter with ACTOR-derived provenance.
//
// Provenance is the ACTOR's (hard rule 4): a human attorney writes source_type
// 'human' / ctx.actorId; a system/agent actor writes 'system'. intent_kind
// ('adjustment') is set by the submission layer (api/matterWorkflow.ts), not here.
import { registerActionHandler } from '@exsto/substrate'
import { getLatestAttributeValue, insertEvent } from './common.js'
import { getWorkflowInstanceForMatter, resolveCurrentServiceVersion } from '../lifecycle/binding.js'
import { createWorkflowInstance } from '../lifecycle/instance.js'
import {
  validateLifecycle,
  validateLinearLifecycle,
  validateBlockingReachability,
  stageByKey,
  entryStage,
} from '../lifecycle/resolve.js'
import type { Lifecycle } from '../lifecycle/types.js'

interface MatterSetWorkflowPayload {
  matter_entity_id: string
  states?: Lifecycle
  // MACHINE-COMMS-1 (WP0) — REPAIR mode: stand up the workflow instance for an
  // EXISTING matter that has none (the silent-skip class). Instantiates from the
  // matter's service CURRENT definition — the lifecycle that was approved for the
  // service, even if the service has since been disabled: the attorney is
  // explicitly repairing THIS matter, not booking a new one. current_state resumes
  // at the stage matching matter_status when the graph has one, else the entry.
  start?: boolean
}

registerActionHandler('legal.matter.set_workflow', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as MatterSetWorkflowPayload
  const graph = Array.isArray(p.states) ? p.states : []

  const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, p.matter_entity_id)

  if (p.start === true) {
    if (instance) {
      throw new Error(
        `legal.matter.set_workflow: matter ${p.matter_entity_id} already has a workflow instance — nothing to repair.`,
      )
    }
    const serviceKey = await getLatestAttributeValue<string>(
      client,
      ctx.tenantId,
      p.matter_entity_id,
      'service_key',
    )
    if (!serviceKey) {
      throw new Error(
        `legal.matter.set_workflow: matter ${p.matter_entity_id} has no service_key — cannot resolve a lifecycle to start.`,
      )
    }
    const bound = await resolveCurrentServiceVersion(client, ctx.tenantId, serviceKey)
    if (!bound) {
      throw new Error(
        `legal.matter.set_workflow: service "${serviceKey}" has no authored lifecycle — nothing to instantiate. Give the service a workflow first.`,
      )
    }
    const matterStatus = await getLatestAttributeValue<string>(
      client,
      ctx.tenantId,
      p.matter_entity_id,
      'matter_status',
    )
    const statusStage = matterStatus ? stageByKey(bound.graph, matterStatus) : null
    const startState = statusStage?.key ?? entryStage(bound.graph)?.key ?? 'intake_submitted'
    const instanceId = await createWorkflowInstance(client, ctx, {
      workflowDefinitionId: bound.workflowDefinitionId,
      subjectEntityId: p.matter_entity_id,
      currentState: startState,
      actionId,
    })
    // workflow.started is a runtime-defined event kind (demo/seed-comms-kinds.ts);
    // the repair control requires the seed — a tenant without it fails loudly here,
    // which is correct (the receipt IS the point of the event).
    await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName: 'workflow.started',
      primaryEntityId: p.matter_entity_id,
      data: {
        service_key: serviceKey,
        workflow_definition_id: bound.workflowDefinitionId,
        version: bound.version,
        definition_status: bound.status,
        start_state: startState,
        repair: true,
      },
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
    return {
      workflowInstanceId: instanceId,
      started: true,
      startState,
      stageCount: bound.graph.length,
    }
  }

  if (!instance) {
    throw new Error(
      `legal.matter.set_workflow: matter ${p.matter_entity_id} has no workflow instance to customize.`,
    )
  }

  // VALIDATE: the per-matter graph is held to the SAME rules as the authored service
  // graph — structural validity incl. the closed step-action vocabulary, plus the
  // linear-only constraint (one step leads to one next step). Reject before any write.
  const structural = validateLifecycle(graph)
  const linear = validateLinearLifecycle(graph)
  // HOTFIX-P17 (L1): a per-matter customization may not add a shortcut that skips a
  // blocking step on the way to completion.
  const blocking = validateBlockingReachability(graph)
  const errors = [...structural.errors, ...linear.errors, ...blocking.errors]
  if (errors.length > 0) {
    throw new Error(`legal.matter.set_workflow: invalid workflow graph: ${errors.join('; ')}`)
  }

  // CONSISTENCY GUARD (the critical safety check): the matter's CURRENT step must
  // still exist as a stage key in the new graph. A customization that removes or
  // renames the stage the matter is parked on would orphan the matter — its
  // current_state would point at a stage the graph no longer has. This pre-read check
  // gives a clear message for the common case (the editor dropped the current step);
  // the WHERE clause on the UPDATE below makes the same guard ATOMIC with the write,
  // closing the TOCTOU window where a concurrent legal.matter.advance moves the matter
  // to a state the new graph lacks between this read and the write.
  if (!stageByKey(graph, instance.currentState)) {
    throw new Error(
      `legal.matter.set_workflow: the new graph has no stage "${instance.currentState}" — ` +
        `it would orphan the matter's current step. Keep the current step in the workflow.`,
    )
  }

  // Provenance derived from the ACTOR, not asserted by the caller (hard rule 4):
  // a human attorney → 'human' / ctx.actorId; a system/agent actor → 'system'.
  const actorRes = await client.query<{ actor_type: string }>(
    `SELECT actor_type FROM actor WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, ctx.actorId],
  )
  const isSystemActor = (actorRes.rows[0]?.actor_type ?? 'human') !== 'human'
  const sourceType = isSystemActor ? 'system' : 'human'
  const sourceRef = isSystemActor ? 'system:workflow_engine' : ctx.actorId

  // Write the override on the instance through the action layer (this handler IS the
  // action layer). Touches ONLY states_override — not state_history, not
  // workflow_definition_id — so both migration-0093 triggers pass. Tenant-scoped.
  //
  // The WHERE clause re-asserts the orphan guard ATOMICALLY against the row's LIVE
  // current_state (not the value read above): the override is written only if the
  // matter's current step is still a stage in the new graph. Under READ COMMITTED, a
  // concurrent legal.matter.advance on this instance serializes on the row lock and
  // this UPDATE re-reads the committed current_state — so a matter that advanced out
  // from under us matches 0 rows instead of being orphaned.
  const r = await client.query(
    `UPDATE workflow_instance
        SET states_override = $3::jsonb
      WHERE tenant_id = $1 AND id = $2
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements($3::jsonb) AS s
          WHERE s ->> 'key' = current_state
        )`,
    [ctx.tenantId, instance.id, JSON.stringify(graph)],
  )
  if (r.rowCount === 0) {
    // The instance exists (resolved above), so 0 rows means the atomic orphan guard
    // failed: the matter's current step is no longer in the proposed graph — almost
    // always because it advanced concurrently. Surface a refresh-and-retry message.
    throw new Error(
      `legal.matter.set_workflow: the matter's current step is no longer in the proposed ` +
        `workflow (it may have advanced) — refresh the matter and re-apply your changes.`,
    )
  }

  // Emit workflow.customized on the matter. NOT a state change (the graph changed,
  // the current_state did not), so the event kind is is_state_change=false.
  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'workflow.customized',
    primaryEntityId: p.matter_entity_id,
    data: { stage_count: graph.length },
    sourceType,
    sourceRef,
  })

  return { workflowInstanceId: instance.id, stageCount: graph.length }
})
