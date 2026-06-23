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

  // Rebuild the linear graph on save: array order is workflow order; each
  // non-terminal stage gets exactly one outgoing edge (its catalog default gate) to
  // the next stage; the LAST stage is terminal with no edges. `complete_matter`
  // stays terminal wherever it lands.
  function buildGraph(): WfStage[] {
    const gateFor = (kind: WfStepActionKind | undefined): WfGate =>
      catalog.find((c) => c.kind === kind)?.defaultGate ?? 'attorney'
    return rows.map((r, i) => {
      const isLast = i === rows.length - 1
      const next = rows[i + 1]
      // Preserve an explicit entry on the first stage; drop stale terminal flags so
      // only the genuine last stage is terminal.
      const base: WfStage = { ...r.stage, advances_to: [], terminal: false }
      if (i === 0) base.entry = true
      else delete base.entry
      if (isLast) {
        base.terminal = true
      } else {
        base.advances_to = [
          { to: next.stage.key, gate: gateFor(r.stage.action?.kind), via: 'legal.matter.advance' },
        ]
      }
      return base
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/attorney/matters/${matterEntityId}/workflow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ states: buildGraph() }),
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

      <div className="step-list">
        {rows.map((r) => {
          const isCurrent = r.stage.key === currentState
          return (
            <div
              key={r.localId}
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
