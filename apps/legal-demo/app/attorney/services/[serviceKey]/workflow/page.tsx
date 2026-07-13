'use client'

// Service editor › WORKFLOW tab (ADR 0045 PR4b). A make.com-style builder that
// lets an attorney compose a service's lifecycle visually and save it through
// legal.service.lifecycle.set. The builder is LINEAR for now — an ordered column
// of step cards, each wired to the next — but it edits and saves the full edge
// model (to/gate/via/on), so a later branching UI is an addition, not a rewrite.
//
// BUILDER-UX-2 WP-2: the step-list UI is the SHARED WorkflowBuilder
// (components/WorkflowBuilder.tsx) — the same builder the wizard's
// WorkflowEditorModal mounts — extracted from this page so both surfaces edit a
// lifecycle through ONE builder. This page keeps the data loading, the save, and
// the step-library create (its "Save to library" chrome is page-only). The old
// "Edit in window" modal (a View/Edit toggle over a raw JSON textarea) is GONE —
// the real builder is already on the page.
//
// CONSTRAINT: no server-package imports. The lifecycle/catalog shapes are
// structural mirrors; the CLOSED catalog of actions + gates is read at runtime
// from legal.workflow.catalog. The page chrome (title, tabs) comes from the
// [serviceKey] layout, so this renders panel content only.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import {
  WorkflowBuilder,
  stepToStage,
  type WorkflowCatalog,
  type WorkflowStepTemplate,
} from '@/components/WorkflowBuilder'
// The pure builder data-model (wire shapes + graph round-trip) — React-free so the
// lossless round-trip is unit-testable. Moved to lib/ so the shared builder and this
// page import the same module.
import {
  type WfGate,
  type WfActionKind,
  type WfDocumentRef,
  type WfLifecycle,
  type BuilderStep,
  nextUid,
  graphToSteps,
  stepsToGraph,
} from '@/lib/workflowBuilderModel'

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
      setDisplayName(svc.service?.displayName ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSteps([])
    }
  }, [serviceKey])

  // "Build with AI": open the assistant with a primed prompt so the attorney can
  // author this service's workflow conversationally (the chatbot proposes a graph;
  // the attorney approves it on the existing AI authoring path).
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

  // Save one builder step to the firm library, then refresh the picker so it's
  // immediately reusable. The stored stage carries NO edges (the handler rejects
  // advances_to), so it can be dropped into any workflow without a half-edge.
  async function saveStepToLibrary(step: BuilderStep, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
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
          service's workflow. */}
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

      {steps.length === 0 && (
        <div style={{ margin: '0 0 0.7rem' }}>
          <button type="button" className="outline" onClick={startFromSmllc}>
            Start from the SMLLC template
          </button>
        </div>
      )}

      <WorkflowBuilder
        steps={steps}
        onChange={mutate}
        catalog={catalog}
        library={library}
        serviceKey={serviceKey}
        onSaveToLibrary={(step, name) => void saveStepToLibrary(step, name)}
      />

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
