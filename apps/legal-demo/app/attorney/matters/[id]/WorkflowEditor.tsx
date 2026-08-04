'use client'

// Per-matter workflow editor (ADR 0045 PR6) — the "Edit steps for this matter" mode
// on the matter Workflow window. MODAL-STD-1 (Gap B): this modal is now a THIN
// wrapper around the ONE shared WorkflowBuilder (the same step editor the service
// Workflow tab and the wizard pop-up mount) — it no longer carries its own step
// list, palette, or config editors, and the graph round-trip goes through the one
// shared model (graphToSteps/stepsToGraph in lib/workflowBuilderModel), which is
// strictly lossless (unknown stage/edge properties, e.g. `when`, carry opaquely).
//
// What stays host chrome here: the per-matter save target (states_override via
// /api/attorney/matters/[id]/workflow → legal.matter.set_workflow — the service's
// default lifecycle is NEVER touched), the "current step must stay" guard
// (lockedStepKeys), and the WF-FIX-1 repin affordance. Drafting-instruction
// editing is service-level config, so serviceKey is deliberately not passed —
// the shared builder hides that block.
import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/Modal'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import {
  WorkflowBuilder,
  type WorkflowCatalog,
  type WorkflowStepTemplate,
} from '@/components/WorkflowBuilder'
import { graphToSteps, stepsToGraph, type BuilderStep } from '@/lib/workflowBuilderModel'
import type { MatterWorkflow } from './shared'

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
  const [steps, setSteps] = useState<BuilderStep[]>(() => graphToSteps(workflow.graph))
  const [catalog, setCatalog] = useState<WorkflowCatalog | null>(null)
  const [library, setLibrary] = useState<WorkflowStepTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // WF-FIX-1 (WP4) — repin affordance state.
  const [repinning, setRepinning] = useState(false)
  const [repinError, setRepinError] = useState<string | null>(null)

  // Load the palette (catalog) + the reusable step library once.
  useEffect(() => {
    void (async () => {
      try {
        const cat = await callAttorneyMcp<WorkflowCatalog>({
          toolName: 'legal.workflow.catalog',
          input: {},
        })
        setCatalog(cat)
      } catch {
        /* palette is best-effort; the add menu just shows fewer options */
      }
      try {
        const lib = await callAttorneyMcp<{ steps: WorkflowStepTemplate[] }>({
          toolName: 'legal.workflow_step_template.list',
          input: {},
        })
        setLibrary(lib.steps ?? [])
      } catch {
        /* library is optional */
      }
    })()
  }, [])

  // The current step must remain in the graph (the handler rejects an orphaning
  // graph; we surface it early so Save is never a surprise). The shared builder
  // also hides that step's remove button via lockedStepKeys.
  const currentState = workflow.currentState
  const keepsCurrent = useMemo(
    () => steps.some((s) => s.key === currentState),
    [steps, currentState],
  )

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const graph = stepsToGraph(steps)
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
      size="wide"
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
        affected. The current step can’t be removed.
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

      <WorkflowBuilder
        steps={steps}
        onChange={setSteps}
        catalog={catalog}
        library={library}
        lockedStepKeys={[currentState]}
      />

      {!keepsCurrent && (
        <p className="text-sm" style={{ color: 'var(--danger)', marginTop: 'var(--space-3)' }}>
          The current step must stay in the workflow.
        </p>
      )}
    </Modal>
  )
}
