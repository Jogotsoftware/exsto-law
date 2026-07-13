'use client'

// BUILDER-UX-2 WP-2 — the workflow editor pop-up: the REAL step builder (shared
// WorkflowBuilder — the same one the service Workflow tab renders), opened DIRECTLY in
// edit mode and seeded from an in-memory proposal graph or the persisted lifecycle. No
// View/Edit toggle, no JSON textarea. Save/Cancel at the top; "Edit with AI" via the
// shared rail. The catalog + step library load on open (same reads the page does);
// per-step "Save to library" is standalone-only chrome and is NOT offered here.
import { useEffect, useState } from 'react'
import { Modal } from '@/components/Modal'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { AiRegenerateRail } from '@/components/AiRegenerateRail'
import { WorkflowView } from '@/components/configEditors'
import {
  WorkflowBuilder,
  type WorkflowCatalog,
  type WorkflowStepTemplate,
} from '@/components/WorkflowBuilder'
import {
  type WfLifecycle,
  type BuilderStep,
  graphToSteps,
  stepsToGraph,
} from '@/lib/workflowBuilderModel'

export function WorkflowEditorModal({
  title,
  serviceKey,
  initialGraph,
  regenerateTargetId,
  onSave,
  onClose,
}: {
  title: string
  serviceKey: string
  initialGraph: WfLifecycle
  // Correlation id for the AI rail ("proposal:<key>" for wizard proposals, the
  // serviceKey for persisted lifecycles). The worker revises the passed content.
  regenerateTargetId?: string
  // Receives the assembled graph (stepsToGraph output — the storage form).
  onSave: (graph: WfLifecycle) => Promise<void> | void
  onClose: () => void
}): React.ReactElement {
  const [steps, setSteps] = useState<BuilderStep[]>(() => graphToSteps(initialGraph))
  const [catalog, setCatalog] = useState<WorkflowCatalog | null>(null)
  const [library, setLibrary] = useState<WorkflowStepTemplate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSave = steps.length > 0 && steps.every((s) => s.label.trim())

  // The closed catalog of actions + gates (and the reusable step library) — the same
  // runtime reads the standalone Workflow tab does. Tolerant: a library failure never
  // blanks the builder.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      callAttorneyMcp<WorkflowCatalog>({ toolName: 'legal.workflow.catalog' }),
      callAttorneyMcp<{ steps: WorkflowStepTemplate[] }>({
        toolName: 'legal.workflow_step_template.list',
      }).catch(() => ({ steps: [] as WorkflowStepTemplate[] })),
    ])
      .then(([cat, lib]) => {
        if (cancelled) return
        setCatalog(cat)
        setLibrary(lib.steps ?? [])
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    if (!canSave) {
      setError(
        steps.length === 0 ? 'Add at least one step before saving.' : 'Every step needs a label.',
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(stepsToGraph(steps))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} size="wide">
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        <button type="button" className="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={save}
          disabled={busy || !canSave}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && (
        <div role="alert" className="alert alert-error" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}
      <AiRegenerateRail
        artifactKind="workflow"
        targetId={regenerateTargetId ?? serviceKey}
        current={() => JSON.stringify(stepsToGraph(steps), null, 2)}
        renderProposal={(proposed) => <WorkflowView content={proposed} />}
        onUse={(proposed) => {
          const graph = JSON.parse(proposed) as WfLifecycle
          if (!Array.isArray(graph)) throw new Error('The AI proposal is not a workflow graph.')
          setSteps(graphToSteps(graph))
        }}
      />
      <WorkflowBuilder
        steps={steps}
        onChange={setSteps}
        catalog={catalog}
        library={library}
        serviceKey={serviceKey}
      />
    </Modal>
  )
}
