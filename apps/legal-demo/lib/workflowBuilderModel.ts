// Pure data model for the service-level Workflow builder (STEP-EDITOR-1). Extracted
// from page.tsx so the graph round-trip is unit-testable without React/Next, and so
// the builder round-trips a saved graph LOSSLESSLY.
//
// The bug this fixes: graphToSteps dropped every stage's action.config, so a saved
// step that carried config — above all an invoke_capability step (its
// capability_slug + the attorney's standing instructions live in
// action.config.capability_config) — came back configless and re-saved as a broken,
// no-config step. We now carry action.config through the builder verbatim.
//
// CONSTRAINT (mirrors page.tsx): no server-package imports. These wire shapes are a
// structural mirror of verticals/legal/src/lifecycle/{types,catalog}.ts; the CLOSED
// catalog of actions + gates is still read at runtime from legal.workflow.catalog.

// ── Wire shapes (structural mirror; not imported from the server) ──────────────
export type WfGate = 'automatic' | 'attorney' | 'client' | 'system'
export type WfActionKind =
  | 'view_intake'
  | 'view_consultation'
  | 'generate_document'
  | 'review_send_document'
  | 'approve_send_invoice'
  | 'await_payment'
  | 'manual_task'
  | 'complete_matter'
  | 'invoke_capability'

export interface WfEdge {
  to: string
  gate: WfGate
  via?: string
  on?: string
  when?: string
}
export interface WfDocumentRef {
  templateEntityId?: string
  docKind?: string
  label?: string
}
export interface WfStage {
  key: string
  label: string
  client_label?: string
  entry?: boolean
  terminal?: boolean
  blocking?: boolean
  action?: { kind: WfActionKind; config?: Record<string, unknown> }
  documents?: WfDocumentRef[]
  advances_to: WfEdge[]
}
export type WfLifecycle = WfStage[]

// ── The builder's working model. One Step per stage, in display = run order. ────
export interface BuilderStep {
  uid: string
  key: string
  label: string
  clientLabel: string
  actionKind: WfActionKind
  gate: WfGate
  trigger: string
  blocking: boolean
  documents: WfDocumentRef[]
  // The step's action.config, carried verbatim so a saved config (e.g. an
  // invoke_capability step's capability_slug + capability_config) round-trips
  // unchanged. Undefined for step kinds that carry no config.
  config?: Record<string, unknown>
}

// `via` names the action that fires attorney/client edges; `on` names the event an
// automatic/system edge waits for. One free-text "trigger" per step is placed on the
// right field at save time based on the gate.
export function triggerField(gate: WfGate): 'via' | 'on' {
  return gate === 'attorney' || gate === 'client' ? 'via' : 'on'
}
// The default trigger for a step's INCOMING edge (P12 target-anchoring, below): what
// completes the PRECEDING step is what moves the matter to this one, so the default
// keys off the preceding step's action kind — a preceding invoice step is completed
// by payment, a preceding e-signature capability by envelope completion, a preceding
// review step by the attorney's approval. attorney/client gates always have a real
// advance token; system otherwise stays EMPTY — the runtime never dispatches on
// made-up tokens like the old 'event'/'condition' defaults, so an empty default
// forces the attorney to pick a real one (the validator rejects a system/automatic
// edge with no 'on'). automatic `on` is free-form/descriptive.
export function defaultTrigger(
  gate: WfGate,
  precedingActionKind?: WfActionKind,
  precedingConfig?: Record<string, unknown>,
): string {
  if (gate === 'attorney')
    return precedingActionKind === 'review_send_document' ? 'draft.approve' : 'legal.matter.advance'
  if (gate === 'client') return 'booking.create'
  if (gate === 'system') {
    if (precedingActionKind === 'approve_send_invoice' || precedingActionKind === 'await_payment')
      return 'invoice.paid'
    if (
      precedingActionKind === 'invoke_capability' &&
      typeof precedingConfig?.capability_slug === 'string' &&
      precedingConfig.capability_slug.trim() === 'esignature'
    )
      return 'esign.completed'
    return ''
  }
  return '' // automatic
}

let uidSeq = 0
export function nextUid(): string {
  uidSeq += 1
  return `s${uidSeq}_${Math.random().toString(36).slice(2, 7)}`
}

// label → a stable, unique stage key (== the matter_status value the engine writes).
export function slugKey(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'step'
  let key = base
  let n = 2
  while (taken.has(key)) {
    key = `${base}_${n}`
    n += 1
  }
  taken.add(key)
  return key
}

// P12 TARGET-ANCHORING — the builder stores each stage's INCOMING edge's
// (gate, via|on) on the step that edge leads INTO, not on the step it leaves. The
// WIRE format is unchanged (stage i's advances_to[0] still carries the pair for the
// edge i→i+1); only the builder's anchor flips. Why: move() is a pure array swap, so
// under the old source-anchoring a moved step dragged its trigger along as the
// SOURCE of a different edge, and a step moved to last silently LOST its gate/
// trigger (terminals write no outgoing edge). Anchored to the target, a swap takes
// each step's "how I am reached" pair WITH it and `to` is re-pointed by
// construction; the only pair never written is the entry step's, which has no
// incoming edge and is inert while the step stays first.
//
// Map a loaded lifecycle graph (run order by edges) into the linear builder model.
// We walk from the entry stage by following the single outgoing edge so display order
// == run order even if the stored array order drifted, carrying each stage's config.
export function graphToSteps(graph: WfLifecycle): BuilderStep[] {
  if (!graph.length) return []
  const byKey = new Map<string, WfStage>(graph.map((s) => [s.key, s]))
  const entry = graph.find((s) => s.entry) ?? graph[0]
  const ordered: WfStage[] = []
  const seen = new Set<string>()
  let cursorKey: string | undefined = entry?.key
  while (cursorKey && !seen.has(cursorKey)) {
    const stage: WfStage | undefined = byKey.get(cursorKey)
    if (!stage) break
    seen.add(cursorKey)
    ordered.push(stage)
    const nextEdge: WfEdge | undefined = stage.advances_to[0]
    cursorKey = nextEdge?.to
  }
  // Include any stages the walk didn't reach (defensive) so nothing disappears on load.
  for (const s of graph) if (!seen.has(s.key)) ordered.push(s)

  return ordered.map((s, i) => {
    // The step's pair is its INCOMING edge's — the previous ordered stage's outgoing
    // edge when it really points here. The entry step (i === 0) and any defensively
    // appended unreachable stage have no incoming edge: they get the inert/sane
    // default (attorney, '') — save derives a real token from the preceding step.
    const prevEdge = i > 0 ? ordered[i - 1].advances_to[0] : undefined
    const edge = prevEdge && prevEdge.to === s.key ? prevEdge : undefined
    return {
      uid: nextUid(),
      key: s.key,
      label: s.label,
      clientLabel: s.client_label ?? '',
      actionKind: s.action?.kind ?? 'manual_task',
      gate: (edge?.gate ?? 'attorney') as WfGate,
      trigger: edge?.via ?? edge?.on ?? '',
      blocking: s.blocking !== false,
      documents: s.documents ?? [],
      config: s.action?.config,
    }
  })
}

// Assemble the linear Lifecycle to save: first step is the entry, last is terminal,
// and the edge i→i+1 carries the TARGET step's (gate, trigger) pair — the inverse of
// graphToSteps' target-anchoring above, so a linear graph round-trips losslessly and
// a reorder re-threads edges without dropping or re-homing any pair. Keys are
// stabilized/uniquified from labels. The step's action.config is written back
// verbatim so a preserved config survives the round-trip.
export function stepsToGraph(steps: BuilderStep[]): WfLifecycle {
  const taken = new Set<string>()
  const keys = steps.map((s) => {
    const existing = s.key && !taken.has(s.key) ? s.key : ''
    if (existing) {
      taken.add(existing)
      return existing
    }
    return slugKey(s.label, taken)
  })
  return steps.map((s, i) => {
    const isLast = i === steps.length - 1
    const action: { kind: WfActionKind; config?: Record<string, unknown> } = { kind: s.actionKind }
    if (s.config && Object.keys(s.config).length > 0) action.config = s.config
    const stage: WfStage = {
      key: keys[i],
      label: s.label.trim() || `Step ${i + 1}`,
      entry: i === 0 || undefined,
      terminal: isLast || undefined,
      action,
      advances_to: [],
    }
    if (s.clientLabel.trim()) stage.client_label = s.clientLabel.trim()
    if (!s.blocking) stage.blocking = false
    if (s.documents.length) stage.documents = s.documents
    if (!isLast) {
      // Target-anchored: the NEXT step owns this edge's pair ("how step i+1 is
      // reached"); the default keys off THIS step's kind (what completes step i).
      const target = steps[i + 1]
      const edge: WfEdge = { to: keys[i + 1], gate: target.gate }
      // An empty trigger with no default is left OFF the edge (never written as ''),
      // so the server validator's "names no 'on'/'via'" check fires instead of a
      // dead-token edge slipping through.
      const trig = target.trigger.trim() || defaultTrigger(target.gate, s.actionKind, s.config)
      if (trig) edge[triggerField(target.gate)] = trig
      stage.advances_to = [edge]
    }
    return stage
  })
}
