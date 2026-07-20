// legal.matter.advance (ADR 0045 PR3) — the auditable action that advances ONE
// matter one step through its bound lifecycle. This is the manual gate path
// (attorney/client "Continue"/approve) and the wrapper a system callback uses to
// record an advance as a real action. It:
//   1. finds the matter's running workflow_instance (errors if there is none),
//   2. is idempotent (already in to_state → no-op),
//   3. GUARDS the transition against the bound graph (resolve.allowedTransitions):
//      a to_state not reachable from the current state via an edge of the given
//      gate is rejected — the graph, not the caller, decides what is legal,
//   4. advances the instance (state_history append),
//   5. MIRRORS matter_status via insertAttribute with gate-appropriate provenance,
//   6. emits workflow.advanced (is_state_change) on the matter.
//
// Provenance: system/automatic gates write source_type 'system', source_ref
// 'system:workflow_engine'; attorney/client gates write source_type 'human',
// source_ref = ctx.actorId. Knowability/precision/confidence are the normal
// observed / exact_instant / 1.0 for a status write.
//
// intent_kind: set by the SUBMISSION layer (PR4 api/), not here — the handler
// signature has no access to the action's intent_kind. The convention the api
// adapter follows: system/automatic gate → 'automatic_sync', attorney/client →
// 'adjustment'. The action kind's default_autonomy_tier is 'notify'.
import { registerActionHandler } from '@exsto/substrate'
import { insertAttribute, insertEvent, lookupKindId } from './common.js'
import { getWorkflowInstanceForMatter, resolveBoundWorkflowById } from '../lifecycle/binding.js'
import { advanceWorkflowInstance } from '../lifecycle/instance.js'
import { allowedTransitions, stageByKey } from '../lifecycle/resolve.js'
import { settleStage } from '../lifecycle/settle.js'
import type { GateKind } from '../lifecycle/types.js'

interface MatterAdvancePayload {
  matter_entity_id: string
  to_state: string
  gate: GateKind
  // Optional label for what triggered this advance (event kind, action, "continue"),
  // recorded on the workflow.advanced event for the audit trail.
  trigger?: string
  // HOTFIX-P17 (L1): set ONLY by the sanctioned client-step skip (api/clientGate.ts
  // skipClientStage), which separately records a skip decision. It permits this
  // advance to traverse a CLIENT edge whose `via` is a client action (booking.create,
  // document.upload, …) that the client never took. It NEVER permits skipping a
  // blocking attorney step (a draft.approve edge) — see the mechanism guard below.
  skip?: boolean
}

registerActionHandler('legal.matter.advance', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as MatterAdvancePayload

  const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, p.matter_entity_id)
  if (!instance) {
    throw new Error(
      `legal.matter.advance: matter ${p.matter_entity_id} has no workflow instance to advance.`,
    )
  }

  const rawCurrentState = instance.currentState

  // Idempotent: a repeated advance to the state we are already in is a no-op.
  if (rawCurrentState === p.to_state) {
    return {
      workflowInstanceId: instance.id,
      from: rawCurrentState,
      to: p.to_state,
      advanced: false,
    }
  }

  // Resolve the bound graph (the version this matter runs; invariant 17). A
  // per-instance override supersedes the bound version for this matter.
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

  // GUARD 1 (reachability): the to_state must be reachable from the current state
  // via an edge of this gate. The graph decides legality, not the caller.
  const matchedEdge = allowedTransitions(graph, rawCurrentState, [p.gate]).find(
    (e) => e.to === p.to_state,
  )
  if (!matchedEdge) {
    throw new Error(
      `legal.matter.advance: illegal transition ${rawCurrentState} → ${p.to_state} ` +
        `via gate '${p.gate}' (no matching edge in the bound lifecycle).`,
    )
  }

  // GUARD 2 (mechanism) — HOTFIX-P17 L1: gate + destination is NOT enough. An edge
  // names in `via` the ACTION that legitimately completes the step it leaves.
  // `legal.matter.advance` is the "Continue" token; an edge whose `via` is a DIFFERENT
  // action (e.g. `draft.approve`, which reviews → approves → SENDS → bills the
  // document) is finished by THAT action's own handler, not by a bare Continue. Moving
  // the matter across such an edge with Continue would skip the real step — the
  // M-MRJHEC8X defect: a Continue silently traversed the review/send edge, so the
  // letter was never sent, no fee was invoiced, and the history falsely recorded
  // draft.approve. The ONLY sanctioned exception is the attorney explicitly SKIPPING a
  // CLIENT-gated step (skipClientStage sets skip:true and records the skip separately);
  // a blocking attorney step (a draft.approve edge) is never skippable this way.
  if (matchedEdge.via && matchedEdge.via !== 'legal.matter.advance') {
    const sanctionedClientSkip = p.skip === true && matchedEdge.gate === 'client'
    if (!sanctionedClientSkip) {
      throw new Error(
        `This step isn't finished by clicking Continue — it has its own action to complete it ` +
          `(for a review step, open it and approve/send the document). ` +
          `Finish that step to move the matter forward.`,
      )
    }
  }

  // Provenance is the ACTOR's, never the caller-asserted gate (hard rule 4): a
  // human-submitted advance writes 'human' / ctx.actorId; only a system/agent actor
  // writes 'system' provenance. And only the system may FIRE a system/automatic edge
  // — a human cannot self-assert a system gate (e.g. to close a matter and bypass the
  // real invoice.paid callback), which would forge the append-only audit trail.
  const actorRes = await client.query<{ actor_type: string }>(
    `SELECT actor_type FROM actor WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, ctx.actorId],
  )
  const isSystemActor = (actorRes.rows[0]?.actor_type ?? 'human') !== 'human'
  if ((p.gate === 'system' || p.gate === 'automatic') && !isSystemActor) {
    throw new Error(
      `legal.matter.advance: gate '${p.gate}' may only be fired by a system actor, ` +
        `not ${ctx.actorId} — a system/automatic transition must come from its event/callback.`,
    )
  }
  const sourceType = isSystemActor ? 'system' : 'human'
  const sourceRef = isSystemActor ? 'system:workflow_engine' : ctx.actorId

  const toStage = stageByKey(graph, p.to_state)
  const via = matchedEdge.via

  await advanceWorkflowInstance(client, ctx, {
    instanceId: instance.id,
    fromState: rawCurrentState,
    toState: p.to_state,
    gate: p.gate,
    via,
    status: toStage?.terminal ? 'completed' : undefined,
    actionId,
  })

  // Mirror matter_status so the existing read path (queries that read the
  // matter_status attribute) stays the source of truth for the matter's stage.
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
    value: p.to_state,
    confidence: 1.0,
    knowabilityState: 'observed',
    timePrecision: 'exact_instant',
    sourceType,
    sourceRef,
  })

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'workflow.advanced',
    primaryEntityId: p.matter_entity_id,
    data: {
      from: rawCurrentState,
      to: p.to_state,
      gate: p.gate,
      trigger: p.trigger ?? null,
    },
    sourceType,
    sourceRef,
  })

  // WF-FIX-1 — settle the landing: pass through non-blocking stage(s), then schedule
  // the producing auto-run (post-commit, never inside this transaction) for the
  // stage the matter rests on.
  await settleStage(client, ctx, p.matter_entity_id, p.to_state, graph, actionId)

  return {
    workflowInstanceId: instance.id,
    from: rawCurrentState,
    to: p.to_state,
    advanced: true,
  }
})
