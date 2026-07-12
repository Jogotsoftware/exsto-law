'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { ConfigEditModal } from '@/components/ConfigEditModal'
import { jsonEditor } from '@/components/configEditors'
import { LayersIcon, CheckIcon, EditIcon } from '@/components/icons'

// CONSTRAINT (mirrors WorkflowProposalCard): no server-package imports. This shape
// is a structural mirror of verticals/legal/src/api/serviceAuthoring.ts's
// ServiceProposal — the chat receives it over SSE as plain JSON.
export interface ServiceProposal {
  displayName: string
  derivedKey: string
  description: string | null
  // Client-facing tile copy (UI-BUILDER-FIX-1 Phase 2): outcome-only, <=70 chars.
  clientDisplayName?: string | null
  clientDescription?: string | null
  route: 'auto' | 'manual'
  generationMode: 'template_merge' | 'ai_draft'
  // BUILDER-CERT-1 (WP3) — booking mode: true = booking opens with a consultation
  // slot; false = intake-only (document-review). Forwarded on approve.
  appointmentRequired?: boolean
  summary: string
  confidence: number
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// Fired on a SUCCESSFUL approve so the chat can continue the guided build (Phase 6):
// it carries the artifact label + the link to it + the serviceKey so the chat can show
// "View … →" AND auto-send a continuation turn. Shared by every proposal card.
export type OnApproved = (info: {
  artifact: string
  link: string
  serviceKey: string
  label: string
}) => void

// The inline approval card for an AI-proposed NEW service (Build-Wizard Phase 1). It
// is the HUMAN GATE: the proposing chat turn wrote nothing; clicking Approve POSTs
// the proposal to the create-from-ai route, which is the only place the version-1
// (disabled) service is created. Visual style mirrors WorkflowProposalCard.
export function ServiceProposalCard({
  proposal,
  onApproved,
  onEdited,
}: {
  proposal: ServiceProposal
  onApproved?: OnApproved
  // WP-H: fired after the attorney edits the proposal in the pop-up editor.
  onEdited?: (note: string) => void
}) {
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  // WP-H: the card's CURRENT shell — the proposal until the attorney edits it;
  // Approve always captures this (the attorney's version).
  const [current, setCurrent] = useState<ServiceProposal>(proposal)
  const [editing, setEditing] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [serviceKey, setServiceKey] = useState<string | null>(null)
  // The link to the created service, returned by the approve route — shown as
  // "View service →" and handed to onApproved for the auto-continuation.
  const [link, setLink] = useState<string | null>(null)

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
      const res = await fetch('/api/attorney/services/create-from-ai', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({
          displayName: current.displayName,
          description: current.description,
          clientDisplayName: current.clientDisplayName ?? null,
          clientDescription: current.clientDescription ?? null,
          route: current.route,
          generationMode: current.generationMode,
          ...(typeof current.appointmentRequired === 'boolean'
            ? { appointmentRequired: current.appointmentRequired }
            : {}),
          summary: current.summary,
          confidence: current.confidence,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        result?: { serviceKey?: string }
        serviceKey?: string
        link?: string
        label?: string
        error?: string
      } | null
      if (!res.ok) throw new Error(data?.error || `Approve failed (${res.status})`)
      const key = data?.serviceKey ?? data?.result?.serviceKey ?? null
      setServiceKey(key)
      setLink(data?.link ?? null)
      setApproveState('approved')
      // Drive the build forward: tell the chat the service is created (with its link)
      // so it auto-continues to the next step. Fires once (approve is disabled after).
      if (key && data?.link) {
        onApproved?.({
          artifact: 'service',
          link: data.link,
          serviceKey: key,
          label: data.label || `Service "${current.displayName}"`,
        })
      }
    } catch (e) {
      setApproveState('error')
      setApproveError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="uac-doc-card">
      <div className="uac-doc-head">
        <span className="uac-doc-title">
          <LayersIcon size={14} /> Proposed service — {current.displayName}
        </span>
        <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
          key: {current.derivedKey}
        </span>
      </div>

      {/* BUILDER-UX-1 WP-1.2: the two copies are LABELED, never two unlabeled
          paragraphs — "Client sees" (the public booking tile) above "Internal"
          (the attorney-facing description). */}
      {(current.clientDisplayName || current.clientDescription) && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-sm)' }}>
          <div className="text-muted" style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>
            Client sees
          </div>
          <div>
            {current.clientDisplayName}
            {current.clientDescription ? ` — ${current.clientDescription}` : ''}
          </div>
        </div>
      )}
      {current.description && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-sm)' }}>
          <div className="text-muted" style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>
            Internal
          </div>
          <div>{current.description}</div>
        </div>
      )}

      <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
        <div>
          <strong>Route:</strong> {current.route} · <strong>Documents:</strong>{' '}
          {current.generationMode === 'ai_draft' ? 'AI draft' : 'template merge'}
        </div>
        {/* Set expectations: a created service starts disabled until it's completed. */}
        <div className="text-muted">Created disabled — finish setting it up, then enable it.</div>
      </div>

      <div className="uac-doc-actions">
        <button
          type="button"
          className="uac-reply-btn"
          onClick={() => setEditing(true)}
          disabled={approveState === 'approving' || approveState === 'approved'}
          title="Edit the proposed service shell before approving"
        >
          <EditIcon size={12} /> Edit
        </button>
        <button
          type="button"
          className={`uac-reply-btn uac-reply-btn-primary${approveState === 'approved' ? ' copied' : ''}`}
          onClick={approve}
          disabled={approveState === 'approving' || approveState === 'approved'}
          title="Approve this service — this creates the (disabled) service"
        >
          {approveState === 'approved' ? <CheckIcon size={12} /> : <LayersIcon size={12} />}{' '}
          {approveState === 'approving'
            ? 'Creating…'
            : approveState === 'approved'
              ? serviceKey
                ? `Created (${serviceKey})`
                : 'Created'
              : 'Approve & create service'}
        </button>
        {link && (
          <a className="uac-reply-btn" href={link} target="_blank" rel="noopener noreferrer">
            View service →
          </a>
        )}
      </div>
      {approveError && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
          {approveError}
        </div>
      )}
      {editing && (
        <ConfigEditModal
          artifactKind="workflow"
          targetId={`proposal:${current.derivedKey}`}
          title={`Edit proposed service — ${current.displayName}`}
          initialContent={JSON.stringify(
            {
              displayName: current.displayName,
              description: current.description,
              clientDisplayName: current.clientDisplayName ?? null,
              clientDescription: current.clientDescription ?? null,
              route: current.route,
              generationMode: current.generationMode,
              appointmentRequired: current.appointmentRequired,
            },
            null,
            2,
          )}
          renderView={(content) => <pre style={{ whiteSpace: 'pre-wrap' }}>{content}</pre>}
          renderEdit={jsonEditor}
          aiRegenerate={false}
          saveLabel="Save"
          onSave={async (content) => {
            const next = JSON.parse(content) as Partial<ServiceProposal>
            setCurrent((c) => ({ ...c, ...next }))
            onEdited?.(`service shell "${current.displayName}"`)
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
