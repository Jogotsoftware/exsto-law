// legal.matter.repin_workflow (WF-FIX-1 WP4) — move ONE in-flight matter onto its
// service's LATEST workflow version.
//
// Saving a service workflow seals the old version and inserts v+1; matters in
// flight keep the version they were opened on (invariant 17 — the pin is
// DB-trigger-immutable, 0093 workflow_instance_definition_immutable). That is the
// right default, but it left NO path for the attorney who fixed a broken workflow
// and needs the fix to reach a live matter (the Pacheco repro: "I updated the
// workflow in services but it didn't update on the matter").
//
// Because the pin cannot be UPDATEd, repin creates a SUCCESSOR instance: the old
// instance is closed out as status='cancelled' (the only CHECK-legal way to say
// "this run yields to another" — 0008 constrains status to active/completed/
// cancelled) and a fresh workflow_instance is created bound to the latest
// definition at the reconciled state. getWorkflowInstanceForMatter resolves
// latest-by-started_at, so the successor wins every read naturally; the old
// instance's state_history stays intact (append-only spirit — nothing is edited).
// The workflow.repinned event links the two.
//
// current_state reconcile: keep the stage when its key exists in the new graph;
// else use the caller's explicit target_state; else fail listing the new graph's
// stages verbatim. A per-matter states_override is a deliberate customization —
// repin REFUSES unless clear_override is passed (the successor simply does not
// copy it, which IS the clear).
import { registerActionHandler } from '@exsto/substrate'
import { getLatestAttributeValue, insertAttribute, insertEvent, lookupKindId } from './common.js'
import { getWorkflowInstanceForMatter, resolveCurrentServiceVersion } from '../lifecycle/binding.js'
import { createWorkflowInstance } from '../lifecycle/instance.js'
import { settleStage } from '../lifecycle/settle.js'
import { stageByKey } from '../lifecycle/resolve.js'

interface MatterRepinPayload {
  matter_entity_id: string
  // Where the matter should resume when its current stage key no longer exists in
  // the new graph. Ignored when the key carries over.
  target_state?: string
  // Explicit consent to discard a per-matter states_override customization.
  clear_override?: boolean
}

registerActionHandler('legal.matter.repin_workflow', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as MatterRepinPayload

  const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, p.matter_entity_id)
  if (!instance) {
    throw new Error(
      `legal.matter.repin_workflow: matter ${p.matter_entity_id} has no workflow instance — ` +
        `use legal.matter.set_workflow with start:true to stand one up first.`,
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
      `legal.matter.repin_workflow: matter ${p.matter_entity_id} has no service_key — cannot resolve a lifecycle.`,
    )
  }
  // CURRENT (not active-only) — mirrors the repair path's reasoning: the attorney
  // is explicitly moving THIS matter to the service's present workflow, even if the
  // service was since disabled for new bookings.
  const bound = await resolveCurrentServiceVersion(client, ctx.tenantId, serviceKey)
  if (!bound) {
    throw new Error(
      `legal.matter.repin_workflow: service "${serviceKey}" has no authored lifecycle to repin to.`,
    )
  }
  if (bound.workflowDefinitionId === instance.workflowDefinitionId) {
    return {
      repinned: false,
      workflowInstanceId: instance.id,
      version: bound.version,
      state: instance.currentState,
      summary: 'Already on the latest workflow version.',
    }
  }

  const hasOverride = !!instance.statesOverride && instance.statesOverride.length > 0
  if (hasOverride && p.clear_override !== true) {
    throw new Error(
      `legal.matter.repin_workflow: this matter runs a customized workflow (states_override). ` +
        `Repinning to the service's latest version would discard that customization — pass ` +
        `clear_override: true to proceed, or re-tailor the matter after repinning.`,
    )
  }

  // State reconcile: an EXPLICIT target_state wins outright — when a new version
  // REORDERS stages, a same-key carry-over can drop the matter far past where it
  // really is (the live repro: v6 moved 'consultation' after drafting, so carrying
  // the key over would have skipped intake+review entirely). Absent a target:
  // same-key carries over; a missing key fails listing the exact valid keys
  // (matterWorkflow.ts orphan-guard style).
  const target = p.target_state?.trim()
  if (target && !stageByKey(bound.graph, target)) {
    throw new Error(
      `legal.matter.repin_workflow: target_state "${target}" is not a stage of the new ` +
        `workflow (v${bound.version}). Valid stages: ` +
        bound.graph.map((s) => s.key).join(', '),
    )
  }
  let nextState = instance.currentState
  let stateMapped = false
  if (target) {
    nextState = target
    stateMapped = target !== instance.currentState
  } else if (!stageByKey(bound.graph, nextState)) {
    throw new Error(
      `legal.matter.repin_workflow: the new workflow (v${bound.version}) has no stage ` +
        `"${instance.currentState}". Pass target_state as one of: ` +
        bound.graph.map((s) => s.key).join(', '),
    )
  }

  // Close out the old instance. current_state in the predicate is the TOCTOU
  // guard: 0 rows means the matter advanced while this action was composing —
  // refresh and retry rather than repinning a stale picture.
  const closed = await client.query(
    `UPDATE workflow_instance
        SET status = 'cancelled'
      WHERE tenant_id = $1 AND id = $2 AND current_state = $3`,
    [ctx.tenantId, instance.id, instance.currentState],
  )
  if (closed.rowCount === 0) {
    throw new Error(
      `legal.matter.repin_workflow: the matter advanced while repinning (stage is no longer ` +
        `"${instance.currentState}") — reload and retry.`,
    )
  }

  const successorId = await createWorkflowInstance(client, ctx, {
    workflowDefinitionId: bound.workflowDefinitionId,
    subjectEntityId: p.matter_entity_id,
    currentState: nextState,
    actionId,
  })

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'workflow.repinned',
    primaryEntityId: p.matter_entity_id,
    data: {
      service_key: serviceKey,
      from_definition_id: instance.workflowDefinitionId,
      to_definition_id: bound.workflowDefinitionId,
      to_version: bound.version,
      from_instance_id: instance.id,
      to_instance_id: successorId,
      state: nextState,
      state_mapped: stateMapped,
      override_cleared: hasOverride,
    },
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })

  // A mapped state is a real stage change — mirror matter_status so the read path
  // never shows a stage the new graph doesn't have (settle only mirrors when IT
  // moves the matter further).
  if (stateMapped) {
    const statusKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      'matter_status',
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: p.matter_entity_id,
      attributeKindId: statusKindId,
      value: nextState,
      confidence: 1.0,
      knowabilityState: 'observed',
      timePrecision: 'exact_instant',
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }

  // Settle the successor: this is what UNSTICKS the matter — pass-through drains a
  // non-blocking prefix and the producing auto-run fires for the resting stage.
  const settledState = await settleStage(
    client,
    ctx,
    p.matter_entity_id,
    nextState,
    bound.graph,
    actionId,
  )

  return {
    repinned: true,
    workflowInstanceId: successorId,
    supersededInstanceId: instance.id,
    version: bound.version,
    state: settledState,
    stateMapped,
    overrideCleared: hasOverride,
  }
})
