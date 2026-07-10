// BACKHALF-BLOCKS-1 (WP2) — complete + archive a matter, executing the workflow's
// declared completion step (Contract W: POST .../complete). Wires EXISTING machinery
// only:
//   • best-effort advance to the terminal stage when the CURRENT stage has an
//     attorney edge leading to one (legal.matter.advance — the graph stays the
//     authority on legality; a matter parked elsewhere completes "off-workflow" and
//     that fact is recorded, never hidden),
//   • legal.service.complete — accrues the service's completion fee via
//     handlers/fee.ts (idempotent per matter + service),
//   • entity.archive — the matter is ARCHIVED (status flip, append-only, reversible),
//     NEVER deleted.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { getWorkflowInstanceForMatter, resolveBoundWorkflowById } from '../lifecycle/binding.js'
import { allowedTransitions, stageByKey } from '../lifecycle/resolve.js'
import type { Lifecycle } from '../lifecycle/types.js'
import { completeService } from './fees.js'

export interface CompleteMatterResult {
  completed: boolean
  archived: boolean
  // The service completion fee accrued by legal.service.complete (null when the
  // service declares none or it already accrued).
  feeAccrued: string | null
  // Where the workflow instance ended up ('' when the matter runs no instance).
  finalState: string
}

export async function completeMatter(
  ctx: ActionContext,
  matterEntityId: string,
  opts: { archive: boolean },
): Promise<CompleteMatterResult> {
  if (!matterEntityId?.trim()) throw new Error('matterEntityId is required.')

  // Resolve the instance + graph (read-only). No instance is fine — a legacy matter
  // still completes (fee + archive); there is just no stage to advance.
  const info = await withActionContext(ctx, async (client) => {
    const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, matterEntityId)
    if (!instance) return null
    let graph: Lifecycle =
      instance.statesOverride && instance.statesOverride.length > 0 ? instance.statesOverride : []
    if (graph.length === 0) {
      const bound = await resolveBoundWorkflowById(
        client,
        ctx.tenantId,
        instance.workflowDefinitionId,
      )
      graph = bound?.graph ?? []
    }
    return { currentState: instance.currentState, graph }
  })

  let finalState = info?.currentState ?? ''
  if (info && info.graph.length > 0) {
    const current = stageByKey(info.graph, info.currentState)
    if (current && !current.terminal) {
      // Best-effort: the attorney edge from the CURRENT stage to a terminal stage
      // (the declared completion step). Absent one, we do NOT force the graph — the
      // completion is recorded as off-workflow below.
      const edge = allowedTransitions(info.graph, info.currentState, ['attorney']).find(
        (e) => stageByKey(info.graph, e.to)?.terminal,
      )
      if (edge) {
        await submitAction(ctx, {
          actionKindName: 'legal.matter.advance',
          intentKind: 'adjustment',
          payload: {
            matter_entity_id: matterEntityId,
            to_state: edge.to,
            gate: 'attorney',
            trigger: 'matter.complete',
          },
        })
        finalState = edge.to
      } else {
        // Completing a matter that is NOT at (or one attorney-step from) its
        // completion stage is allowed — the attorney is the authority — but the
        // fact is recorded on the timeline, never silently smoothed over.
        await submitAction(ctx, {
          actionKindName: 'event.record',
          intentKind: 'adjustment',
          payload: {
            event_kind_name: 'observation',
            primary_entity_id: matterEntityId,
            data: { kind: 'matter_completed_off_workflow', at_stage: info.currentState },
            source_type: 'human',
            source_ref: ctx.actorId,
          },
        })
      }
    }
  }

  // Accrue the service completion fee (idempotent — handlers/fee.ts).
  const completion = await completeService(ctx, matterEntityId)

  let archived = false
  if (opts.archive) {
    await submitAction(ctx, {
      actionKindName: 'entity.archive',
      intentKind: 'enforcement',
      payload: { entity_id: matterEntityId },
    })
    archived = true
  }

  return { completed: true, archived, feeAccrued: completion.amount, finalState }
}
