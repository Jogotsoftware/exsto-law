// Pure graph (re)builder for the per-matter "Edit steps for this matter" editor
// (STEP-EDITOR-1). Extracted from WorkflowEditor.tsx so the round-trip is unit-
// testable without React, and so the editor emits a LOSSLESS graph.
//
// The bug this fixes: the old builder rebuilt EVERY outgoing edge as
// `{ gate: <catalog default>, via: 'legal.matter.advance' }`, which (a) dropped the
// `on` event off an automatic/system edge — producing a graph
// legal.matter.set_workflow's validator (correctly) rejects ("automatic edge but
// names no 'on' event"), so no workflow with an automatic edge could be saved — and
// (b) silently rewrote every edge's gate + trigger, losing the saved transition
// vocabulary (#308: on/via + gate).
//
// The fix: an outgoing edge belongs to its SOURCE step. On save we PRESERVE that
// step's original edge (on/via/gate/when) and only re-point its `to` at whatever
// step now follows it in array order. Reordering keeps every automatic edge's `on`.
// A freshly-added step has no saved edge, so we synthesize a VALID default from the
// catalog gate. Round-tripping an unchanged valid graph is the identity.
//
// The stage shapes below are a self-contained structural mirror of shared.tsx (the
// same mirror-the-wire-shape approach shared.tsx itself takes for the server types).
// Kept dependency-free so the round-trip is unit-testable without pulling any TSX.
export type WfGate = 'automatic' | 'attorney' | 'client' | 'system'
export type WfStepActionKind =
  | 'view_intake'
  | 'view_consultation'
  | 'generate_document'
  | 'review_send_document'
  | 'approve_send_invoice'
  | 'await_payment'
  | 'manual_task'
  | 'complete_matter'
  | 'invoke_capability'
  | 'esign'

export interface WfEdge {
  to: string
  gate: WfGate
  via?: string
  on?: string
  when?: string
}
export interface WfStage {
  key: string
  label: string
  client_label?: string
  entry?: boolean
  terminal?: boolean
  blocking?: boolean
  action?: { kind: WfStepActionKind; config?: Record<string, unknown> }
  documents?: Array<{ templateEntityId?: string; docKind?: string; label?: string }>
  advances_to: WfEdge[]
}

// The subset of the closed catalog the builder needs: a kind → its default gate.
export interface CatalogGate {
  kind: WfStepActionKind
  defaultGate: WfGate
}

// The default `on` event for a freshly-added automatic/system step, so its synthesized
// edge is VALID (the validator requires a non-empty `on` on automatic/system edges).
// Existing steps never hit this path — their saved edge is preserved verbatim.
function defaultOnEvent(kind: WfStepActionKind | undefined): string {
  if (kind === 'generate_document') return 'document.generated'
  if (kind === 'await_payment' || kind === 'approve_send_invoice') return 'invoice.paid'
  // ESIGN-UNIFY-1 ES-4: an e-sign step holds until every signer has signed.
  if (kind === 'esign') return 'esign.completed'
  // WF-FIX-1 (WP2): intake steps wait on the client finishing the questionnaire.
  if (kind === 'view_intake') return 'intake.completed'
  // The old fallback was the literal string 'condition' — a token nothing ever
  // dispatches, i.e. a stage no event could exit. Default to the intake signal
  // (the one system event every service has); the attorney can still pick another.
  return 'intake.completed'
}

// A valid outgoing edge for a NEW step (no saved edge to preserve): attorney/client
// gates advance via an action; automatic/system gates fire on an event.
function synthesizeEdge(to: string, gate: WfGate, kind: WfStepActionKind | undefined): WfEdge {
  if (gate === 'automatic' || gate === 'system') return { to, gate, on: defaultOnEvent(kind) }
  return { to, gate, via: 'legal.matter.advance' }
}

// Rebuild the linear graph from ordered stages. Array order IS workflow order; each
// non-terminal stage keeps its own outgoing edge (re-pointed to the next stage) and
// the last stage is terminal. Entry sits on the first stage. Nothing is injected or
// duplicated; no edge attribute is invented for a step that already had one.
export function buildMatterGraph(stages: WfStage[], catalog: CatalogGate[]): WfStage[] {
  const gateFor = (kind: WfStepActionKind | undefined): WfGate =>
    catalog.find((c) => c.kind === kind)?.defaultGate ?? 'attorney'
  return stages.map((stage, i) => {
    const isLast = i === stages.length - 1
    // Copy the stage verbatim (preserves action.config, documents, labels, key order),
    // then correct only entry/terminal/edges — the fields the linear layout owns.
    const base: WfStage = { ...stage }
    if (i === 0) base.entry = true
    else delete base.entry
    if (isLast) {
      base.terminal = true
      base.advances_to = []
      return base
    }
    // Non-terminal: strip any stale terminal flag; keep exactly one outgoing edge.
    delete base.terminal
    const to = stages[i + 1].key
    const original = stage.advances_to?.[0]
    base.advances_to = [
      original
        ? { ...original, to }
        : synthesizeEdge(to, gateFor(stage.action?.kind), stage.action?.kind),
    ]
    return base
  })
}
