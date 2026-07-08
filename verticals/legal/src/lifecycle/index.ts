// Matter-lifecycle engine (ADR 0045) — read-only in PR2 (shadow). Exposed so the
// invariant tests, the backfill script, and (PR3) the worker/UI share one resolver.
export * from './types.js'
export * from './resolve.js'
export * from './derive.js'
// PR3 — the step-action catalog (builder/AI guardrail) + authored product workflows.
export * from './catalog.js'
export * from './authored.js'
// PR3 (write path) — the flag, binding resolution, the instance writer, and the
// executor. All flag-gated; a day-one no-op until LEGAL_WORKFLOW_ENGINE is set.
export * from './flags.js'
export * from './binding.js'
export * from './instance.js'
export * from './executor.js'
// ADR 0046 — auto-run an invoke_capability stage on entry (post-commit).
export * from './autoRun.js'
