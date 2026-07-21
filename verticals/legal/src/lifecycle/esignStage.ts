// ESIGN-UNIFY-1 ES-4 (design §7) — pure graph surgery for the workflow-embedded
// e-sign step. When a service's document template is marked signable (the ES-3
// config at transitions.document_templates.esign[docKind]), the builder AUTO-ADDS
// an e-sign stage right after the approve step: the attorney approves the draft,
// the matter lands on the e-sign stage, the step's modal auto-builds the envelope
// (approved version + template-role recipients + pre-placed fields), the attorney
// confirms-and-sends, and the stage HOLDS until esign.completed fires its system
// edge (the #320 loop's existing lifecycle dispatch — handlers/esign.ts). One
// stage, exactly the approve_send_invoice precedent (own action + system wait).
//
// PURE: no DB, no context — callers (services.updateDocumentTemplateEsignConfig,
// workflowAuthoring.setServiceLifecycleAI) load configs and persist the result.
// Unchanged graphs return the SAME array reference so callers can cheaply skip a
// no-op version bump — unsignable services are completely unaffected.
import type { EsignStepConfig, Lifecycle, LifecycleStage } from './types.js'

// Humanize a document kind for stage labels ("operating_agreement" → "Operating
// agreement"). Kept dumb on purpose — the label is attorney-editable config.
function humanizeDocKind(docKind: string): string {
  const s = docKind.replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : docKind
}

// The document kind an e-sign stage is bound to, from its config (primary) or
// its documents[] (display aid). Null when it carries neither — such a stage is
// treated as matching ANY kind so a hand-edited bare esign step never gets a
// duplicate stacked next to it.
export function esignStageDocKind(stage: LifecycleStage): string | null {
  if (stage.action?.kind !== 'esign') return null
  const cfg = (stage.action.config ?? {}) as EsignStepConfig
  const fromConfig = (cfg.document_kind ?? '').trim()
  if (fromConfig) return fromConfig
  const fromDocs = stage.documents?.find((d) => d.docKind)?.docKind?.trim()
  return fromDocs || null
}

// Does the graph already carry an e-sign step for this document kind? Both
// shapes count: the ES-4 first-class `esign` stage AND the ESIGN-BLOCK-1
// invoke_capability{esignature} stage (older authored graphs) — auto-add must
// never stack a second e-sign step onto either.
export function hasEsignStageFor(graph: Lifecycle, docKind: string): boolean {
  return graph.some((s) => {
    if (s.action?.kind === 'esign') {
      const kind = esignStageDocKind(s)
      return kind === null || kind === docKind
    }
    if (s.action?.kind === 'invoke_capability') {
      const cfg = (s.action.config ?? {}) as { capability_slug?: string }
      return (cfg.capability_slug ?? '').trim() === 'esignature'
    }
    return false
  })
}

// The approve step the e-sign stage follows (design §7: "after the approve
// step"): a stage with an attorney edge fired via draft.approve — the review
// step whose Approve control advances the matter. Prefer the one bound to this
// docKind (documents[]); else the LAST approving stage (the graph is linear, so
// "last" is the one nearest the back half where the e-sign step belongs).
function findApproveAnchorIndex(graph: Lifecycle, docKind: string): number {
  let last = -1
  let docMatch = -1
  graph.forEach((s, i) => {
    const approves = s.advances_to.some((e) => e.gate === 'attorney' && e.via === 'draft.approve')
    if (!approves) return
    last = i
    if ((s.documents ?? []).some((d) => (d.docKind ?? '').trim() === docKind)) docMatch = i
  })
  return docMatch >= 0 ? docMatch : last
}

// A stage key not already taken: esign_<docKind>, suffixed on collision.
function uniqueStageKey(graph: Lifecycle, docKind: string): string {
  const base = `esign_${docKind}`.replace(/[^a-zA-Z0-9_]/g, '_')
  if (!graph.some((s) => s.key === base)) return base
  for (let n = 2; ; n++) {
    const key = `${base}_${n}`
    if (!graph.some((s) => s.key === key)) return key
  }
}

export function buildEsignStage(
  graph: Lifecycle,
  docKind: string,
  advanceTo: string,
): LifecycleStage {
  return {
    key: uniqueStageKey(graph, docKind),
    label: 'eSign',
    client_label: 'Signature',
    // Blocking: the matter waits here until every signer has signed.
    action: { kind: 'esign', config: { document_kind: docKind } },
    documents: [{ docKind, label: humanizeDocKind(docKind) }],
    // The step-advance hook (§7): esign.completed — dispatched by the existing
    // handlers/esign.ts lifecycle dispatch when the last signer signs — fires
    // this system edge. esign.sent completes the step's OWN action (the modal
    // flips to "sent — awaiting signatures"); the graph hop is completion's.
    advances_to: [{ to: advanceTo, gate: 'system', on: 'esign.completed' }],
  }
}

export interface EnsureEsignStageResult {
  graph: Lifecycle
  changed: boolean
}

// Insert the e-sign stage for `docKind` right after the approve step, rewiring
// ONLY the approve edge: approve --draft.approve--> [esign] --esign.completed-->
// <wherever approve previously advanced>. Identity (same reference, changed:
// false) when the graph already has an e-sign step for this kind, has no
// approve anchor to hang it on, or is empty.
export function ensureEsignStage(graph: Lifecycle, docKind: string): EnsureEsignStageResult {
  const kind = docKind.trim()
  if (!kind || graph.length === 0) return { graph, changed: false }
  if (hasEsignStageFor(graph, kind)) return { graph, changed: false }

  const anchorIndex = findApproveAnchorIndex(graph, kind)
  if (anchorIndex < 0) return { graph, changed: false }
  const anchor = graph[anchorIndex]!
  const approveEdge = anchor.advances_to.find(
    (e) => e.gate === 'attorney' && e.via === 'draft.approve',
  )
  if (!approveEdge) return { graph, changed: false }

  const stage = buildEsignStage(graph, kind, approveEdge.to)
  const patchedAnchor: LifecycleStage = {
    ...anchor,
    advances_to: anchor.advances_to.map((e) =>
      e === approveEdge ? { ...e, to: stage.key } : { ...e },
    ),
  }
  const next = graph.map((s, i) => (i === anchorIndex ? patchedAnchor : s))
  // Array order is display order (resolve.ts stepStates) — insert right after
  // the anchor so the step list reads approve → eSign → what follows.
  next.splice(anchorIndex + 1, 0, stage)
  return { graph: next, changed: true }
}

// The builder-wizard entry: apply ensureEsignStage for every SIGNABLE document
// kind in the service's e-sign config map. Unsignable kinds are skipped, so an
// unsignable service returns the identical graph reference — untouched.
export function ensureEsignStagesForConfigs(
  graph: Lifecycle,
  esignConfigs: Record<string, { signable: boolean }>,
): EnsureEsignStageResult {
  let current = graph
  let changed = false
  for (const [docKind, config] of Object.entries(esignConfigs)) {
    if (!config?.signable) continue
    const result = ensureEsignStage(current, docKind)
    current = result.graph
    changed = changed || result.changed
  }
  return { graph: current, changed }
}
