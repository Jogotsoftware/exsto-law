// ADR 0046 — AUTO-RUN an invoke_capability stage when a matter ENTERS it.
//
// The gap this closes (diagnosed in CAPABILITY-RUNTIME-1-MERGE step 3): capabilities
// never fired on their own — the only trigger was the manual /workflow/invoke route.
// So the client self-serve path was not autonomous: a client could advance a gate
// (document.upload), but the AI work at the stage they landed on sat inert.
//
// THE INVARIANT (must not break): no LLM call ever rides an advance transaction.
// So the run is scheduled via ctx.afterCommit — submitAction drains that queue AFTER
// the advance transaction has committed, each callback in its own transaction. An
// advance handler calls this right after it lands the matter on `newStageKey`; if
// that stage runs a capability, the run fires post-commit through the SAME runtime
// the manual route uses (invokeCapabilityForMatter, which self-guards idempotency).
//
// Failure is honest (WP3): invokeCapabilityForMatter records the failure observation
// and the matter stays parked + re-invocable via the manual route; the caught error
// here just stops a failed auto-run from failing the already-committed advance.
import { stageByKey } from './resolve.js'
import type { Lifecycle } from './types.js'

// Structural context — any advance handler's ctx (which carries the submitAction
// post-commit queue) satisfies this. base tenant/actor drive the run.
export interface AutoRunCtx {
  tenantId: string
  actorId: string
  afterCommit?: Array<() => Promise<void>>
}

export function scheduleCapabilityAutoRun(
  ctx: AutoRunCtx,
  matterEntityId: string,
  newStageKey: string,
  graph: Lifecycle,
): void {
  // Only stages that RUN a capability auto-fire; everything else is a normal stage.
  const stage = stageByKey(graph, newStageKey)
  if (stage?.action?.kind !== 'invoke_capability') return
  // If there is no post-commit queue (e.g. an advance not driven through
  // submitAction), we cannot schedule safely — do nothing rather than run inline.
  if (!ctx.afterCommit) return

  const base = { tenantId: ctx.tenantId, actorId: ctx.actorId }
  ctx.afterCommit.push(async () => {
    // Dynamic import keeps this at runtime (post-commit) — no static lifecycle→api
    // cycle. Runs in its own transaction/context; never inside the advance txn.
    const { invokeCapabilityForMatter } = await import('../api/capabilityRuntime.js')
    try {
      await invokeCapabilityForMatter(base, matterEntityId)
    } catch (err) {
      // The runtime already recorded the failure observation and left the matter
      // parked + re-invocable. Do not let a failed auto-run fail the committed
      // advance (no-simulate: we surface nothing false, only swallow to protect the
      // advance; the observation is the queryable truth).
      console.error(
        `[capability auto-run] stage "${newStageKey}" on matter ${matterEntityId} failed post-advance (matter stays parked, re-invocable):`,
        err instanceof Error ? err.message : err,
      )
    }
  })
}
