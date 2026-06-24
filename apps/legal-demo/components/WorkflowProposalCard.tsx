'use client'

import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { readDevSession } from '@/lib/auth'
import { FileTextIcon, CheckIcon, LayersIcon } from '@/components/icons'

// CONSTRAINT (mirrors the workflow builder page): no server-package imports. These
// shapes are a structural mirror of verticals/legal/src/lifecycle/types.ts — the
// chat receives them over SSE as plain JSON.
type WfGate = 'automatic' | 'attorney' | 'client' | 'system'
interface WfEdge {
  to: string
  gate: WfGate
  via?: string
  on?: string
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
  action?: { kind: string; config?: Record<string, unknown> }
  documents?: WfDocumentRef[]
  advances_to: WfEdge[]
}
type WfLifecycle = WfStage[]

export interface WorkflowProposal {
  serviceKey: string
  graph: WfLifecycle
  summary: string
  confidence: number
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// Walk a linear graph from its entry stage so display order == run order even if the
// stored array order drifted (same approach as the builder's graphToSteps).
function orderStages(graph: WfLifecycle): WfStage[] {
  if (!graph.length) return []
  const byKey = new Map(graph.map((s) => [s.key, s]))
  const entry = graph.find((s) => s.entry) ?? graph[0]
  const ordered: WfStage[] = []
  const seen = new Set<string>()
  let cursor: string | undefined = entry?.key
  while (cursor && !seen.has(cursor)) {
    const stage = byKey.get(cursor)
    if (!stage) break
    seen.add(cursor)
    ordered.push(stage)
    cursor = stage.advances_to[0]?.to
  }
  for (const s of graph) if (!seen.has(s.key)) ordered.push(s)
  return ordered
}

// A simple diff of the proposed graph vs the current one: which step labels are
// added, removed, or reordered. Keyed by label (the attorney-facing name) since the
// proposal may slug fresh keys — labels are what the attorney recognises.
interface GraphDiff {
  added: string[]
  removed: string[]
  reordered: boolean
}
function diffGraphs(current: WfLifecycle | null, proposed: WfLifecycle): GraphDiff {
  const proposedLabels = orderStages(proposed).map((s) => s.label)
  if (!current) return { added: proposedLabels, removed: [], reordered: false }
  const currentLabels = orderStages(current).map((s) => s.label)
  const curSet = new Set(currentLabels)
  const propSet = new Set(proposedLabels)
  const added = proposedLabels.filter((l) => !curSet.has(l))
  const removed = currentLabels.filter((l) => !propSet.has(l))
  // Reordered = the steps in common appear in a different relative order.
  const commonCur = currentLabels.filter((l) => propSet.has(l))
  const commonProp = proposedLabels.filter((l) => curSet.has(l))
  const reordered =
    added.length === 0 && removed.length === 0 && commonCur.join('|') !== commonProp.join('|')
  return { added, removed, reordered }
}

// The inline approval card for an AI-proposed service workflow (PR5). It is the
// HUMAN GATE: the proposing chat turn wrote nothing; clicking Approve POSTs the
// proposed graph to the approve route, which is the only place a live version write
// happens. Each stage also offers "Save to step library" (legal.workflow_step_template
// .create) so a useful step becomes reusable. Visual style mirrors DocumentCard.
export function WorkflowProposalCard({ proposal }: { proposal: WorkflowProposal }) {
  const [current, setCurrent] = useState<WfLifecycle | null>(null)
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  const [approveError, setApproveError] = useState<string | null>(null)
  const [version, setVersion] = useState<number | null>(null)

  const ordered = orderStages(proposal.graph)

  // Load the service's CURRENT lifecycle so the card can show the diff (added/
  // removed/reordered). Best-effort — if it fails, the card still shows the proposal.
  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ lifecycle: { graph: WfLifecycle; version: number } | null }>({
      toolName: 'legal.service.lifecycle.get',
      input: { serviceKey: proposal.serviceKey },
    })
      .then((r) => {
        if (!cancelled) setCurrent(r.lifecycle?.graph ?? null)
      })
      .catch(() => {
        /* show the proposal without a diff */
      })
    return () => {
      cancelled = true
    }
  }, [proposal.serviceKey])

  const diff = diffGraphs(current, proposal.graph)

  async function approve() {
    setApproveState('approving')
    setApproveError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (IS_DEV) {
        const dev = readDevSession()
        if (dev) {
          headers['x-actor-id'] = dev.actorId
          headers['x-tenant-id'] = dev.tenantId
        }
      }
      const res = await fetch(
        `/api/attorney/services/${encodeURIComponent(proposal.serviceKey)}/lifecycle/approve`,
        {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({
            graph: proposal.graph,
            summary: proposal.summary,
            confidence: proposal.confidence,
          }),
        },
      )
      const data = (await res.json().catch(() => null)) as {
        result?: { version?: number }
        error?: string
      } | null
      if (!res.ok) throw new Error(data?.error || `Approve failed (${res.status})`)
      setVersion(data?.result?.version ?? null)
      setApproveState('approved')
    } catch (e) {
      setApproveState('error')
      setApproveError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="uac-doc-card">
      <div className="uac-doc-head">
        <span className="uac-doc-title">
          <LayersIcon size={14} /> Proposed workflow — {proposal.serviceKey}
        </span>
        <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
          {ordered.length} steps
        </span>
      </div>

      {proposal.summary && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-sm)' }}>
          {proposal.summary}
        </div>
      )}

      {/* Diff vs the current workflow. */}
      {(diff.added.length > 0 || diff.removed.length > 0 || diff.reordered) && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
          {diff.added.length > 0 && (
            <div>
              <strong>Added:</strong> {diff.added.join(', ')}
            </div>
          )}
          {diff.removed.length > 0 && (
            <div>
              <strong>Removed:</strong> {diff.removed.join(', ')}
            </div>
          )}
          {diff.reordered && <div>Steps were reordered.</div>}
        </div>
      )}

      {/* The proposed steps, in run order, each with a Save-to-library affordance. */}
      <ol className="uac-doc-body" style={{ paddingLeft: 18, margin: 0 }}>
        {ordered.map((s) => (
          <li key={s.key} style={{ marginBottom: 6 }}>
            <span>
              <strong>{s.label}</strong>
              {s.action ? ` · ${s.action.kind}` : ''}
              {!s.terminal && s.advances_to[0] ? ` · ${s.advances_to[0].gate}` : ''}
              {s.terminal ? ' · terminal' : ''}
            </span>
            {s.documents && s.documents.length > 0 && (
              <span className="text-muted">
                {' '}
                — docs:{' '}
                {s.documents.map((d) => d.label || d.docKind || d.templateEntityId).join(', ')}
              </span>
            )}{' '}
            <SaveStepButton stage={s} />
          </li>
        ))}
      </ol>

      <div className="uac-doc-actions">
        <button
          type="button"
          className={`uac-reply-btn${approveState === 'approved' ? ' copied' : ''}`}
          onClick={approve}
          disabled={approveState === 'approving' || approveState === 'approved'}
          title="Approve this workflow — this is the live write to the service"
        >
          {approveState === 'approved' ? <CheckIcon size={12} /> : <LayersIcon size={12} />}{' '}
          {approveState === 'approving'
            ? 'Approving…'
            : approveState === 'approved'
              ? version != null
                ? `Approved (v${version})`
                : 'Approved'
              : 'Approve & save workflow'}
        </button>
      </div>
      {approveError && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 6 }}>
          {approveError}
        </div>
      )}
    </div>
  )
}

// Per-stage "Save to step library" — captures one proposed stage as a reusable
// workflow_step_template (legal.workflow_step_template.create). The saved STAGE is a
// LifecycleStage WITHOUT edges/key/entry/terminal: { label, client_label?, action,
// gate, documents?, blocking? } — the same shape the builder saves, so the wired
// edge is assigned on insertion, never persisted on the template.
function SaveStepButton({ stage }: { stage: WfStage }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  async function save() {
    setState('saving')
    try {
      await callAttorneyMcp({
        toolName: 'legal.workflow_step_template.create',
        input: {
          name: stage.label,
          stage: {
            label: stage.label,
            client_label: stage.client_label,
            blocking: stage.blocking,
            action: stage.action ?? { kind: 'manual_task' },
            // The default gate for the saved step's future outgoing edge: the gate of
            // this stage's own outgoing edge, or 'attorney' for a terminal step.
            gate: stage.advances_to[0]?.gate ?? 'attorney',
            documents: stage.documents,
          },
        },
      })
      setState('saved')
    } catch {
      setState('error')
    }
  }
  return (
    <button
      type="button"
      className="uac-reply-btn"
      onClick={save}
      disabled={state === 'saving' || state === 'saved'}
      title="Save this step to the firm's reusable step library"
      style={{ fontSize: 11 }}
    >
      {state === 'saved' ? <CheckIcon size={11} /> : <FileTextIcon size={11} />}{' '}
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save step'}
    </button>
  )
}
