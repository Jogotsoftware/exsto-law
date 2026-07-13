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
// A sensible default trigger so a saved edge is never empty-but-meaningful.
export function defaultTrigger(gate: WfGate, actionKind: WfActionKind): string {
  if (gate === 'attorney') return 'legal.matter.advance'
  if (gate === 'client') return 'booking.create'
  if (gate === 'system') return actionKind === 'approve_send_invoice' ? 'invoice.paid' : 'event'
  return 'condition' // automatic
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

  return ordered.map((s) => {
    const edge = s.advances_to[0]
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
// every other step → the next via one edge carrying the step's gate + trigger. Keys
// are stabilized/uniquified from labels. The step's action.config is written back
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
      const edge: WfEdge = { to: keys[i + 1], gate: s.gate }
      const trig = s.trigger.trim() || defaultTrigger(s.gate, s.actionKind)
      edge[triggerField(s.gate)] = trig
      stage.advances_to = [edge]
    }
    return stage
  })
}
