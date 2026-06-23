'use client'

// Service editor › WORKFLOW tab (ADR 0045 PR4b). A make.com-style builder that
// lets an attorney compose a service's lifecycle visually and save it through
// legal.service.lifecycle.set. The builder is LINEAR for now — an ordered column
// of step cards, each wired to the next — but it edits and saves the full edge
// model (to/gate/via/on), so a later branching UI is an addition, not a rewrite.
//
// CONSTRAINT: no server-package imports. The lifecycle/catalog shapes below are a
// structural mirror of verticals/legal/src/lifecycle/{types,catalog}.ts (the same
// approach the matter editor's shared.tsx takes). The CLOSED catalog of actions +
// gates is read at runtime from legal.workflow.catalog, so the guardrail stays
// server-side; these types are only the wire shape. The page chrome (title, tabs)
// comes from the [serviceKey] layout, so this renders panel content only.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

// ── Wire shapes (structural mirror; not imported from the server) ──────────────
type WfGate = 'automatic' | 'attorney' | 'client' | 'system'
type WfActionKind =
  | 'view_intake'
  | 'view_consultation'
  | 'generate_document'
  | 'review_send_document'
  | 'approve_send_invoice'
  | 'await_payment'
  | 'manual_task'
  | 'complete_matter'

interface WfEdge {
  to: string
  gate: WfGate
  via?: string
  on?: string
  when?: string
}
interface WfDocumentRef {
  templateEntityId?: string
  docKind?: string
  label?: string
}
interface WfStage {
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
type WfLifecycle = WfStage[]

interface CatalogAction {
  kind: WfActionKind
  label: string
  description: string
  defaultGate: WfGate
  blocking: boolean
}
interface WorkflowCatalog {
  actions: CatalogAction[]
  gates: WfGate[]
}

// ── Workflow STEP library (PR4c) ───────────────────────────────────────────────
// A saved step's STAGE is a LifecycleStage WITHOUT edges (no advances_to/key/
// entry/terminal): { label, client_label?, action {kind,config?}, gate, documents?,
// blocking? }. Mirrors verticals/legal/src/queries/workflowStepLibrary.ts — NOT
// imported (no server-package imports). The builder wires the outgoing edge + gate
// when a saved step is dropped in, exactly as a catalog add does.
interface WfStepStage {
  label: string
  client_label?: string
  blocking?: boolean
  gate: WfGate
  action: { kind: WfActionKind; config?: Record<string, unknown> }
  documents?: WfDocumentRef[]
}
interface WorkflowStepTemplate {
  workflowStepTemplateId: string
  name: string
  description: string | null
  stage: WfStepStage
}

// ── The builder's working model. One Step per stage, in display = run order. The
// outgoing edge to the NEXT step is implicit (rebuilt on save); we only keep the
// per-step gate + trigger so editing is local and reordering is trivial. The last
// step is terminal (no outgoing edge); every earlier step → the next. ──────────
interface BuilderStep {
  // Stable id for React keys + reordering; distinct from the saved stage `key`,
  // which is slugged from the label on save so the running matter_status reads well.
  uid: string
  // The persisted stage key. Preserved across edits where possible so a saved-then-
  // edited graph keeps stable keys; regenerated from the label only when blank.
  key: string
  label: string
  clientLabel: string
  actionKind: WfActionKind
  gate: WfGate // gate on THIS step's outgoing edge (ignored on the terminal step)
  trigger: string // via/on text for the outgoing edge (optional; defaulted per gate)
  blocking: boolean
  documents: WfDocumentRef[]
}

const GATE_LABELS: Record<WfGate, string> = {
  automatic: 'Automatic — the system advances it',
  attorney: 'Attorney — an attorney action advances it',
  client: 'Client — a client action advances it',
  system: 'System — an external event advances it',
}

// `via` names the action that fires attorney/client edges; `on` names the event a
// automatic/system edge waits for. We store one free-text "trigger" per step and
// place it on the right field at save time based on the gate.
function triggerField(gate: WfGate): 'via' | 'on' {
  return gate === 'attorney' || gate === 'client' ? 'via' : 'on'
}
// A sensible default trigger so a saved edge is never empty-but-meaningful. The
// attorney can override it in the step panel.
function defaultTrigger(gate: WfGate, actionKind: WfActionKind): string {
  if (gate === 'attorney') return 'legal.matter.advance'
  if (gate === 'client') return 'booking.create'
  if (gate === 'system') return actionKind === 'approve_send_invoice' ? 'invoice.paid' : 'event'
  return 'condition' // automatic
}

let uidSeq = 0
function nextUid(): string {
  uidSeq += 1
  return `s${uidSeq}_${Math.random().toString(36).slice(2, 7)}`
}

// label → a stable, unique stage key (== the matter_status value the engine writes).
function slugKey(label: string, taken: Set<string>): string {
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
// The graph is already linear in practice; we walk it from the entry stage by
// following the single outgoing edge so display order == run order even if the
// stored array order drifted.
function graphToSteps(graph: WfLifecycle): BuilderStep[] {
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
  // Include any stages the walk didn't reach (defensive — shouldn't happen for a
  // valid linear graph) so nothing silently disappears on load.
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
    }
  })
}

// Assemble the linear Lifecycle to save: first step is the entry, last is terminal
// (no outgoing edge), every other step → the next via one edge carrying the step's
// gate + trigger. Keys are stabilized/uniquified from labels.
function stepsToGraph(steps: BuilderStep[]): WfLifecycle {
  const taken = new Set<string>()
  // Resolve a unique key for each step first (so edges can reference the next key).
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
    const stage: WfStage = {
      key: keys[i],
      label: s.label.trim() || `Step ${i + 1}`,
      entry: i === 0 || undefined,
      terminal: isLast || undefined,
      action: { kind: s.actionKind },
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

// One builder step → a saved-step STAGE (no edges/key/entry/terminal). The step's
// per-step `gate` is the gate its OUTGOING edge gets by default when reused; we
// carry it so a dropped-in step keeps a sensible default. The free-text trigger is
// NOT saved — it is edge metadata the builder re-defaults per gate at insertion.
function stepToStage(s: BuilderStep): WfStepStage {
  const stage: WfStepStage = {
    label: s.label.trim() || 'Step',
    gate: s.gate,
    action: { kind: s.actionKind },
  }
  if (s.clientLabel.trim()) stage.client_label = s.clientLabel.trim()
  if (!s.blocking) stage.blocking = false
  if (s.documents.length) stage.documents = s.documents
  return stage
}

// A saved-step STAGE → a fresh builder step (new uid, blank key so it slugs on
// save). Edge wiring (the outgoing edge to the next step) is rebuilt on save by
// stepsToGraph, exactly as for a catalog add.
function stageToStep(t: WorkflowStepTemplate): BuilderStep {
  const st = t.stage
  return {
    uid: nextUid(),
    key: '',
    label: st.label || t.name,
    clientLabel: st.client_label ?? '',
    actionKind: st.action?.kind ?? 'manual_task',
    gate: st.gate ?? 'attorney',
    trigger: '',
    blocking: st.blocking !== false,
    documents: st.documents ?? [],
  }
}

export default function ServiceWorkflowPage() {
  const params = useParams<{ serviceKey: string }>()
  const serviceKey = params.serviceKey

  const [catalog, setCatalog] = useState<WorkflowCatalog | null>(null)
  const [library, setLibrary] = useState<WorkflowStepTemplate[]>([])
  const [steps, setSteps] = useState<BuilderStep[] | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [savingToLib, setSavingToLib] = useState<string | null>(null) // step uid
  const [libNotice, setLibNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  // Refresh just the step library (after a Save to library). Tolerant: a library
  // load failure must not blank the builder.
  const loadLibrary = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ steps: WorkflowStepTemplate[] }>({
        toolName: 'legal.workflow_step_template.list',
      })
      setLibrary(r.steps ?? [])
    } catch {
      setLibrary([])
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [lc, cat, lib] = await Promise.all([
        callAttorneyMcp<{ lifecycle: { graph: WfLifecycle; version: number } | null }>({
          toolName: 'legal.service.lifecycle.get',
          input: { serviceKey },
        }),
        callAttorneyMcp<WorkflowCatalog>({ toolName: 'legal.workflow.catalog' }),
        callAttorneyMcp<{ steps: WorkflowStepTemplate[] }>({
          toolName: 'legal.workflow_step_template.list',
        }).catch(() => ({ steps: [] as WorkflowStepTemplate[] })),
      ])
      setCatalog(cat)
      setLibrary(lib.steps ?? [])
      setVersion(lc.lifecycle?.version ?? null)
      setSteps(lc.lifecycle ? graphToSteps(lc.lifecycle.graph) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSteps([])
    }
  }, [serviceKey])

  useEffect(() => {
    load()
  }, [load])

  function mutate(next: BuilderStep[]) {
    setSteps(next)
    setSaved(false)
    setSaveErrors([])
  }

  function addStep(action: CatalogAction) {
    if (!steps) return
    const step: BuilderStep = {
      uid: nextUid(),
      key: '',
      label: action.label,
      clientLabel: '',
      actionKind: action.kind,
      gate: action.defaultGate,
      trigger: '',
      blocking: action.blocking,
      documents: [],
    }
    mutate([...steps, step])
    setAdding(false)
    setEditing(step.uid)
  }

  // Drop a saved library step in as a new step (a fresh, editable copy — the
  // builder wires its outgoing edge on save, exactly like a catalog add).
  function addFromLibrary(t: WorkflowStepTemplate) {
    if (!steps) return
    const step = stageToStep(t)
    mutate([...steps, step])
    setAdding(false)
    setEditing(step.uid)
  }

  // Save one builder step to the firm library, then refresh the picker so it's
  // immediately reusable. The stored stage carries NO edges (the handler rejects
  // advances_to), so it can be dropped into any workflow without a half-edge.
  async function saveStepToLibrary(uid: string, name: string) {
    const step = steps?.find((s) => s.uid === uid)
    if (!step) return
    const trimmed = name.trim()
    if (!trimmed) return
    setSavingToLib(null)
    setLibNotice(null)
    try {
      await callAttorneyMcp<{ step: WorkflowStepTemplate }>({
        toolName: 'legal.workflow_step_template.create',
        input: { name: trimmed, stage: stepToStage(step) },
      })
      await loadLibrary()
      setLibNotice(`Saved "${trimmed}" to your step library.`)
      setTimeout(() => setLibNotice(null), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function updateStep(uid: string, patch: Partial<BuilderStep>) {
    if (!steps) return
    mutate(steps.map((s) => (s.uid === uid ? { ...s, ...patch } : s)))
  }

  function removeStep(uid: string) {
    if (!steps) return
    mutate(steps.filter((s) => s.uid !== uid))
    if (editing === uid) setEditing(null)
  }

  function move(uid: string, dir: -1 | 1) {
    if (!steps) return
    const i = steps.findIndex((s) => s.uid === uid)
    const j = i + dir
    if (i < 0 || j < 0 || j >= steps.length) return
    const next = steps.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    mutate(next)
  }

  async function save() {
    if (!steps) return
    if (steps.length === 0) {
      setSaveErrors(['Add at least one step before saving.'])
      return
    }
    if (steps.some((s) => !s.label.trim())) {
      setSaveErrors(['Every step needs a label.'])
      return
    }
    setBusy(true)
    setError(null)
    setSaveErrors([])
    try {
      const graph = stepsToGraph(steps)
      const r = await callAttorneyMcp<{ version: number }>({
        toolName: 'legal.service.lifecycle.set',
        input: { serviceKey, graph },
      })
      setVersion(r.version)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      await load()
    } catch (e) {
      // The server validates via validateLifecycle and throws with the joined
      // error list; surface it inline rather than as a bare request failure.
      const msg = e instanceof Error ? e.message : String(e)
      setSaveErrors(msg.split(/;\s*|\n/).filter(Boolean))
    } finally {
      setBusy(false)
    }
  }

  function startFromSmllc() {
    // The shape of NC_SMLLC_AUTHORED, mirrored locally (no server import). Gives the
    // attorney a known-good 5-step starting point to tweak rather than a blank page.
    const tmpl: BuilderStep[] = [
      mk('Client Intake', 'view_intake', 'client', 'booking.create', true, 'Intake'),
      mk('Client Consultation', 'view_consultation', 'attorney', 'legal.matter.advance', false, 'Consultation'),
      mk('Review & Send document', 'review_send_document', 'attorney', 'draft.approve', true, 'Document review', [
        { docKind: 'operating_agreement', label: 'Operating Agreement' },
      ]),
      mk('Approve & Send invoice', 'approve_send_invoice', 'system', 'invoice.paid', true, 'Invoice'),
      mk('Invoice paid — Matter complete', 'complete_matter', 'system', '', false, 'Complete'),
    ]
    mutate(tmpl)
  }

  if (steps === null) {
    return (
      <div className="loading-block">
        <span className="spinner" /> Loading workflow…
      </div>
    )
  }

  return (
    <section>
      <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
        Compose this service&apos;s workflow as an ordered set of steps. New matters run these steps
        in order. Saving creates a new immutable workflow version
        {version != null ? ` (currently v${version})` : ''}; matters already in flight keep theirs.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {saveErrors.length > 0 && (
        <div className="alert alert-error">
          <strong>Couldn&apos;t save this workflow:</strong>
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
            {saveErrors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {saved && (
        <div
          className="alert"
          style={{ background: 'var(--ok-soft)', color: '#166534', border: '1px solid #86efac' }}
        >
          Saved workflow {version != null ? `v${version}` : ''}.
        </div>
      )}
      {libNotice && (
        <div
          className="alert"
          style={{ background: 'var(--ok-soft)', color: '#166534', border: '1px solid #86efac' }}
        >
          {libNotice}
        </div>
      )}

      {steps.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: '1.4rem',
            textAlign: 'center',
            color: 'var(--muted)',
          }}
        >
          {adding ? (
            <AddPalette
              catalog={catalog}
              library={library}
              onPick={addStep}
              onPickLibrary={addFromLibrary}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <>
              <p style={{ margin: '0 0 0.8rem' }}>No workflow yet — add your first step.</p>
              {catalog && (
                <button type="button" className="primary" onClick={() => setAdding(true)}>
                  + Add a step
                </button>
              )}
              <div style={{ marginTop: '0.7rem' }}>
                <button type="button" className="outline" onClick={startFromSmllc}>
                  Start from the SMLLC template
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <ol style={{ listStyle: 'none', margin: '0.6rem 0 0', padding: 0, display: 'grid', gap: 0 }}>
          {steps.map((s, i) => (
            <li key={s.uid}>
              <StepCard
                step={s}
                index={i}
                total={steps.length}
                catalog={catalog}
                open={editing === s.uid}
                onToggle={() => setEditing(editing === s.uid ? null : s.uid)}
                onChange={(patch) => updateStep(s.uid, patch)}
                onRemove={() => removeStep(s.uid)}
                onMoveUp={() => move(s.uid, -1)}
                onMoveDown={() => move(s.uid, 1)}
                savingToLib={savingToLib === s.uid}
                onStartSaveToLib={() => setSavingToLib(s.uid)}
                onCancelSaveToLib={() => setSavingToLib(null)}
                onSaveToLib={(name) => saveStepToLibrary(s.uid, name)}
              />
              {i < steps.length - 1 && <Connector />}
            </li>
          ))}
        </ol>
      )}

      {steps.length > 0 && (
        <div style={{ marginTop: '0.6rem' }}>
          {adding ? (
            <AddPalette
              catalog={catalog}
              library={library}
              onPick={addStep}
              onPickLibrary={addFromLibrary}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" className="outline" onClick={() => setAdding(true)} disabled={!catalog}>
              + Add step
            </button>
          )}
        </div>
      )}

      <div style={{ marginTop: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
        <button className="primary" onClick={save} disabled={busy || steps.length === 0}>
          {busy ? 'Saving…' : 'Save workflow'}
        </button>
        <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
          The last step is the terminal step (closes the matter); every earlier step advances to the
          one below it.
        </span>
      </div>
    </section>
  )
}

function mk(
  label: string,
  actionKind: WfActionKind,
  gate: WfGate,
  trigger: string,
  blocking: boolean,
  clientLabel = '',
  documents: WfDocumentRef[] = [],
): BuilderStep {
  return { uid: nextUid(), key: '', label, clientLabel, actionKind, gate, trigger, blocking, documents }
}

function Connector() {
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        justifyContent: 'center',
        color: 'var(--muted)',
        height: 22,
        lineHeight: '22px',
        fontSize: '1.1rem',
      }}
    >
      ↓
    </div>
  )
}

// A palette of catalog actions; picking one appends a step seeded with that
// action's label + defaultGate (handled by the parent's addStep). PR4c: it also
// lists the firm's SAVED step library — picking one appends an editable copy of
// that saved step (the builder wires its edge on save, just like a catalog add).
function AddPalette({
  catalog,
  library,
  onPick,
  onPickLibrary,
  onCancel,
}: {
  catalog: WorkflowCatalog | null
  library: WorkflowStepTemplate[]
  onPick: (a: CatalogAction) => void
  onPickLibrary: (t: WorkflowStepTemplate) => void
  onCancel: () => void
}) {
  if (!catalog) return null
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.8rem',
        background: 'var(--surface, #fafafa)',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>Pick a step action</strong>
        <button
          type="button"
          className="back-link"
          onClick={onCancel}
          style={{ marginLeft: 'auto' }}
        >
          Cancel
        </button>
      </div>
      <div style={{ display: 'grid', gap: '0.4rem' }}>
        {catalog.actions.map((a) => (
          <button
            key={a.kind}
            type="button"
            onClick={() => onPick(a)}
            style={{
              textAlign: 'left',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '0.55rem 0.7rem',
              background: 'var(--bg, #fff)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.label}</div>
            <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{a.description}</div>
          </button>
        ))}
      </div>

      {library.length > 0 && (
        <>
          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              margin: '0.8rem 0 0.4rem',
            }}
          >
            From your step library
          </div>
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {library.map((t) => {
              const actionLabel =
                catalog.actions.find((a) => a.kind === t.stage.action?.kind)?.label ??
                t.stage.action?.kind
              return (
                <button
                  key={t.workflowStepTemplateId}
                  type="button"
                  onClick={() => onPickLibrary(t)}
                  style={{
                    textAlign: 'left',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '0.55rem 0.7rem',
                    background: 'var(--bg, #fff)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.name}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                    {t.description || actionLabel}
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function StepCard({
  step,
  index,
  total,
  catalog,
  open,
  onToggle,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  savingToLib,
  onStartSaveToLib,
  onCancelSaveToLib,
  onSaveToLib,
}: {
  step: BuilderStep
  index: number
  total: number
  catalog: WorkflowCatalog | null
  open: boolean
  onToggle: () => void
  onChange: (patch: Partial<BuilderStep>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  savingToLib: boolean
  onStartSaveToLib: () => void
  onCancelSaveToLib: () => void
  onSaveToLib: (name: string) => void
}) {
  const isLast = index === total - 1
  const actionLabel =
    catalog?.actions.find((a) => a.kind === step.actionKind)?.label ?? step.actionKind

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.7rem 0.8rem',
        background: 'var(--bg, #fff)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--border)',
            fontSize: '0.75rem',
            fontWeight: 600,
            flex: '0 0 auto',
          }}
        >
          {index + 1}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{step.label || <em>Untitled step</em>}</div>
          <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
            {actionLabel}
            {' · '}
            {isLast ? 'terminal' : `gate: ${step.gate}`}
            {step.documents.length > 0 && ` · ${step.documents.length} doc${step.documents.length > 1 ? 's' : ''}`}
            {!step.blocking && ' · non-blocking'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem', flex: '0 0 auto' }}>
          <button
            type="button"
            className="outline"
            title="Move up"
            onClick={onMoveUp}
            disabled={index === 0}
            style={{ padding: '0.25rem 0.5rem' }}
          >
            ↑
          </button>
          <button
            type="button"
            className="outline"
            title="Move down"
            onClick={onMoveDown}
            disabled={isLast}
            style={{ padding: '0.25rem 0.5rem' }}
          >
            ↓
          </button>
          <button
            type="button"
            className="outline"
            title="Save this step to the firm library for reuse in other workflows"
            onClick={onStartSaveToLib}
            disabled={savingToLib}
            style={{ padding: '0.25rem 0.6rem' }}
          >
            Save to library
          </button>
          <button
            type="button"
            className="outline"
            onClick={onToggle}
            style={{ padding: '0.25rem 0.6rem' }}
          >
            {open ? 'Done' : 'Edit'}
          </button>
          <button
            type="button"
            className="danger outline"
            title="Remove step"
            onClick={onRemove}
            style={{ padding: '0.25rem 0.5rem' }}
          >
            ✕
          </button>
        </div>
      </div>

      {savingToLib && (
        <SaveToLibraryRow
          defaultName={step.label}
          onCancel={onCancelSaveToLib}
          onSave={onSaveToLib}
        />
      )}

      {open && (
        <StepEditor step={step} isLast={isLast} catalog={catalog} onChange={onChange} />
      )}
    </div>
  )
}

// Inline name prompt for saving a step to the library. The saved stage carries no
// edges (the builder rebuilds those on insertion), so a library name is all we ask.
function SaveToLibraryRow({
  defaultName,
  onCancel,
  onSave,
}: {
  defaultName: string
  onCancel: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(defaultName)
  return (
    <div
      style={{
        marginTop: '0.6rem',
        display: 'flex',
        gap: '0.4rem',
        alignItems: 'center',
        padding: '0.5rem',
        border: '1px dashed var(--border)',
        borderRadius: 6,
        background: 'var(--surface, #fafafa)',
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name this saved step"
        style={{ flex: 1 }}
        autoFocus
      />
      <button
        type="button"
        className="primary"
        onClick={() => onSave(name)}
        disabled={!name.trim()}
        style={{ padding: '0.3rem 0.7rem' }}
      >
        Save
      </button>
      <button type="button" className="outline" onClick={onCancel} style={{ padding: '0.3rem 0.6rem' }}>
        Cancel
      </button>
    </div>
  )
}

function StepEditor({
  step,
  isLast,
  catalog,
  onChange,
}: {
  step: BuilderStep
  isLast: boolean
  catalog: WorkflowCatalog | null
  onChange: (patch: Partial<BuilderStep>) => void
}) {
  const gates = catalog?.gates ?? (['automatic', 'attorney', 'client', 'system'] as WfGate[])
  return (
    <div style={{ marginTop: '0.7rem', display: 'grid', gap: '0.6rem' }}>
      <div className="form-grid">
        <label>
          <span>Step label</span>
          <input value={step.label} onChange={(e) => onChange({ label: e.target.value })} />
        </label>
        <label>
          <span>Client-facing label (optional)</span>
          <input
            value={step.clientLabel}
            onChange={(e) => onChange({ clientLabel: e.target.value })}
            placeholder="Falls back to the step label"
          />
        </label>
      </div>

      <label>
        <span>Action</span>
        <select
          value={step.actionKind}
          onChange={(e) => onChange({ actionKind: e.target.value as WfActionKind })}
        >
          {(catalog?.actions ?? []).map((a) => (
            <option key={a.kind} value={a.kind}>
              {a.label}
            </option>
          ))}
        </select>
        {catalog && (
          <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
            {catalog.actions.find((a) => a.kind === step.actionKind)?.description}
          </span>
        )}
      </label>

      <label className="svc-check" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={step.blocking}
          onChange={(e) => onChange({ blocking: e.target.checked })}
        />
        <span>Blocking — this step holds the matter until it&apos;s done</span>
      </label>

      {!isLast && (
        <fieldset className="svc-fieldset">
          <legend>Advance to the next step</legend>
          <label>
            <span>Gate — who or what advances it</span>
            <select value={step.gate} onChange={(e) => onChange({ gate: e.target.value as WfGate })}>
              {gates.map((g) => (
                <option key={g} value={g}>
                  {GATE_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'block', marginTop: '0.5rem' }}>
            <span>
              {triggerField(step.gate) === 'via'
                ? 'Action that fires it (via) — optional'
                : 'Event/condition it waits for (on) — optional'}
            </span>
            <input
              value={step.trigger}
              onChange={(e) => onChange({ trigger: e.target.value })}
              placeholder={defaultTrigger(step.gate, step.actionKind)}
            />
          </label>
        </fieldset>
      )}
      {isLast && (
        <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: 0 }}>
          This is the terminal step — it closes the matter and has no outgoing connection.
        </p>
      )}

      <DocumentRows
        documents={step.documents}
        onChange={(documents) => onChange({ documents })}
      />
    </div>
  )
}

// docKind + label rows for the step's documents. templateEntityId binding (picking
// a specific template from the library) is a later addition; for now the attorney
// names the document by kind + label, matching the SMLLC authored shape.
function DocumentRows({
  documents,
  onChange,
}: {
  documents: WfDocumentRef[]
  onChange: (docs: WfDocumentRef[]) => void
}) {
  function set(i: number, patch: Partial<WfDocumentRef>) {
    onChange(documents.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  }
  return (
    <fieldset className="svc-fieldset">
      <legend>Documents (optional)</legend>
      {documents.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: '0 0 0.4rem' }}>
          No documents on this step.
        </p>
      )}
      <div style={{ display: 'grid', gap: '0.4rem' }}>
        {documents.map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              value={d.docKind ?? ''}
              onChange={(e) => set(i, { docKind: e.target.value })}
              placeholder="Document kind (e.g. operating_agreement)"
              style={{ flex: 1 }}
            />
            <input
              value={d.label ?? ''}
              onChange={(e) => set(i, { label: e.target.value })}
              placeholder="Label (e.g. Operating Agreement)"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="danger outline"
              onClick={() => onChange(documents.filter((_, idx) => idx !== i))}
              style={{ padding: '0.25rem 0.5rem' }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="outline"
        onClick={() => onChange([...documents, { docKind: '', label: '' }])}
        style={{ marginTop: '0.4rem' }}
      >
        + Add document
      </button>
    </fieldset>
  )
}
