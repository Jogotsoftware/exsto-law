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
  // Whether the matter is (or was moved) ONTO its terminal stage. When false at a
  // matter that runs a workflow, the completion is "off-workflow" and gets noted — but
  // only AFTER legal.service.complete actually SUCCEEDS (below), never before its
  // integrity gate has had its say (HOTFIX-P17: a refused completion must leave no
  // stray "completed off-workflow" observation).
  let landedTerminal = false
  if (info && info.graph.length > 0) {
    const current = stageByKey(info.graph, info.currentState)
    if (current?.terminal) {
      landedTerminal = true
    } else if (current) {
      // Best-effort: the attorney edge from the CURRENT stage to a terminal stage
      // (the declared completion step).
      //
      // HOTFIX-P17 (L1): only a genuine "Continue" edge (via legal.matter.advance) may
      // be auto-fired here. A terminal edge finished by its own action — e.g.
      // `draft.approve` (review → approve → SEND → bill) — must NOT be crossed by
      // completion: doing so would archive the matter without the document ever being
      // sent or billed (the M-MRJHEC8X defect). When the terminal step is a
      // draft.approve step, we leave the matter parked; legal.service.complete's
      // integrity gate then refuses with what's unfinished.
      const edge = allowedTransitions(info.graph, info.currentState, ['attorney']).find(
        (e) =>
          stageByKey(info.graph, e.to)?.terminal && (!e.via || e.via === 'legal.matter.advance'),
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
        landedTerminal = true
      }
    }
  }

  // Accrue the service completion fee — AND run the integrity gate (handlers/fee.ts):
  // refuses (before any accrual/archive) if a blocking step is unfinished or a declared
  // fee was silently dropped. A throw here propagates: nothing is archived, and no
  // off-workflow observation is recorded.
  const completion = await completeService(ctx, matterEntityId)

  // The completion SUCCEEDED. If the matter ran a workflow but did not finish on its
  // terminal stage (the gate allowed it — no blocking step remained), record that fact
  // on the timeline; never silently smoothed over.
  if (info && info.graph.length > 0 && !landedTerminal) {
    await submitAction(ctx, {
      actionKindName: 'event.record',
      intentKind: 'adjustment',
      payload: {
        event_kind_name: 'observation',
        primary_entity_id: matterEntityId,
        data: { kind: 'matter_completed_off_workflow', at_stage: finalState },
        source_type: 'human',
        source_ref: ctx.actorId,
      },
    })
  }

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
