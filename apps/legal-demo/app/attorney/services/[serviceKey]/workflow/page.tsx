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
import { WorkflowConfigModal } from '@/components/configEditors'
// The pure builder data-model (wire shapes + graph round-trip). Kept in a sibling,
// React-free module so the lossless round-trip is unit-testable — see
// workflowBuilderModel.ts.
import {
  type WfGate,
  type WfActionKind,
  type WfDocumentRef,
  type WfLifecycle,
  type BuilderStep,
  triggerField,
  defaultTrigger,
  nextUid,
  graphToSteps,
  stepsToGraph,
} from './workflowBuilderModel'

// ── Wire shapes (structural mirror; not imported from the server) ──────────────
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

const GATE_LABELS: Record<WfGate, string> = {
  automatic: 'Automatic — the system advances it',
  attorney: 'Attorney — an attorney action advances it',
  client: 'Client — a client action advances it',
  system: 'System — an external event advances it',
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
  // Service display name (for the "Build with AI" primed prompt). Falls back to the
  // serviceKey if the read fails.
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [savingToLib, setSavingToLib] = useState<string | null>(null) // step uid
  const [libNotice, setLibNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  // Phase 9: the shared edit-in-modal over this service's workflow graph.
  const [modalOpen, setModalOpen] = useState(false)
  const [rawGraph, setRawGraph] = useState<unknown[]>([])

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
      const [lc, cat, lib, svc] = await Promise.all([
        callAttorneyMcp<{ lifecycle: { graph: WfLifecycle; version: number } | null }>({
          toolName: 'legal.service.lifecycle.get',
          input: { serviceKey },
        }),
        callAttorneyMcp<WorkflowCatalog>({ toolName: 'legal.workflow.catalog' }),
        callAttorneyMcp<{ steps: WorkflowStepTemplate[] }>({
          toolName: 'legal.workflow_step_template.list',
        }).catch(() => ({ steps: [] as WorkflowStepTemplate[] })),
        callAttorneyMcp<{ service: { displayName: string } | null }>({
          toolName: 'legal.service.get',
          input: { serviceKey },
        }).catch(() => ({ service: null })),
      ])
      setCatalog(cat)
      setLibrary(lib.steps ?? [])
      setVersion(lc.lifecycle?.version ?? null)
      setSteps(lc.lifecycle ? graphToSteps(lc.lifecycle.graph) : [])
      setRawGraph(lc.lifecycle?.graph ?? [])
      setDisplayName(svc.service?.displayName ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSteps([])
    }
  }, [serviceKey])

  // "Build with AI": open the assistant with a primed prompt so the attorney can
  // author this service's workflow conversationally (the chatbot proposes a graph;
  // the attorney approves it on the existing AI authoring path). We dispatch a
  // window event the global assistant dock (FeedbackChat) listens for — it opens
  // grounded in this page with the composer pre-written; the attorney presses Send.
  const buildWithAi = useCallback(() => {
    const name = displayName ?? serviceKey
    const prompt = `Build the workflow for ${name}.`
    window.dispatchEvent(new CustomEvent('exsto:assistant:prime', { detail: { prompt } }))
  }, [displayName, serviceKey])

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
      mk(
        'Client Consultation',
        'view_consultation',
        'attorney',
        'legal.matter.advance',
        false,
        'Consultation',
      ),
      mk(
        'Review & Send document',
        'review_send_document',
        'attorney',
        'draft.approve',
        true,
        'Document review',
        [{ docKind: 'operating_agreement', label: 'Operating Agreement' }],
      ),
      mk(
        'Approve & Send invoice',
        'approve_send_invoice',
        'system',
        'invoice.paid',
        true,
        'Invoice',
      ),
      mk('Invoice paid — Matter complete', 'complete_matter', 'system', '', false, 'Complete'),
    ]
    mutate(tmpl)
  }

  if (steps === null) {
    return (
      <div className="loading-block" role="status">
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

      {/* Discoverable AI entry point: open the assistant primed to author this
          service's workflow. The chatbot proposes a graph; the attorney approves it
          on the existing AI authoring path. Available whether the workflow is empty
          or already has steps (the AI can build from scratch or refine). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          margin: '0.2rem 0 0.8rem',
        }}
      >
        <button type="button" className="outline" onClick={buildWithAi}>
          ✨ Build with AI
        </button>
        <button type="button" className="outline" onClick={() => setModalOpen(true)}>
          Edit in window
        </button>
        <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
          Describe the workflow to the assistant and it&apos;ll draft the steps for you to review.
        </span>
      </div>

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
        <ol
          style={{ listStyle: 'none', margin: '0.6rem 0 0', padding: 0, display: 'grid', gap: 0 }}
        >
          {steps.map((s, i) => (
            <li key={s.uid}>
              <StepCard
                step={s}
                index={i}
                total={steps.length}
                catalog={catalog}
                serviceKey={serviceKey}
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
            <button
              type="button"
              className="outline"
              onClick={() => setAdding(true)}
              disabled={!catalog}
            >
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
      {/* UI-BUILDER-FIX-1 Phase 9: the shared edit-in-modal (view via the same
          step-list a live matter renders / edit / AI-regenerate via worker_job /
          save = a new immutable version) — no navigation. */}
      {modalOpen && (
        <WorkflowConfigModal
          serviceKey={serviceKey}
          graph={rawGraph}
          onClose={() => setModalOpen(false)}
          onChanged={load}
        />
      )}
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
  return {
    uid: nextUid(),
    key: '',
    label,
    clientLabel,
    actionKind,
    gate,
    trigger,
    blocking,
    documents,
  }
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
  serviceKey,
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
  serviceKey: string
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
            {step.documents.length > 0 &&
              ` · ${step.documents.length} doc${step.documents.length > 1 ? 's' : ''}`}
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
        <StepEditor
          step={step}
          isLast={isLast}
          catalog={catalog}
          serviceKey={serviceKey}
          onChange={onChange}
        />
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
      <button
        type="button"
        className="outline"
        onClick={onCancel}
        style={{ padding: '0.3rem 0.6rem' }}
      >
        Cancel
      </button>
    </div>
  )
}

function StepEditor({
  step,
  isLast,
  catalog,
  serviceKey,
  onChange,
}: {
  step: BuilderStep
  isLast: boolean
  catalog: WorkflowCatalog | null
  serviceKey: string
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
            <select
              value={step.gate}
              onChange={(e) => onChange({ gate: e.target.value as WfGate })}
            >
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

      <DocumentRows documents={step.documents} onChange={(documents) => onChange({ documents })} />

      {/* NEW-G: config lives WITH the step it drives. A capability step carries the
          attorney's standing instructions (rubric / materials message) in
          action.config.capability_config; a generate step's drafting instructions are
          the service-level prompt keyed by document kind, surfaced here on the step. */}
      {step.actionKind === 'invoke_capability' && (
        <CapabilityConfigEditor config={step.config} onChange={(config) => onChange({ config })} />
      )}
      {step.actionKind === 'generate_document' && (
        <DraftingInstructionsEditor serviceKey={serviceKey} documents={step.documents} />
      )}
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

function humanizeDocKind(k: string): string {
  return k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// NEW-G: the attorney's standing instructions for an invoke_capability step (the AI
// review rubric, the "request materials" message, …). These live in
// action.config.capability_config; we edit the STRING values in place and hand the
// whole config object back so it round-trips (stepsToGraph writes action.config
// verbatim). Non-string values are shown read-only so a structured config is never
// silently flattened.
function CapabilityConfigEditor({
  config,
  onChange,
}: {
  config?: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const cfg = config ?? {}
  const slug = typeof cfg.capability_slug === 'string' ? cfg.capability_slug : ''
  const capConfig = (cfg.capability_config ?? {}) as Record<string, unknown>
  const keys = Object.keys(capConfig)

  function setKey(key: string, value: string) {
    onChange({ ...cfg, capability_config: { ...capConfig, [key]: value } })
  }

  return (
    <fieldset className="svc-fieldset">
      <legend>Capability configuration{slug ? ` · ${slug}` : ''}</legend>
      {keys.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: 0 }}>
          This capability has no editable instructions.
        </p>
      )}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {keys.map((key) => {
          const value = capConfig[key]
          if (typeof value !== 'string') {
            return (
              <label key={key}>
                <span>{humanizeDocKind(key)}</span>
                <pre
                  style={{
                    color: 'var(--muted)',
                    fontSize: '0.8rem',
                    whiteSpace: 'pre-wrap',
                    margin: '0.2rem 0 0',
                  }}
                >
                  {JSON.stringify(value)}
                </pre>
              </label>
            )
          }
          return (
            <label key={key}>
              <span>{humanizeDocKind(key)}</span>
              <textarea value={value} rows={3} onChange={(e) => setKey(key, e.target.value)} />
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

// NEW-G: a generate step's drafting instructions are the service-level prompt keyed by
// document kind (same store the Prompt tab edits). Surfaced ON the step here so config
// lives with the step that consumes it. Authoritative — it reads/writes the same
// legal.service.prompt.get/update store; the separate Prompt tab is untouched.
function DraftingInstructionsEditor({
  serviceKey,
  documents,
}: {
  serviceKey: string
  documents: WfDocumentRef[]
}) {
  const docKinds = documents
    .map((d) => d.docKind?.trim())
    .filter((k): k is string => !!k && k.length > 0)
  if (docKinds.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: 0 }}>
        Add a document kind above to edit its drafting instructions.
      </p>
    )
  }
  return (
    <>
      {docKinds.map((dk) => (
        <DraftingInstructionsForKind key={dk} serviceKey={serviceKey} docKind={dk} />
      ))}
    </>
  )
}

function DraftingInstructionsForKind({
  serviceKey,
  docKind,
}: {
  serviceKey: string
  docKind: string
}) {
  const [text, setText] = useState<string | null>(null) // null while loading
  const [source, setSource] = useState<'config' | 'repo' | 'none'>('none')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{
        prompt: { promptText: string | null; source: 'config' | 'repo' | 'none' } | null
      }>({ toolName: 'legal.service.prompt.get', input: { serviceKey, documentKind: docKind } })
      setText(r.prompt?.promptText ?? '')
      setSource(r.prompt?.source ?? 'none')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setText('')
    }
  }, [serviceKey, docKind])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    if (text == null) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      // The server validates the required {{slots}} and throws with guidance if any
      // are missing — surface that rather than re-implementing the slot list here.
      await callAttorneyMcp({
        toolName: 'legal.service.prompt.update',
        input: { serviceKey, documentKind: docKind, promptText: text },
      })
      setSource('config')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset className="svc-fieldset">
      <legend>Drafting instructions · {humanizeDocKind(docKind)}</legend>
      {text == null ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <>
          <textarea
            value={text}
            rows={10}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value)
              setSaved(false)
              setError(null)
            }}
            style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem', width: '100%' }}
            placeholder="Drafting instructions, including the required {{slots}}…"
          />
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.4rem' }}
          >
            <button type="button" className="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save instructions'}
            </button>
            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
              {source === 'config'
                ? 'Custom instructions'
                : source === 'repo'
                  ? 'Using the built-in default'
                  : 'No instructions yet'}
            </span>
          </div>
          {error && (
            <div className="alert alert-error" style={{ marginTop: '0.4rem' }}>
              {error}
            </div>
          )}
          {saved && (
            <div className="alert alert-success" style={{ marginTop: '0.4rem' }}>
              Saved a new version.
            </div>
          )}
        </>
      )}
    </fieldset>
  )
}
