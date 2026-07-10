// BACKHALF-BLOCKS-1 (WP3) — the two ways past a CLIENT-gated stage:
//   • acceptClientStage — the CLIENT accepts the review step from the portal. Fires
//     the (previously dormant) legal.client_request.accept action in its matter
//     form; the handler records client_request.accepted on the matter and advances
//     the client gate via dispatchClientDelivery (edge `via` =
//     'legal.client_request.accept').
//   • skipClientStage — the ATTORNEY advances past a client-gated stage without the
//     client (Contract W skip). Fires legal.matter.advance on the client edge,
//     attributed to the attorney actor, plus an observation recording that the
//     client step was skipped. Works ONLY on a stage with a client edge.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { getWorkflowInstanceForMatter, resolveBoundWorkflowById } from '../lifecycle/binding.js'
import { allowedTransitions } from '../lifecycle/resolve.js'
import type { Lifecycle } from '../lifecycle/types.js'

export interface AcceptClientStageResult {
  matterEntityId: string
  accepted: boolean
  advancedTo: string | null
}

export async function acceptClientStage(
  ctx: ActionContext,
  input: { matterEntityId: string; clientContactId?: string; note?: string },
): Promise<AcceptClientStageResult> {
  if (!input.matterEntityId?.trim()) throw new Error('matterEntityId is required.')
  const res = await submitAction(ctx, {
    actionKindName: 'legal.client_request.accept',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: input.matterEntityId,
      client_contact_id: input.clientContactId ?? null,
      note: input.note ?? null,
    },
  })
  return res.effects[0] as AcceptClientStageResult
}

export interface SkipClientStageResult {
  advancedTo: string
  skippedStage: string
}

export async function skipClientStage(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<SkipClientStageResult> {
  if (!matterEntityId?.trim()) throw new Error('matterEntityId is required.')

  // Resolve the current stage's CLIENT edge (read-only). Skip is defined ONLY for
  // client-gated stages — anything else is a caller error, not a silent no-op.
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
  if (!info || info.graph.length === 0) {
    throw new Error(`Matter ${matterEntityId} has no running workflow to skip a stage on.`)
  }
  const clientEdge = allowedTransitions(info.graph, info.currentState, ['client'])[0]
  if (!clientEdge) {
    throw new Error(
      `Stage "${info.currentState}" is not client-gated — skip applies only to a stage waiting on the client.`,
    )
  }

  // The attorney fires the client edge (a human MAY fire a client gate — only
  // system/automatic gates are actor-restricted). Recorded + attributed to the
  // attorney by the advance handler's own provenance rules.
  await submitAction(ctx, {
    actionKindName: 'legal.matter.advance',
    intentKind: 'adjustment',
    payload: {
      matter_entity_id: matterEntityId,
      to_state: clientEdge.to,
      gate: 'client',
      trigger: 'attorney.skip',
    },
  })

  // The honest audit: the client step was SKIPPED by the attorney, not delivered.
  await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'adjustment',
    payload: {
      event_kind_name: 'observation',
      primary_entity_id: matterEntityId,
      data: {
        kind: 'client_step_skipped_by_attorney',
        skipped_stage: info.currentState,
        advanced_to: clientEdge.to,
      },
      source_type: 'human',
      source_ref: ctx.actorId,
    },
  })

  return { advancedTo: clientEdge.to, skippedStage: info.currentState }
}
