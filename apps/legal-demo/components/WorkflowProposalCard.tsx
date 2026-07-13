'use client'

import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { readDevSession } from '@/lib/auth'
import { CheckIcon, LayersIcon, EditIcon } from '@/components/icons'
import type { OnApproved } from '@/components/ServiceProposalCard'
import { WorkflowEditorModal } from '@/components/WorkflowEditorModal'
import { WorkflowStepList } from '@/components/WorkflowStepList'
import type { WfLifecycle as LibWfLifecycle } from '@/lib/workflowBuilderModel'

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
  // UI-BUILDER-FIX-1 5c: on a REVISION, the chat attaches the graph of the
  // proposal this one supersedes, so the card diffs revision-vs-live-proposal
  // (unrelated steps must show as unchanged) instead of vs the saved service.
  previousGraph?: WfLifecycle
}

// 5c: the Revise affordance hands the attorney's edit instruction + the full
// live proposal back to the chat, which regenerates as a diff against it.
export type OnRevise = (info: { proposal: WorkflowProposal; instruction: string }) => boolean

const IS_DEV = process.env.NODE_ENV !== 'production'

// WP7 — attorney-facing labels, not internal slugs. Mirrors the closed step-action
// catalog (verticals/legal/src/lifecycle/catalog.ts) and gate set; the card is a
// no-server-import client component, so the human labels live here. An unknown kind
// falls back to a de-slugged title so nothing ever renders raw snake_case.
const ACTION_LABELS: Record<string, string> = {
  view_intake: 'Client intake',
  view_consultation: 'Client consultation',
  generate_document: 'Generate document',
  review_send_document: 'Review & send document',
  approve_send_invoice: 'Approve & send invoice',
  await_payment: 'Await payment',
  manual_task: 'Manual task',
  complete_matter: 'Complete matter',
}
// Plain-language gate: WHO moves the step forward, in the attorney's words.
const GATE_LABELS: Record<WfGate, string> = {
  attorney: 'waits for you',
  client: 'waits for the client',
  automatic: 'automatic',
  system: 'automatic (on payment/signature)',
}
function humanize(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
function actionLabel(kind: string | undefined): string {
  if (!kind) return ''
  return ACTION_LABELS[kind] ?? humanize(kind)
}
// ADR 0046 — an invoke_capability step shows the CAPABILITY's name (de-slugged from
// its config), never the raw "invoke_capability" kind or the slug.
function stageActionLabel(stage: WfStage): string {
  if (stage.action?.kind === 'invoke_capability') {
    const slug = (stage.action.config?.capability_slug as string | undefined) ?? ''
    return slug ? humanize(slug) : 'Run a platform capability'
  }
  return actionLabel(stage.action?.kind)
}
function gateLabel(gate: WfGate | undefined): string {
  if (!gate) return ''
  return GATE_LABELS[gate] ?? humanize(gate)
}

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

// A simple diff of the proposed graph vs the current one: which step labels were
// removed, and whether steps were reordered. Keyed by label (the attorney-facing
// name) since the proposal may slug fresh keys — labels are what the attorney
// recognises. Added steps are NOT surfaced (BUILDER-UX-3 P7): they are already
// visible in the step list below, so the "Added:" comma-run only duplicated it;
// removed steps are the one diff fact the list can't show.
interface GraphDiff {
  removed: string[]
  reordered: boolean
}
function diffGraphs(current: WfLifecycle | null, proposed: WfLifecycle): GraphDiff {
  if (!current) return { removed: [], reordered: false }
  const proposedLabels = orderStages(proposed).map((s) => s.label)
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
  return { removed, reordered }
}

// The inline approval card for an AI-proposed service workflow (PR5). It is the
// HUMAN GATE: the proposing chat turn wrote nothing; clicking Approve POSTs the
// proposed graph to the approve route, which is the only place a live version write
// happens. Visual: the SAME WorkflowStepList a live matter's Workflow window uses
// (UI-BUILDER-FIX-1 5b), so proposed steps look like the workflow they become.
// 5a: "Save step" is deliberately NOT offered here — a step is saved to the
// library from the service workflow builder page, not mid-approval.
// 5c: "Revise" beside Approve captures the attorney's edit instruction and hands
// it (with the full live proposal) back to the chat for a diff-regeneration.
export function WorkflowProposalCard({
  proposal,
  onApproved,
  onRevise,
  onEdited,
}: {
  proposal: WorkflowProposal
  onApproved?: OnApproved
  onRevise?: OnRevise
  // WP-H: fired after the attorney edits the proposal in the pop-up editor.
  onEdited?: (note: string) => void
}) {
  const [current, setCurrent] = useState<WfLifecycle | null>(null)
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  const [approveError, setApproveError] = useState<string | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [link, setLink] = useState<string | null>(null)
  // 5c Revise state: closed → input open → sent (the chat takes over from there).
  const [reviseOpen, setReviseOpen] = useState(false)
  const [reviseText, setReviseText] = useState('')
  const [reviseSent, setReviseSent] = useState(false)
  // WP-H: the attorney's hand-edited graph (null until they edit in the pop-up);
  // Approve captures this over the AI's proposal when set.
  const [editedGraph, setEditedGraph] = useState<WorkflowProposal['graph'] | null>(null)
  const [editing, setEditing] = useState(false)
  const [editSeedGraph, setEditSeedGraph] = useState<WfLifecycle | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const liveGraph = editedGraph ?? proposal.graph

  // Post-approval Edit seeds from the SAVED lifecycle, not the card's frozen
  // snapshot — an edit made meanwhile on the Workflow tab must show up here, not
  // get silently reverted by Save (lifecycle.set is a full-graph replace).
  async function openEditor() {
    if (approveState !== 'approved') {
      setEditSeedGraph(null)
      setEditing(true)
      return
    }
    setEditLoading(true)
    try {
      const r = await callAttorneyMcp<{
        lifecycle: { graph: WfLifecycle; version: number } | null
      }>({ toolName: 'legal.service.lifecycle.get', input: { serviceKey: proposal.serviceKey } })
      setEditSeedGraph(r.lifecycle?.graph ?? liveGraph)
    } catch {
      setEditSeedGraph(liveGraph) // read failure: the card's copy is the best seed we have
    } finally {
      setEditLoading(false)
    }
    setEditing(true)
  }

  const ordered = orderStages(liveGraph)

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

  // Diff base (5c): a revision diffs against the LIVE PROPOSAL it supersedes —
  // unrelated steps must read as unchanged. A first proposal diffs against the
  // service's saved lifecycle (the original behavior).
  const diff = diffGraphs(proposal.previousGraph ?? current, proposal.graph)

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
            graph: liveGraph,
            summary: proposal.summary,
            confidence: proposal.confidence,
          }),
        },
      )
      const data = (await res.json().catch(() => null)) as {
        result?: { version?: number }
        serviceKey?: string
        link?: string
        label?: string
        error?: string
      } | null
      if (!res.ok) throw new Error(data?.error || `Approve failed (${res.status})`)
      setVersion(data?.result?.version ?? null)
      setLink(data?.link ?? null)
      setApproveState('approved')
      // Continue the guided build to the next step (Phase 6).
      if (data?.link) {
        onApproved?.({
          artifact: 'workflow',
          link: data.link,
          serviceKey: data.serviceKey || proposal.serviceKey,
          label: data.label || 'Workflow',
        })
      }
    } catch (e) {
      setApproveState('error')
      const msg = e instanceof Error ? e.message : String(e)
      // BUILDER-UX-3 (P4): compose-time validation accepts a same-turn pending
      // cost, so this card can render alongside a not-yet-approved pricing card —
      // the write path stays strict. Approving out of order surfaces the
      // validator's billing rejection; say what to do instead of leaking it.
      setApproveError(
        /declares no billing/i.test(msg)
          ? 'Approve the pricing card first, then approve this workflow.'
          : msg,
      )
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

      {/* Diff vs the current workflow — removed/reordered only: removed steps
          don't render in the step list below, so they must be said here; added
          steps are the list itself (P7). */}
      {(diff.removed.length > 0 || diff.reordered) && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
          {diff.removed.length > 0 && (
            <div>
              <strong>Removed:</strong> {diff.removed.join(', ')}
            </div>
          )}
          {diff.reordered && <div>Steps were reordered.</div>}
        </div>
      )}

      {/* The proposed steps, in run order — the SAME visual a live matter's
          Workflow window renders (5b). No run-state pill: a proposal isn't
          running (no-simulate), so every row reads as a plain step. */}
      <WorkflowStepList
        showStatePill={false}
        items={ordered.map((s) => {
          const metaBits: string[] = []
          if (s.action && stageActionLabel(s) !== s.label) metaBits.push(stageActionLabel(s))
          if (!s.terminal && s.advances_to[0]) metaBits.push(gateLabel(s.advances_to[0].gate))
          if (s.terminal) metaBits.push('final step')
          if (s.documents && s.documents.length > 0) {
            metaBits.push(
              `docs: ${s.documents.map((d) => d.label || d.docKind || d.templateEntityId).join(', ')}`,
            )
          }
          return {
            key: s.key,
            title: s.label,
            subtitle: s.client_label && s.client_label !== s.label ? s.client_label : undefined,
            state: 'pending' as const,
            meta: metaBits.length ? metaBits.join(' · ') : undefined,
          }
        })}
      />

      <div className="uac-doc-actions">
        <button
          type="button"
          className="uac-reply-btn"
          onClick={() => void openEditor()}
          disabled={approveState === 'approving' || editLoading}
          title={
            approveState === 'approved'
              ? 'Edit the saved workflow — saves a new version'
              : 'Edit the proposed workflow before approving'
          }
        >
          <EditIcon size={12} /> {editLoading ? 'Loading…' : 'Edit'}
        </button>
        <button
          type="button"
          className={`uac-reply-btn uac-reply-btn-primary${approveState === 'approved' ? ' copied' : ''}`}
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
        {onRevise && approveState !== 'approved' && (
          <button
            type="button"
            className="uac-reply-btn"
            onClick={() => setReviseOpen((v) => !v)}
            disabled={approveState === 'approving' || reviseSent}
            title="Ask for a change to this proposal before approving"
          >
            <EditIcon size={12} /> {reviseSent ? 'Revising…' : 'Revise'}
          </button>
        )}
        {link && (
          <a className="uac-reply-btn" href={link} target="_blank" rel="noopener noreferrer">
            View workflow →
          </a>
        )}
      </div>

      {/* 5c: the revise instruction input. Submit hands the FULL live proposal +
          the instruction to the chat; the model regenerates as a diff and a new
          card (with this graph as its previousGraph) replaces the conversation's
          working proposal. */}
      {reviseOpen && !reviseSent && (
        <form
          style={{ display: 'flex', gap: 6, marginTop: 6 }}
          onSubmit={(e) => {
            e.preventDefault()
            const instruction = reviseText.trim()
            if (!instruction || !onRevise) return
            const accepted = onRevise({ proposal, instruction })
            if (accepted) {
              setReviseSent(true)
              setReviseOpen(false)
            }
          }}
        >
          <input
            type="text"
            className="uac-qcard-text"
            style={{ flex: 1, fontSize: 'var(--text-sm)' }}
            placeholder="What should change? (e.g. add an attorney review step before the invoice)"
            value={reviseText}
            onChange={(e) => setReviseText(e.target.value)}
            autoFocus
          />
          <button type="submit" className="uac-reply-btn" disabled={!reviseText.trim()}>
            Send
          </button>
        </form>
      )}
      {approveError && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 6 }}>
          {approveError}
        </div>
      )}
      {editing && (
        <WorkflowEditorModal
          title={
            approveState === 'approved'
              ? `Edit workflow — ${proposal.serviceKey}`
              : `Edit proposed workflow — ${proposal.serviceKey}`
          }
          serviceKey={proposal.serviceKey}
          // The card's wire shape is a WIDE structural mirror of the builder model
          // (SSE JSON: action.kind is string); the builder coerces unknown kinds on
          // load and the approve/lifecycle.set routes validate on write.
          initialGraph={(editSeedGraph ?? liveGraph ?? []) as unknown as LibWfLifecycle}
          // ALWAYS the real serviceKey: the service exists by the workflow phase of a
          // build (shell first), and the regenerate worker VALIDATES the revised graph
          // against this id (validateProposedLifecycle) — "proposal:<key>" made it
          // validate against a nonexistent service and spuriously reject.
          regenerateTargetId={proposal.serviceKey}
          onSave={async (graph) => {
            if (approveState === 'approved') {
              // Post-approval: the SAME edit persists to the saved lifecycle (a new
              // immutable version through legal.service.lifecycle.set — identical to
              // the Workflow tab's save), never a stale in-memory proposal.
              const r = await callAttorneyMcp<{ version: number }>({
                toolName: 'legal.service.lifecycle.set',
                input: { serviceKey: proposal.serviceKey, graph },
              })
              setVersion(r.version)
              setEditedGraph(graph)
              onEdited?.(`workflow for "${proposal.serviceKey}" (saved v${r.version})`)
              return
            }
            // Pre-approval: Save updates the CARD; the validated live write is Approve.
            setEditedGraph(graph)
            onEdited?.(`workflow for "${proposal.serviceKey}"`)
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}

// 5a: the per-stage "Save to step library" affordance was removed from THIS card
// (proposal review is for approving, not library curation). The capability
// survives on the service workflow builder page
// (app/attorney/services/[serviceKey]/workflow/page.tsx → legal.workflow_step_template.create).
