// ADR 0046 / RUNTIME-AUTORUN-2 / PROD-DRAFT-OFFLOAD-1 — AUTO-RUN a PRODUCING stage
// when a matter ENTERS it; the DRAFTING work runs OFF the request, on the worker.
//
// The gap #303 closed (CAPABILITY-RUNTIME-1-MERGE step 3): capabilities never fired on
// their own — the only trigger was the manual /workflow/invoke route, so the client
// self-serve path was not autonomous. #303 wired autorun for `invoke_capability` ONLY.
// RUNTIME-AUTORUN-2 generalized it: ANY producing step kind auto-runs on entry through
// the SAME post-commit queue — `generate_document` (the AI drafts the will/document)
// joined `invoke_capability`, and a future producing kind slots in by adding ONE
// registry entry, with no new special-case in the engine.
//
// PROD-DRAFT-OFFLOAD-1 fixes WHERE the drafting work runs. RUNTIME-AUTORUN-2 drained
// runDraftGeneration synchronously in the afterCommit queue — which submitAction drains
// IN the HTTP request before returning (action.ts). On Netlify the model call outran
// the serverless function's wall-clock and the process was killed before the
// document_version committed: no document, no event, no error. (The in-process harness
// has no serverless boundary, so it never reproduced this.) The fix reuses the path the
// attorney manual draft has used all along (generateDraft.requestDraft): the post-commit
// callback now only ENQUEUES a tenant-scoped `legal.draft.run` worker_job — one fast
// INSERT — and the always-on worker claims it and drafts with no request wall-clock.
// Same job kind, same worker handler that produced June's production drafts; no new job
// kind, no parallel path. On failure the job's own retry/backoff → dead_letter path
// applies; nothing dies silently in-request.
//
// THE INVARIANT (must not break, from #303): no LLM call ever rides an advance
// transaction — and for generate_document, none rides the request at all anymore. The
// advance that lands the matter on the producing stage commits first; the afterCommit
// callback does the fast enqueue; the worker-side runtime (generateDocumentForMatter)
// re-checks the stage and the draft-exists guard — so a stale or duplicate job no-ops
// instead of double-drafting — then advances the automatic edge on draft.completed.
// Enqueue idempotency is by construction: one stage entry = one committed advance = one
// afterCommit callback = one INSERT; re-entering the same state does not re-advance.
//
// CLASS-BASED dispatch (not a hardcoded kind string): a producing stage is one whose
// action.kind has a PRODUCING_RUNNER. Each runner decides, per its own semantics,
// whether entry to such a stage auto-runs (`shouldAutoRun`) and what its post-commit
// callback does (`run`).
//   • invoke_capability → always auto-runs on entry; the capability's own gate decides
//     park-vs-advance inside invokeCapabilityForMatter (unchanged from #303). KNOWN
//     LIMIT: this runner still executes its handler in-request post-commit — offloading
//     it needs a capability job kind, a deliberate non-goal here (this change adds no
//     new job kind; the deployed regression is drafting).
//   • generate_document → auto-runs on entry only when the stage has a gate:automatic
//     advancing edge (the "producing + automatic" rule) — it ENQUEUES the drafting job;
//     the worker drafts the real document then advances that edge to the (human-gated)
//     review stage, which WAITS.
// A non-producing kind (view_intake, review_send_document, await_payment, …) has no
// runner → never auto-runs, so human/attorney/client-gated steps still wait.
//
// Honest failure (WP3): worker-side, the producing runtime records its own failure
// observation and leaves the matter parked + re-invocable. Enqueue-side, a failed
// enqueue records a queryable observation (generateDocumentRuntime) and the catch here
// only stops it from failing the already-committed advance.
import { hasAutomaticTransition, stageByKey } from './resolve.js'
import type { Lifecycle, LifecycleStage, StepActionKind } from './types.js'

// Structural context — any advance handler's ctx (which carries the submitAction
// post-commit queue) satisfies this. base tenant/actor drive the enqueue.
export interface AutoRunCtx {
  tenantId: string
  actorId: string
  afterCommit?: Array<() => Promise<void>>
}

interface ProducingRunner {
  // Does entry to a stage of this kind auto-run, given the stage + its graph?
  shouldAutoRun: (stage: LifecycleStage, graph: Lifecycle) => boolean
  // The post-commit callback for the stage the matter just entered. It runs in-request
  // after the advance commits, so it must be FAST — model-calling work belongs on the
  // worker: enqueue it (generate_document), never drain it here.
  // Dynamic imports keep this at runtime — no static lifecycle→api cycle.
  run: (
    base: { tenantId: string; actorId: string },
    matterEntityId: string,
    stage: LifecycleStage,
  ) => Promise<void>
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
    // PROD-DRAFT-OFFLOAD-1: enqueue the legal.draft.run job (the manual-draft path);
    // the worker drafts + advances (workers/index.ts → generateDocumentForMatter).
    run: async (base, matterEntityId, stage) => {
      const { enqueueDraftAutoRunJob } = await import('../api/generateDocumentRuntime.js')
      await enqueueDraftAutoRunJob(base, matterEntityId, stage)
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
      await runner.run(base, matterEntityId, stage)
    } catch (err) {
      console.error(
        `[producing auto-run] stage "${newStageKey}" on matter ${matterEntityId} failed post-advance (matter stays parked, re-invocable):`,
        err instanceof Error ? err.message : err,
      )
    }
  })
}
