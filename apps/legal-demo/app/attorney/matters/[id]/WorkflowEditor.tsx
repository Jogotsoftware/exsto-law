'use client'

// Per-matter workflow editor (ADR 0045 PR6) — the "Edit steps for this matter" mode
// on the matter Workflow window. The attorney tailors THIS matter's lifecycle:
// drag-to-reorder the stages, add a step (from the closed step-action catalog OR the
// firm's reusable step library), or remove a step — then Save. Save POSTs the
// rebuilt graph to /api/attorney/matters/[id]/workflow, which calls setMatterWorkflow
// → legal.matter.set_workflow. The service's default lifecycle is NEVER touched
// (the action writes only workflow_instance.states_override).
//
// Two invariants the editor preserves so the handler accepts the graph:
//   • LINEAR + edges rebuilt on save — the array order IS the workflow order; on
//     Save each non-terminal stage gets exactly ONE outgoing edge to the next stage
//     (gate = the step's default gate from the catalog), the last stage is terminal
//     with no edges. The attorney never hand-edits edges.
//   • the matter's CURRENT step stays present — it cannot be removed (the handler
//     rejects an orphaning graph; the UI also blocks it, with a hint).
import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/Modal'
import { XIcon, PlusIcon } from '@/components/icons'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import type { MatterWorkflow, WfStage, WfGate, WfStepActionKind } from './shared'
import { buildMatterGraph } from './workflowGraph'

// The closed step-action catalog (the builder palette), loaded from the server-side
// guardrail (legal.workflow.catalog) so the UI never re-declares the closed set.
interface CatalogAction {
  kind: WfStepActionKind
  label: string
  description: string
  defaultGate: WfGate
  blocking: boolean
}

// A reusable step from the firm's step library (legal.workflow_step_template.list).
interface StepTemplate {
  workflowStepTemplateId: string
  name: string
  description?: string | null
  stage: {
    label: string
    client_label?: string
    action: { kind: WfStepActionKind; config?: Record<string, unknown> }
    gate: WfGate
    documents?: Array<Record<string, unknown>>
    blocking?: boolean
  }
}

// An editable stage row. We keep the original WfStage but track a stable local id so
// reordering and removal are robust even when two stages share a label.
interface Row {
  localId: string
  stage: WfStage
}

let rowSeq = 0
function nextLocalId(): string {
  rowSeq += 1
  return `row-${rowSeq}`
}

// Slugify a label into a unique stage key for a freshly-added step (existing stages
// keep their key so the current-step guard and history stay aligned).
function freshKey(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'step'
  let key = base
  let n = 1
  while (taken.has(key)) {
    n += 1
    key = `${base}_${n}`
  }
  taken.add(key)
  return key
}

export function WorkflowEditor({
  matterEntityId,
  workflow,
  onClose,
  onSaved,
}: {
  matterEntityId: string
  workflow: MatterWorkflow
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    workflow.graph.map((stage) => ({ localId: nextLocalId(), stage })),
  )
  const [catalog, setCatalog] = useState<CatalogAction[]>([])
  const [library, setLibrary] = useState<StepTemplate[]>([])
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  // WF-FIX-1 (WP4) — repin affordance state.
  const [repinning, setRepinning] = useState(false)
  const [repinError, setRepinError] = useState<string | null>(null)
  // localId of the row whose step config panel is open (NEW-G: edit config in place).
  const [editingId, setEditingId] = useState<string | null>(null)

  // Replace one row's stage (used by the in-place step-config editor). Keeps the row's
  // stable localId so an open panel and drag/remove stay aligned.
  function updateStage(localId: string, next: WfStage) {
    setRows((prev) => prev.map((r) => (r.localId === localId ? { ...r, stage: next } : r)))
  }

  // Load the palette (catalog) + the reusable step library once.
  useEffect(() => {
    void (async () => {
      try {
        const cat = await callAttorneyMcp<{ actions: CatalogAction[] }>({
          toolName: 'legal.workflow.catalog',
          input: {},
        })
        setCatalog(cat.actions ?? [])
      } catch {
        /* palette is best-effort; the add menu just shows fewer options */
      }
      try {
        const lib = await callAttorneyMcp<{ steps: StepTemplate[] }>({
          toolName: 'legal.workflow_step_template.list',
          input: {},
        })
        setLibrary(lib.steps ?? [])
      } catch {
        /* library is optional */
      }
    })()
  }, [])

  const currentState = workflow.currentState

  // ── reorder (drag) ─────────────────────────────────────────────────────────
  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return setDragId(null)
    setRows((prev) => {
      const from = prev.findIndex((r) => r.localId === dragId)
      const to = prev.findIndex((r) => r.localId === targetId)
      if (from < 0 || to < 0) return prev
      const next = prev.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setDragId(null)
  }

  // ── remove (never the current step) ──────────────────────────────────────
  function removeRow(localId: string) {
    setRows((prev) => prev.filter((r) => r.localId !== localId || r.stage.key === currentState))
  }

  // ── add (from catalog or library) ────────────────────────────────────────
  function addCatalogStep(a: CatalogAction) {
    const taken = new Set(rows.map((r) => r.stage.key))
    const stage: WfStage = {
      key: freshKey(a.label, taken),
      label: a.label,
      action: { kind: a.kind },
      blocking: a.blocking,
      advances_to: [], // edges are rebuilt on save from array order
    }
    setRows((prev) => [...prev, { localId: nextLocalId(), stage }])
    setAdding(false)
  }

  function addLibraryStep(t: StepTemplate) {
    const taken = new Set(rows.map((r) => r.stage.key))
    const stage: WfStage = {
      key: freshKey(t.stage.label || t.name, taken),
      label: t.stage.label || t.name,
      client_label: t.stage.client_label,
      action: t.stage.action,
      blocking: t.stage.blocking,
      documents: t.stage.documents as WfStage['documents'],
      advances_to: [],
    }
    setRows((prev) => [...prev, { localId: nextLocalId(), stage }])
    setAdding(false)
  }

  // The current step must remain in the graph (the handler rejects an orphaning
  // graph; we surface it early so Save is never a surprise).
  const keepsCurrent = useMemo(
    () => rows.some((r) => r.stage.key === currentState),
    [rows, currentState],
  )

  // Rebuild the linear graph on save via the pure, LOSSLESS builder: array order is
  // workflow order; each non-terminal stage keeps its OWN outgoing edge (on/via/gate
  // preserved, only re-pointed at the next stage); the last stage is terminal. A
  // freshly-added step (no saved edge) gets a valid default from the catalog gate.
  // Round-tripping an unchanged graph is the identity — see workflowGraph.ts.
  const catalogGates = useMemo(
    () => catalog.map((c) => ({ kind: c.kind, defaultGate: c.defaultGate })),
    [catalog],
  )

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const graph = buildMatterGraph(
        rows.map((r) => r.stage),
        catalogGates,
      )
      const res = await fetch(`/api/attorney/matters/${matterEntityId}/workflow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ states: graph }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save the workflow.')
      await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  // WF-FIX-1 (WP4): the service workflow moved past the version this matter is
  // pinned to — offer the sanctioned repin (successor instance; handler errors,
  // e.g. the missing-stage one listing valid keys, surface verbatim).
  const repinAvailable =
    typeof workflow.boundVersion === 'number' &&
    typeof workflow.latestVersion === 'number' &&
    workflow.latestVersion > workflow.boundVersion
  const repin = async (): Promise<void> => {
    setRepinning(true)
    setRepinError(null)
    try {
      const res = await fetch(
        `/api/attorney/matters/${encodeURIComponent(matterEntityId)}/workflow/repin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(workflow.hasOverride ? { clearOverride: true } : {}),
        },
      )
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setRepinError(body?.error ?? 'Could not update the workflow.')
        return
      }
      await onSaved()
      onClose()
    } finally {
      setRepinning(false)
    }
  }

  return (
    <Modal
      title="Edit steps for this matter"
      onClose={onClose}
      footer={
        <>
          {error && (
            <span className="text-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </span>
          )}
          <button className="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => void save()}
            disabled={saving || !keepsCurrent}
          >
            {saving && <span className="spinner" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <p className="text-muted text-sm" style={{ marginBottom: 'var(--space-3)' }}>
        Changes apply to <strong>this matter only</strong> — the service’s default workflow is not
        affected. Drag to reorder. The current step can’t be removed.
      </p>

      {repinAvailable && (
        <div
          className="text-sm"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-3)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        >
          <span>
            The service’s workflow has been updated (v{workflow.boundVersion} → v
            {workflow.latestVersion}). This matter still runs the older version
            {workflow.hasOverride ? ' with per-matter customizations (updating discards them)' : ''}
            .
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {repinError && <span style={{ color: 'var(--danger)' }}>{repinError}</span>}
            <button className="button" onClick={() => void repin()} disabled={repinning}>
              {repinning ? 'Updating…' : 'Update to latest workflow'}
            </button>
          </span>
        </div>
      )}

      <div className="step-list">
        {rows.map((r) => {
          const isCurrent = r.stage.key === currentState
          const configurable = stepHasConfig(r.stage)
          const isEditing = editingId === r.localId
          return (
            <div key={r.localId}>
              <div
                className="step-row"
                draggable
                onDragStart={() => setDragId(r.localId)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(r.localId)}
                style={{
                  cursor: 'grab',
                  opacity: dragId === r.localId ? 0.5 : 1,
                  alignItems: 'center',
                }}
              >
                <span className="step-ico" aria-hidden>
                  ⠿
                </span>
                <span className="step-titles">
                  <span className="step-title">
                    {r.stage.label}
                    {isCurrent && (
                      <span className="step-state-pill" style={{ marginLeft: 'var(--space-2)' }}>
                        current
                      </span>
                    )}
                  </span>
                  <span className="step-subtitle">{r.stage.action?.kind ?? 'step'}</span>
                </span>
                {configurable && (
                  <button
                    type="button"
                    className="button"
                    style={{ padding: '0.25rem 0.6rem' }}
                    onClick={() => setEditingId(isEditing ? null : r.localId)}
                  >
                    {isEditing ? 'Done' : 'Edit'}
                  </button>
                )}
                {!isCurrent && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${r.stage.label}`}
                    onClick={() => removeRow(r.localId)}
                  >
                    <XIcon size={16} />
                  </button>
                )}
              </div>
              {isEditing && configurable && (
                <StepConfigEditor
                  stage={r.stage}
                  onChange={(next) => updateStage(r.localId, next)}
                />
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}>
        {!adding ? (
          <button type="button" className="button" onClick={() => setAdding(true)}>
            <PlusIcon size={16} /> Add a step
          </button>
        ) : (
          <div className="card" style={{ padding: 'var(--space-4)' }}>
            <h3 className="text-sm" style={{ marginTop: 0 }}>
              From the catalog
            </h3>
            <div className="step-list">
              {catalog.map((a) => (
                <button
                  key={a.kind}
                  type="button"
                  className="step-row"
                  onClick={() => addCatalogStep(a)}
                >
                  <span className="step-titles">
                    <span className="step-title">{a.label}</span>
                    <span className="step-subtitle">{a.description}</span>
                  </span>
                </button>
              ))}
            </div>
            {library.length > 0 && (
              <>
                <h3 className="text-sm">From your step library</h3>
                <div className="step-list">
                  {library.map((t) => (
                    <button
                      key={t.workflowStepTemplateId}
                      type="button"
                      className="step-row"
                      onClick={() => addLibraryStep(t)}
                    >
                      <span className="step-titles">
                        <span className="step-title">{t.name}</span>
                        <span className="step-subtitle">{t.description ?? t.stage.label}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <button
              type="button"
              className="button"
              style={{ marginTop: 'var(--space-3)' }}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {!keepsCurrent && (
        <p className="text-sm" style={{ color: 'var(--danger)', marginTop: 'var(--space-3)' }}>
          The current step must stay in the workflow.
        </p>
      )}
    </Modal>
  )
}

// Which step kinds carry config editable in place (NEW-G). A capability step carries
// its standing instructions (rubric / materials message) under
// action.config.capability_config; a generate step carries its document kind(s).
function stepHasConfig(stage: WfStage): boolean {
  const kind = stage.action?.kind
  return kind === 'invoke_capability' || kind === 'generate_document'
}

// ── In-place step config editor (NEW-G) ──────────────────────────────────────
// Edits config ON the step and merges it back into the stage, so Save round-trips it
// (the pure builder preserves action.config + documents verbatim).
function StepConfigEditor({
  stage,
  onChange,
}: {
  stage: WfStage
  onChange: (next: WfStage) => void
}) {
  const kind = stage.action?.kind
  return (
    <div className="card" style={{ padding: 'var(--space-4)', margin: 'var(--space-2) 0' }}>
      {kind === 'invoke_capability' ? (
        <CapabilityConfigFields stage={stage} onChange={onChange} />
      ) : kind === 'generate_document' ? (
        <DocumentFields stage={stage} onChange={onChange} />
      ) : null}
    </div>
  )
}

// The attorney's standing instructions for a capability step (e.g. the AI-review
// rubric, or the message a "request materials" step sends). We edit the STRING values
// under capability_config in place; non-string values are shown read-only so a
// structured config is never silently flattened.
function CapabilityConfigFields({
  stage,
  onChange,
}: {
  stage: WfStage
  onChange: (next: WfStage) => void
}) {
  const action = stage.action ?? { kind: 'invoke_capability' as WfStepActionKind }
  const config = (action.config ?? {}) as Record<string, unknown>
  const slug = typeof config.capability_slug === 'string' ? config.capability_slug : ''
  const capConfig = (config.capability_config ?? {}) as Record<string, unknown>
  const keys = Object.keys(capConfig)

  function setKey(key: string, value: string) {
    onChange({
      ...stage,
      action: {
        ...action,
        config: { ...config, capability_config: { ...capConfig, [key]: value } },
      },
    })
  }

  return (
    <>
      <h3 className="text-sm" style={{ marginTop: 0 }}>
        Capability configuration
        {slug && (
          <span className="step-subtitle" style={{ marginLeft: 'var(--space-2)' }}>
            {slug}
          </span>
        )}
      </h3>
      {keys.length === 0 && (
        <p className="text-muted text-sm">This capability has no editable instructions.</p>
      )}
      {keys.map((key) => {
        const value = capConfig[key]
        if (typeof value !== 'string') {
          return (
            <label key={key} style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
              <span className="text-sm">{humanizeKey(key)}</span>
              <pre className="text-sm text-muted" style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(value)}
              </pre>
            </label>
          )
        }
        return (
          <label key={key} style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
            <span className="text-sm">{humanizeKey(key)}</span>
            <textarea
              value={value}
              rows={3}
              onChange={(e) => setKey(key, e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
        )
      })}
    </>
  )
}

// A generate step's document kind(s) — the on-stage config that links the step to its
// drafting prompt. The prompt TEXT (drafting instructions) is service-level, keyed by
// document kind, and edited on the service's Workflow/Prompt editor — not per-matter.
function DocumentFields({
  stage,
  onChange,
}: {
  stage: WfStage
  onChange: (next: WfStage) => void
}) {
  const documents = stage.documents ?? []
  function set(i: number, patch: Partial<(typeof documents)[number]>) {
    onChange({
      ...stage,
      documents: documents.map((d, idx) => (idx === i ? { ...d, ...patch } : d)),
    })
  }
  return (
    <>
      <h3 className="text-sm" style={{ marginTop: 0 }}>
        Documents this step drafts
      </h3>
      {documents.length === 0 && (
        <p className="text-muted text-sm">No documents configured on this step.</p>
      )}
      {documents.map((d, i) => (
        <div
          key={i}
          style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
        >
          <input
            value={d.docKind ?? ''}
            onChange={(e) => set(i, { docKind: e.target.value })}
            placeholder="Document kind (e.g. last_will_and_testament)"
            style={{ flex: 1 }}
          />
          <input
            value={d.label ?? ''}
            onChange={(e) => set(i, { label: e.target.value })}
            placeholder="Label"
            style={{ flex: 1 }}
          />
        </div>
      ))}
      <p className="text-muted text-sm">
        Drafting instructions for each document are set on the service’s workflow editor.
      </p>
    </>
  )
}

function humanizeKey(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
