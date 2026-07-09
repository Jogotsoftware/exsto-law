// ADR 0046 / RUNTIME-AUTORUN-2 — AUTO-RUN a PRODUCING stage when a matter ENTERS it.
//
// The gap #303 closed (CAPABILITY-RUNTIME-1-MERGE step 3): capabilities never fired on
// their own — the only trigger was the manual /workflow/invoke route, so the client
// self-serve path was not autonomous. #303 wired autorun for `invoke_capability` ONLY.
// RUNTIME-AUTORUN-2 generalizes it: ANY producing step kind auto-runs on entry through
// the SAME post-commit queue and the SAME audited advance — `generate_document` (the
// AI drafts the will/document) joins `invoke_capability`, and a future producing kind
// slots in by adding ONE registry entry, with no new special-case in the engine.
//
// THE INVARIANT (must not break, from #303): no LLM call ever rides an advance
// transaction. So the run is scheduled via ctx.afterCommit — submitAction drains that
// queue AFTER the advance transaction has committed, each callback in its own
// transaction. An advance handler calls this right after it lands the matter on
// `newStageKey`; if that stage is a producing kind that should auto-run, the run fires
// post-commit through the producing runtime (which self-guards idempotency).
//
// CLASS-BASED dispatch (not a hardcoded kind string): a producing stage is one whose
// action.kind has a PRODUCING_RUNNER. Each runner decides, per its own semantics,
// whether entry to such a stage auto-runs (`shouldAutoRun`) and what to run (`run`).
//   • invoke_capability → always auto-runs on entry; the capability's own gate decides
//     park-vs-advance inside invokeCapabilityForMatter (unchanged from #303).
//   • generate_document → auto-runs on entry only when the stage has a gate:automatic
//     advancing edge (the "producing + automatic" rule) — it drafts the real document
//     then advances that edge to the (human-gated) review stage, which WAITS.
// A non-producing kind (view_intake, review_send_document, await_payment, …) has no
// runner → never auto-runs, so human/attorney/client-gated steps still wait.
//
// Honest failure (WP3): the producing runtime records its own failure observation and
// leaves the matter parked + re-invocable; the caught error here only stops a failed
// auto-run from failing the already-committed advance (no-simulate — the observation is
// the queryable truth, nothing false is surfaced).
import { hasAutomaticTransition, stageByKey } from './resolve.js'
import type { Lifecycle, LifecycleStage, StepActionKind } from './types.js'

// Structural context — any advance handler's ctx (which carries the submitAction
// post-commit queue) satisfies this. base tenant/actor drive the run.
export interface AutoRunCtx {
  tenantId: string
  actorId: string
  afterCommit?: Array<() => Promise<void>>
}

interface ProducingRunner {
  // Does entry to a stage of this kind auto-run, given the stage + its graph?
  shouldAutoRun: (stage: LifecycleStage, graph: Lifecycle) => boolean
  // Run the producing stage the matter is parked on (own transaction, post-commit).
  // Dynamic imports keep this at runtime — no static lifecycle→api cycle.
  run: (base: { tenantId: string; actorId: string }, matterEntityId: string) => Promise<void>
}

// The registry IS the class. Adding a producing kind = adding one entry here; the
// dispatch below never names a kind.
const PRODUCING_RUNNERS: Partial<Record<StepActionKind, ProducingRunner>> = {
  invoke_capability: {
    // #303 behavior, unchanged: an invoke_capability stage always runs on entry; the
    // capability's default_gate (attorney/client → park, automatic/system → advance) is
    // applied inside invokeCapabilityForMatter.
    shouldAutoRun: () => true,
    run: async (base, matterEntityId) => {
      const { invokeCapabilityForMatter } = await import('../api/capabilityRuntime.js')
      await invokeCapabilityForMatter(base, matterEntityId)
    },
  },
  generate_document: {
    // Producing + automatic: draft on entry ONLY when an automatic edge advances the
    // stage. A generate_document with a non-automatic advancing edge (an attorney who
    // triggers drafting by hand) would NOT auto-run — the human gate waits.
    shouldAutoRun: (stage, graph) => hasAutomaticTransition(graph, stage.key),
    run: async (base, matterEntityId) => {
      const { generateDocumentForMatter } = await import('../api/generateDocumentRuntime.js')
      await generateDocumentForMatter(base, matterEntityId)
    },
  },
}

// Schedule the post-commit auto-run for the stage a matter just entered, if that stage
// is a producing kind whose entry should auto-run. A pure no-op for every other stage,
// so an advance handler can call it unconditionally after landing the matter.
export function scheduleProducingAutoRun(
  ctx: AutoRunCtx,
  matterEntityId: string,
  newStageKey: string,
  graph: Lifecycle,
): void {
  const stage = stageByKey(graph, newStageKey)
  const kind = stage?.action?.kind
  if (!stage || !kind) return
  const runner = PRODUCING_RUNNERS[kind]
  if (!runner || !runner.shouldAutoRun(stage, graph)) return
  // If there is no post-commit queue (an advance not driven through submitAction), we
  // cannot schedule safely — do nothing rather than run inline (no LLM on an advance txn).
  if (!ctx.afterCommit) return

  const base = { tenantId: ctx.tenantId, actorId: ctx.actorId }
  ctx.afterCommit.push(async () => {
    try {
      await runner.run(base, matterEntityId)
    } catch (err) {
      console.error(
        `[producing auto-run] stage "${newStageKey}" on matter ${matterEntityId} failed post-advance (matter stays parked, re-invocable):`,
        err instanceof Error ? err.message : err,
      )
    }
  })
}
