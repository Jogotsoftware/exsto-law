// Matter-lifecycle engine (ADR 0045) — read-only in PR2 (shadow). Exposed so the
// invariant tests, the backfill script, and (PR3) the worker/UI share one resolver.
export * from './types.js'
export * from './resolve.js'
export * from './derive.js'
// Matter STATUS chip derivation — the attorney-facing stage a matter is at, read
// from its live workflow (the matters list, home dashboard, and matter header).
export * from './statusDisplay.js'
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
// WF-FIX-1 — non-blocking pass-through: settle a landing through informational
// stages, then schedule the producing auto-run for the resting stage.
export * from './settle.js'
// WORKFLOW-AUTHORING-1 — the self-describing invoke_capability authoring contract
// (pure: worked-example step shape + precise config-mismatch diagnostics).
export * from './capabilityAuthoring.js'
// WORKFLOW-AUTHORING-1 — the gate-transition vocabulary (the exact via/on advance
// tokens per gate) so the builder never writes prose in an edge that can't fire.
export * from './gateTransitions.js'
// ESIGN-UNIFY-1 ES-4 — auto-add the workflow-embedded e-sign stage after the
// approve step for signable document kinds (pure graph surgery).
export * from './esignStage.js'
