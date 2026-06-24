// Pure, read-only lifecycle resolver (ADR 0045). No DB, no writes — it interprets a
// stage graph. Used by the invariant tests now, and (PR3) by the worker, the
// status-advance guard, and the UI. Keeping it pure keeps the engine deterministic
// (ADR 0013) and unit-testable without a database.
import {
  GATE_KINDS,
  type GateKind,
  type Lifecycle,
  type LifecycleEdge,
  type LifecycleStage,
  type LifecycleValidation,
} from './types.js'
// The closed set of step-action kinds (catalog.ts). validateLifecycle rejects any
// stage.action.kind outside it — the same guardrail the builder/AI compose from,
// now enforced structurally so a graph with a made-up action can never be saved.
import { STEP_ACTION_KINDS } from './catalog.js'

export function stageByKey(lc: Lifecycle, key: string): LifecycleStage | null {
  return lc.find((s) => s.key === key) ?? null
}

export function entryStage(lc: Lifecycle): LifecycleStage | null {
  return lc.find((s) => s.entry) ?? null
}

export function edgesFrom(lc: Lifecycle, stageKey: string): LifecycleEdge[] {
  return stageByKey(lc, stageKey)?.advances_to ?? []
}

// The transitions allowed out of `stageKey` for the given gate kinds. PR3 passes the
// gates the current actor/role may fire (e.g. ['attorney'] for an attorney action,
// ['automatic'] for the worker) so a transition only fires through a defined edge.
export function allowedTransitions(
  lc: Lifecycle,
  stageKey: string,
  gates: readonly GateKind[] = GATE_KINDS,
): LifecycleEdge[] {
  return edgesFrom(lc, stageKey).filter((e) => gates.includes(e.gate))
}

// Is there an automatic transition out of this stage? This is what the worker's
// `route === 'auto'` check becomes in PR3 — the single behavioral hinge of ADR 0045.
export function hasAutomaticTransition(lc: Lifecycle, stageKey: string): boolean {
  return edgesFrom(lc, stageKey).some((e) => e.gate === 'automatic')
}

// Every (from, to) edge with gate === 'automatic'. The equality invariant compares
// THIS set against the one automatic transition the engine performs today.
export function automaticEdges(lc: Lifecycle): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = []
  for (const s of lc)
    for (const e of s.advances_to) if (e.gate === 'automatic') out.push({ from: s.key, to: e.to })
  return out
}

// All stage keys reachable from the entry stage by following edges.
function reachableFromEntry(lc: Lifecycle): Set<string> {
  const entry = entryStage(lc)
  const seen = new Set<string>()
  if (!entry) return seen
  const stack = [entry.key]
  while (stack.length) {
    const k = stack.pop()!
    if (seen.has(k)) continue
    seen.add(k)
    for (const e of edgesFrom(lc, k)) if (!seen.has(e.to)) stack.push(e.to)
  }
  return seen
}

// Structural validity (ADR 0045 invariants). A graph that fails this must never be
// saved (PR4) or backfilled.
export function validateLifecycle(lc: Lifecycle): LifecycleValidation {
  const errors: string[] = []
  if (!Array.isArray(lc) || lc.length === 0) {
    return { ok: false, errors: ['lifecycle must be a non-empty array of stages'] }
  }

  const keys = lc.map((s) => s.key)
  const keySet = new Set(keys)
  if (keySet.size !== keys.length) errors.push('stage keys must be unique')

  const entries = lc.filter((s) => s.entry)
  if (entries.length !== 1)
    errors.push(`exactly one entry stage required (found ${entries.length})`)

  const terminals = lc.filter((s) => s.terminal)
  if (terminals.length === 0) errors.push('at least one terminal stage required')

  for (const s of lc) {
    if (!s.key) errors.push('every stage needs a key')
    // A label is required AND must be non-blank (a whitespace-only label reads as
    // empty in the builder/portal). trim() so "  " is rejected the same as "".
    if (!s.label || !s.label.trim()) errors.push(`stage "${s.key}" needs a label`)
    // action is OPTIONAL (legacy/seeded graphs and existing fixtures may omit it),
    // so only validate the kind WHEN action is present. A made-up action.kind (e.g.
    // free-form AI output) is rejected against the closed catalog before any write.
    if (s.action && !STEP_ACTION_KINDS.includes(s.action.kind))
      errors.push(`stage "${s.key}" has an unknown action kind "${s.action.kind}"`)
    if (s.terminal && s.advances_to.length > 0)
      errors.push(`terminal stage "${s.key}" must have no outgoing edges`)
    // A non-terminal stage with NO outgoing edge strands any matter that reaches it
    // (it can never advance and is not an exit) — reject it. Terminals are the only
    // legal dead end.
    if (!s.terminal && s.advances_to.length === 0)
      errors.push(
        `non-terminal stage "${s.key}" must have at least one outgoing edge (or be terminal)`,
      )
    for (const e of s.advances_to) {
      if (!keySet.has(e.to)) errors.push(`stage "${s.key}" has an edge to unknown stage "${e.to}"`)
      if (!GATE_KINDS.includes(e.gate))
        errors.push(`stage "${s.key}" → "${e.to}" has invalid gate "${e.gate}"`)
      // Gate coherence: a system/automatic edge fires on an EVENT, so it MUST name
      // one (`on`) — an automatic edge with no trigger could never fire. An
      // attorney/client edge is fired by an ACTION, so it SHOULD name one (`via`);
      // we only warn-as-error on the hard case (system/automatic missing `on`) and
      // require `via` on human gates so the engine knows which action advances them.
      if ((e.gate === 'automatic' || e.gate === 'system') && !e.on)
        errors.push(
          `stage "${s.key}" → "${e.to}" is a ${e.gate} edge but names no 'on' event to fire on`,
        )
      if ((e.gate === 'attorney' || e.gate === 'client') && !e.via)
        errors.push(
          `stage "${s.key}" → "${e.to}" is a ${e.gate} edge but names no 'via' action to advance it`,
        )
    }
  }

  // Every stage must be reachable from entry, and a terminal must be reachable too.
  const reachable = reachableFromEntry(lc)
  for (const s of lc) {
    if (!reachable.has(s.key)) errors.push(`stage "${s.key}" is unreachable from the entry stage`)
  }
  if (terminals.length > 0 && !terminals.some((t) => reachable.has(t.key))) {
    errors.push('no terminal stage is reachable from the entry stage')
  }

  return { ok: errors.length === 0, errors }
}

// Linear-only guard (PR5, decision 3) — branching stays reserved in the type, but
// the authoring path (the chatbot proposal + legal.service.set_lifecycle) forbids
// it: each non-terminal stage must have EXACTLY ONE outgoing advances_to edge. This
// is intentionally separate from validateLifecycle (which still permits a branching
// graph structurally) so only the authored path is constrained. Returns the same
// validation shape so callers can compose the two checks.
export function validateLinearLifecycle(lc: Lifecycle): LifecycleValidation {
  const errors: string[] = []
  for (const s of lc) {
    if (s.terminal) continue
    if (s.advances_to.length > 1)
      errors.push(
        `stage "${s.key}" has ${s.advances_to.length} outgoing edges — workflows must be linear (one step leads to one next step)`,
      )
  }
  return { ok: errors.length === 0, errors }
}

// Display labels resolved with the client fallback (PR3 uses these for the portal).
export function attorneyLabel(s: LifecycleStage): string {
  return s.label
}
export function clientLabel(s: LifecycleStage): string {
  return s.client_label ?? s.label
}
