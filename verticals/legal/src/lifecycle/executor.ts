// Lifecycle EXECUTOR (ADR 0045 PR3) — the engine that decides which transitions
// fire and drives the workflow_instance forward. It composes the pure resolver
// (resolve.ts), the version-pinned binding (binding.ts), and the instance writer
// (instance.ts). All writes go through advanceWorkflowInstance on the passed client.
//
// What it does NOT do: it does not mirror matter_status or emit events — that is the
// legal.matter.advance handler's job (handlers/workflow.ts). The executor moves the
// instance; the handler is the auditable action that wraps a single manual advance.
// advanceMatter()/signalEvent() are the system/automatic drivers (worker, callbacks).
//
// NOTE on NC_SMLLC: the authored 5-step workflow has NO `automatic` edges, so
// advanceMatter() is a no-op chain for it (the loop finds no automatic edge and
// returns []). That is correct: advanceMatter is the GENERIC auto-chainer for any
// future lifecycle that does have automatic edges; keeping it generic is the point.
import type { DbClient } from '@exsto/shared'
import {
  getWorkflowInstanceForMatter,
  resolveBoundWorkflowById,
  type MatterWorkflowInstance,
} from './binding.js'
import { workflowEngineEnabled } from './flags.js'
import { advanceWorkflowInstance } from './instance.js'
import { edgesFrom, stageByKey } from './resolve.js'
import { scheduleCapabilityAutoRun } from './autoRun.js'
import type { Lifecycle, LifecycleEdge } from './types.js'

interface Ctx {
  tenantId: string
  actorId: string
}

export interface LoadedInstance {
  instance: MatterWorkflowInstance
  graph: Lifecycle
}

// Guard-predicate stub. ADR 0045 reserves `when` (a predicate key) on an edge as a
// branching guard. PR3 ships the SHAPE but no predicate registry yet, so every
// predicate "holds". When the registry lands, this dispatches on predicateKey
// (e.g. read a matter attribute) using the passed context; until then it is true so
// an edge with `when` behaves exactly like one without — no silent blocking.
export function whenHolds(
  _predicateKey: string | undefined,
  _client?: DbClient,
  _ctx?: Ctx,
  _matterEntityId?: string,
): boolean {
  return true
}

// Load the matter's running instance plus the graph of the VERSION it is bound to
// (invariant 17). A per-instance states_override, when present, supersedes the bound
// version's graph for this matter. Returns null when the matter has no instance.
export async function loadInstanceForMatter(
  client: DbClient,
  ctx: Ctx,
  matterEntityId: string,
): Promise<LoadedInstance | null> {
  const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, matterEntityId)
  if (!instance) return null

  if (instance.statesOverride && instance.statesOverride.length > 0) {
    return { instance, graph: instance.statesOverride }
  }
  const bound = await resolveBoundWorkflowById(client, ctx.tenantId, instance.workflowDefinitionId)
  return { instance, graph: bound?.graph ?? [] }
}

// The first automatic outgoing edge from `stageKey` whose `when` predicate holds.
function nextAutomaticEdge(
  graph: Lifecycle,
  stageKey: string,
  client: DbClient,
  ctx: Ctx,
  matterEntityId: string,
): LifecycleEdge | null {
  for (const e of edgesFrom(graph, stageKey)) {
    if (e.gate === 'automatic' && whenHolds(e.when, client, ctx, matterEntityId)) return e
  }
  return null
}

// Drive the instance forward through every consecutive `automatic` edge whose guard
// holds, advancing the instance (and recording state_history) for each hop. Stops at
// a stage with no firing automatic edge (manual/attorney/client/system gate) or a
// terminal. Idempotent: a matter already parked on a manual stage advances 0 hops.
// Returns the chain of hops performed (empty when nothing fired). Does NOT mirror
// matter_status — the caller (the system advance path) does that per hop.
export async function advanceMatter(
  client: DbClient,
  ctx: Ctx,
  matterEntityId: string,
  actionId: string, // the real action wrapping this system/automatic drive (no placeholder)
): Promise<Array<{ from: string; to: string; gate: string; via?: string }>> {
  const loaded = await loadInstanceForMatter(client, ctx, matterEntityId)
  if (!loaded) return []
  const { instance, graph } = loaded
  if (graph.length === 0) return []

  const chain: Array<{ from: string; to: string; gate: string; via?: string }> = []
  let current = instance.currentState
  // Bound the loop by the stage count to defend against a cyclic automatic graph.
  for (let guard = 0; guard < graph.length + 1; guard++) {
    const edge = nextAutomaticEdge(graph, current, client, ctx, matterEntityId)
    if (!edge) break
    const toStage = stageByKey(graph, edge.to)
    const status = toStage?.terminal ? 'completed' : undefined
    await advanceWorkflowInstance(client, ctx, {
      instanceId: instance.id,
      fromState: current,
      toState: edge.to,
      gate: 'automatic',
      via: edge.via,
      status,
      actionId,
    })
    chain.push({ from: current, to: edge.to, gate: 'automatic', via: edge.via })
    // ADR 0046 — an automatic hop may land on an invoke_capability stage; run it
    // post-commit (scheduleCapabilityAutoRun is a no-op if the stage isn't one).
    scheduleCapabilityAutoRun(ctx, matterEntityId, edge.to, graph)
    current = edge.to
  }
  return chain
}

// An external/system signal arrived (e.g. esign.completed, invoice.paid). Find the
// current stage's edge that waits `on === eventKind` (a system/automatic gate); if
// there is one, advance to it, then run the automatic chain from the new stage.
// No-op when no edge waits on this event. Does NOT mirror matter_status — the caller
// does (signalEvent is invoked from a callback/worker that records the action).
export async function signalEvent(
  client: DbClient,
  ctx: Ctx,
  matterEntityId: string,
  eventKind: string,
  actionId: string, // the real action wrapping this system callback (no placeholder)
): Promise<void> {
  const loaded = await loadInstanceForMatter(client, ctx, matterEntityId)
  if (!loaded) return
  const { instance, graph } = loaded
  if (graph.length === 0) return

  const edge = edgesFrom(graph, instance.currentState).find(
    (e) => e.on === eventKind && (e.gate === 'system' || e.gate === 'automatic'),
  )
  if (!edge) return

  const toStage = stageByKey(graph, edge.to)
  await advanceWorkflowInstance(client, ctx, {
    instanceId: instance.id,
    fromState: instance.currentState,
    toState: edge.to,
    gate: edge.gate,
    via: edge.via,
    status: toStage?.terminal ? 'completed' : undefined,
    actionId,
  })
  // ADR 0046 — a system/automatic event (e.g. invoice.paid) may land on an
  // invoke_capability stage; run it post-commit before chaining automatic edges.
  scheduleCapabilityAutoRun(ctx, matterEntityId, edge.to, graph)
  await advanceMatter(client, ctx, matterEntityId, actionId)
}

// The small, EXPLICIT dispatch helper the real handlers call right after they
// insert the event that a system/automatic edge waits `on`. NOT an event bus: it is
// a direct, synchronous, in-transaction call so the lifecycle advance commits with
// the same action that produced the signal (invariant 9). It is a PURE NO-OP unless
// the engine flag is on, so every call site stays a day-one no-op until the flag
// flips — the caller wraps it in its own real actionId (no placeholder) and resolves
// the matter/subject entity id first. signalEvent itself is a no-op when the matter
// has no instance or no edge waits on this event, so a handler can dispatch
// unconditionally without first knowing whether THIS matter runs a lifecycle.
export async function dispatchLifecycleEvent(
  client: DbClient,
  ctx: Ctx,
  matterEntityId: string,
  eventKind: string,
  actionId: string,
): Promise<void> {
  if (!workflowEngineEnabled()) return
  await signalEvent(client, ctx, matterEntityId, eventKind, actionId)
}
