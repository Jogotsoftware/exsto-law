'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { LayersIcon, CheckIcon } from '@/components/icons'

// CONSTRAINT (mirrors WorkflowProposalCard): no server-package imports. This shape
// is a structural mirror of verticals/legal/src/api/serviceAuthoring.ts's
// ServiceProposal — the chat receives it over SSE as plain JSON.
export interface ServiceProposal {
  displayName: string
  derivedKey: string
  description: string | null
  route: 'auto' | 'manual'
  generationMode: 'template_merge' | 'ai_draft'
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
}: {
  proposal: ServiceProposal
  onApproved?: OnApproved
}) {
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
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
          displayName: proposal.displayName,
          description: proposal.description,
          route: proposal.route,
          generationMode: proposal.generationMode,
          summary: proposal.summary,
          confidence: proposal.confidence,
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
          label: data.label || `Service "${proposal.displayName}"`,
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
          <LayersIcon size={14} /> Proposed service — {proposal.displayName}
        </span>
        <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
          key: {proposal.derivedKey}
        </span>
      </div>

      {/* The CLIENT-FACING description leads — it's what the attorney is actually
          approving onto their booking page. The AI's WHY (summary) is a muted
          footnote, not the headline: reasoning is context, not content. */}
      {proposal.description && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-sm)' }}>
          {proposal.description}
        </div>
      )}

      <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
        <div>
          <strong>Route:</strong> {proposal.route} · <strong>Documents:</strong>{' '}
          {proposal.generationMode === 'ai_draft' ? 'AI draft' : 'template merge'}
        </div>
        {proposal.summary && (
          <div className="text-muted" style={{ marginTop: 4 }}>
            {proposal.summary}
          </div>
        )}
        {/* Set expectations: a created service starts disabled until it's completed. */}
        <div className="text-muted">Created disabled — finish setting it up, then enable it.</div>
      </div>

      <div className="uac-doc-actions">
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
    </div>
  )
}
