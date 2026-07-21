// ADR 0046 — the CLIENT-DISPATCH fix. A matter parked at a CLIENT gate must advance
// from the client's OWN real action (a booking, a portal upload, a portal reply) —
// not require the attorney to press "Continue" (legal.matter.advance) in the Workflow
// window. Before this, only system callbacks (invoice.paid, esign.completed,
// transcript.received) dispatched lifecycle advances; a client edge's `via` was
// audit metadata that nothing fired.
//
// This helper is the client-side sibling of executor.dispatchLifecycleEvent: the
// client action's handler calls it at the end of its own transaction (invariant 9),
// so the advance commits with the very action that delivered. It matches the current
// stage's `client` edge whose `via` equals the action kind, advances the instance,
// mirrors matter_status to the new stage, and emits workflow.advanced. Flag-guarded
// no-op; a no-op too when the matter has no instance or no matching client edge (so a
// handler can call it unconditionally without knowing whether THIS matter runs one).
import type { DbClient } from '@exsto/shared'
import { closeOpenAttribute, insertAttribute, insertEvent, lookupKindId } from './common.js'
import { workflowEngineEnabled } from '../lifecycle/flags.js'
import { getWorkflowInstanceForMatter, resolveBoundWorkflowById } from '../lifecycle/binding.js'
import { advanceWorkflowInstance } from '../lifecycle/instance.js'
import { allowedTransitions, stageByKey } from '../lifecycle/resolve.js'
import { settleStage } from '../lifecycle/settle.js'

interface Ctx {
  tenantId: string
  actorId: string
}

export async function dispatchClientDelivery(
  client: DbClient,
  ctx: Ctx,
  matterEntityId: string,
  actionKind: string,
  actionId: string,
  // The honest provenance of the delivery when known (e.g. `client_contact:<id>` for
  // a portal upload/reply). Falls back to the acting actor (booking runs as the
  // public-intake actor, same as booking.create's own status write).
  clientProvenanceRef?: string | null,
): Promise<{ from: string; to: string } | null> {
  if (!workflowEngineEnabled()) return null

  const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, matterEntityId)
  if (!instance) return null

  const from = instance.currentState
  let graph =
    instance.statesOverride && instance.statesOverride.length > 0 ? instance.statesOverride : []
  if (graph.length === 0) {
    const bound = await resolveBoundWorkflowById(
      client,
      ctx.tenantId,
      instance.workflowDefinitionId,
    )
    graph = bound?.graph ?? []
  }
  if (graph.length === 0) return null

  // The client edge out of the current stage whose `via` is this action. If the
  // matter already advanced past it (idempotent re-delivery) there is no such edge.
  const edge = allowedTransitions(graph, from, ['client']).find((e) => e.via === actionKind)
  if (!edge) return null

  const toStage = stageByKey(graph, edge.to)
  const sourceRef = clientProvenanceRef ?? ctx.actorId

  await advanceWorkflowInstance(client, ctx, {
    instanceId: instance.id,
    fromState: from,
    toState: edge.to,
    gate: 'client',
    via: actionKind,
    status: toStage?.terminal ? 'completed' : undefined,
    actionId,
  })

  // Mirror matter_status to the new stage (the graph is authoritative — last write
  // wins even if the client handler wrote its own status hint). Honest provenance:
  // the client delivered it.
  const statusKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'matter_status',
  )
  await closeOpenAttribute(client, ctx.tenantId, matterEntityId, statusKindId)
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: matterEntityId,
    attributeKindId: statusKindId,
    value: edge.to,
    confidence: 1.0,
    knowabilityState: 'observed',
    timePrecision: 'exact_instant',
    sourceType: 'human',
    sourceRef,
  })

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'workflow.advanced',
    primaryEntityId: matterEntityId,
    data: { from, to: edge.to, gate: 'client', trigger: actionKind },
    sourceType: 'human',
    sourceRef,
  })

  // WF-FIX-1 — settle the landing: pass through non-blocking stage(s); the producing
  // auto-run for the resting stage still fires AFTER commit, so the client
  // self-serve path stays autonomous with no attorney/route trigger.
  await settleStage(client, ctx, matterEntityId, edge.to, graph, actionId)

  return { from, to: edge.to }
}
