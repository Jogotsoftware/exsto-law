'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { LayersIcon, CheckIcon } from '@/components/icons'
import type { OnApproved } from '@/components/ServiceProposalCard'

// CONSTRAINT (mirrors ServiceProposalCard): no server-package imports. This shape is a
// structural mirror of the CostProposal captured in
// verticals/legal/src/api/costAuthoring.ts — the chat receives it over SSE as plain JSON.
export interface CostProposal {
  serviceKey: string
  costType: 'hourly' | 'fixed'
  amount: string
  hours: number | null
  summary: string
  confidence: number
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// The inline approval card for an AI-proposed BILLING/fee model (Build-Wizard Phase 6).
// It is the HUMAN GATE: the proposing chat turn wrote nothing; clicking Approve POSTs
// the price to the cost approve-from-ai route, the only place the cost is written.
// Visual style mirrors ServiceProposalCard.
export function CostProposalCard({
  proposal,
  onApproved,
}: {
  proposal: CostProposal
  onApproved?: OnApproved
}) {
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  const [approveError, setApproveError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)

  // Human-readable price line, e.g. "$350.00 / hour (est. 6 hrs)" or "$1,500.00 flat".
  const priceLabel =
    proposal.costType === 'hourly'
      ? `$${proposal.amount} / hour${proposal.hours != null ? ` (est. ${proposal.hours} hrs)` : ''}`
      : `$${proposal.amount} flat fee`

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
        `/api/attorney/services/${encodeURIComponent(proposal.serviceKey)}/cost/approve-from-ai`,
        {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({
            costType: proposal.costType,
            amount: proposal.amount,
            hours: proposal.hours,
            summary: proposal.summary,
            confidence: proposal.confidence,
          }),
        },
      )
      const data = (await res.json().catch(() => null)) as {
        serviceKey?: string
        link?: string
        label?: string
        error?: string
      } | null
      if (!res.ok) throw new Error(data?.error || `Approve failed (${res.status})`)
      setLink(data?.link ?? null)
      setApproveState('approved')
      // Continue the guided build to the next step (completeness → Enable).
      if (data?.link) {
        onApproved?.({
          artifact: 'billing',
          link: data.link,
          serviceKey: data.serviceKey || proposal.serviceKey,
          label: data.label || 'Billing',
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
          <LayersIcon size={14} /> Proposed billing — {proposal.serviceKey}
        </span>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {proposal.costType}
        </span>
      </div>

      {proposal.summary && (
        <div className="uac-doc-body" style={{ fontSize: 13 }}>
          {proposal.summary}
        </div>
      )}

      <div className="uac-doc-body" style={{ fontSize: 13 }}>
        <strong>{priceLabel}</strong>
      </div>

      <div className="uac-doc-actions">
        <button
          type="button"
          className={`uac-reply-btn uac-reply-btn-primary${approveState === 'approved' ? ' copied' : ''}`}
          onClick={approve}
          disabled={approveState === 'approving' || approveState === 'approved'}
          title="Approve this billing — this writes the service's fee model"
        >
          {approveState === 'approved' ? <CheckIcon size={12} /> : <LayersIcon size={12} />}{' '}
          {approveState === 'approving'
            ? 'Saving…'
            : approveState === 'approved'
              ? 'Saved'
              : 'Approve & set billing'}
        </button>
        {link && (
          <a className="uac-reply-btn" href={link} target="_blank" rel="noopener noreferrer">
            View billing →
          </a>
        )}
      </div>
      {approveError && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 6 }}>
          {approveError}
        </div>
      )}
    </div>
  )
}
