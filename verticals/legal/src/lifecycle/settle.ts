// SETTLE (WF-FIX-1) — non-blocking pass-through. A stage with blocking:false is an
// INFORMATIONAL step ("never holds the matter", types.ts LifecycleStage.blocking), but
// until this module nothing in the runtime read that flag: the advance engine parked a
// matter on a non-blocking stage exactly as if it were blocking, waiting on an edge
// token that (for e.g. a non-blocking consultation) might never fire. settleStage is
// the one place that makes the flag true at runtime: whenever a matter LANDS on a
// stage — instance creation at entry, a manual advance, a system signal, an automatic
// hop — the engine "settles" it forward through consecutive non-blocking stages, then
// schedules the producing auto-run for the stage it actually rests on.
//
// Semantics (deliberate):
//   • Pass-through ignores the outgoing edge's GATE — that is what non-blocking means.
//     The hop records the edge's real gate/token honestly (state_history + event), it
//     just does not WAIT on them. Authoring-side, a token on a non-blocking stage's
//     outgoing edge draws a validator warning (workflowAuthoring), so this is never a
//     silent surprise.
//   • Pass-through NEVER enters a terminal stage. Completion has side effects (fee
//     accrual, completion integrity, archive) that must stay behind the completion
//     step's own action — the engine stops and records an observation instead.
//   • Pass-through NEVER skips a PRODUCING stage (a kind with an auto-run runner):
//     entering one means "run it", not "walk past it" — the settle loop stops there
//     and the scheduled auto-run takes over.
//   • The matter_status mirror is written ONCE, for the final landing stage —
//     intermediate non-blocking states are transient inside a single transaction.
//
// This module runs INSIDE the wrapping action's transaction (invariant 9): every hop
// rides the caller's actionId; the only post-commit work is the producing auto-run
// enqueue, which keeps the #303 invariant (no model work on an advance transaction).
//
// Import note: helpers come from handlers/common.js (substrate-write wrappers with no
// lifecycle imports — no cycle); loadInstanceForMatter lives in executor.ts which
// imports THIS file, so the instance/graph are resolved here via binding.js directly.
import type { DbClient } from '@exsto/shared'
import {
  closeOpenAttribute,
  insertAttribute,
  insertEvent,
  lookupKindId,
} from '../handlers/common.js'
import { getWorkflowInstanceForMatter } from './binding.js'
import { advanceWorkflowInstance } from './instance.js'
import { hasProducingRunner, scheduleProducingAutoRun, type AutoRunCtx } from './autoRun.js'
import { edgesFrom, isBlockingStage, stageByKey } from './resolve.js'
import type { Lifecycle } from './types.js'

const ENGINE_SOURCE = 'system:workflow_engine'

// Settle a matter that just landed on `landedStageKey`: pass through consecutive
// non-blocking stages, mirror matter_status once if the matter moved, and schedule
// the producing auto-run for the final landing stage. Drop-in replacement for a bare
// scheduleProducingAutoRun call at every landing site — on a blocking landing stage
// it performs zero hops and only schedules, which is exactly the old behavior.
// Returns the stage key the matter actually rests on.
export async function settleStage(
  client: DbClient,
  ctx: AutoRunCtx,
  matterEntityId: string,
  landedStageKey: string,
  graph: Lifecycle,
  actionId: string,
): Promise<string> {
  if (!graph || graph.length === 0) {
    scheduleProducingAutoRun(ctx, matterEntityId, landedStageKey, graph ?? [])
    return landedStageKey
  }

  const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, matterEntityId)
  if (!instance) {
    scheduleProducingAutoRun(ctx, matterEntityId, landedStageKey, graph)
    return landedStageKey
  }
  // The instance is the truth for where the matter is — a caller-passed key that
  // drifted (e.g. a concurrent hop in the same transaction) must not fork history.
  let current = instance.currentState

  // Bound like advanceMatter's automatic chain: defends against a cyclic graph.
  for (let guard = 0; guard < graph.length + 1; guard++) {
    const stage = stageByKey(graph, current)
    if (!stage || stage.terminal) break
    if (isBlockingStage(stage)) break
    // A producing stage is entered to RUN, never walked past (see header).
    if (hasProducingRunner(stage.action?.kind)) break

    // Linear graphs carry exactly one outgoing edge; `when` predicates are the
    // executor's stub that always holds (executor.whenHolds — not imported here to
    // avoid a settle⇄executor cycle; re-unify when the predicate registry lands).
    const edge = edgesFrom(graph, current)[0]
    if (!edge) break

    const toStage = stageByKey(graph, edge.to)
    if (toStage?.terminal) {
      // Never auto-complete. Record the refusal so an authored
      // non-blocking-into-terminal shape is queryable, then hold position.
      await insertEvent(client, {
        tenantId: ctx.tenantId,
        actionId,
        eventKindName: 'observation',
        primaryEntityId: matterEntityId,
        data: {
          kind: 'pass_through_stopped_at_terminal_edge',
          stage: current,
          terminal_stage: edge.to,
        },
        sourceType: 'system',
        sourceRef: ENGINE_SOURCE,
      })
      break
    }

    await advanceWorkflowInstance(client, ctx, {
      instanceId: instance.id,
      fromState: current,
      toState: edge.to,
      gate: edge.gate,
      via: edge.via ?? edge.on,
      actionId,
      passThrough: true,
    })
    await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName: 'workflow.advanced',
      primaryEntityId: matterEntityId,
      data: {
        from: current,
        to: edge.to,
        gate: edge.gate,
        trigger: 'pass_through:non_blocking',
      },
      sourceType: 'system',
      sourceRef: ENGINE_SOURCE,
    })
    current = edge.to
  }

  if (current !== instance.currentState) {
    // Mirror once, at rest (the callers mirrored their own hop; this covers the
    // settled hops so the read path never shows a stage the matter already left).
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
      value: current,
      confidence: 1.0,
      knowabilityState: 'observed',
      timePrecision: 'exact_instant',
      sourceType: 'system',
      sourceRef: ENGINE_SOURCE,
    })
  }

  scheduleProducingAutoRun(ctx, matterEntityId, current, graph)
  return current
}
