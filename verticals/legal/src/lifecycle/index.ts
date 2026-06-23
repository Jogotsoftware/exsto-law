// Matter-lifecycle engine (ADR 0045) — read-only in PR2 (shadow). Exposed so the
// invariant tests, the backfill script, and (PR3) the worker/UI share one resolver.
export * from './types.js'
export * from './resolve.js'
export * from './derive.js'
// PR3 — the step-action catalog (builder/AI guardrail) + authored product workflows.
export * from './catalog.js'
export * from './authored.js'
