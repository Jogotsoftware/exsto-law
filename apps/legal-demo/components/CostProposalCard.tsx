'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { ConfigEditModal } from '@/components/ConfigEditModal'
import { BillingView, jsonEditor } from '@/components/configEditors'
import { LayersIcon, CheckIcon, EditIcon } from '@/components/icons'
import type { OnApproved } from '@/components/ServiceProposalCard'

// CONSTRAINT (mirrors ServiceProposalCard): no server-package imports. This shape is a
// structural mirror of the CostProposal captured in
// verticals/legal/src/api/costAuthoring.ts — the chat receives it over SSE as plain JSON.
export interface CostProposal {
  serviceKey: string
  costType: 'hourly' | 'fixed'
  amount: string
  hours: number | null
  // BUILDER-CERT-1 (WP1) — per-document fees declared alongside the cost.
  documentFees?: Record<string, string>
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
  onEdited,
}: {
  proposal: CostProposal
  onApproved?: OnApproved
  // WP-H: fired after the attorney edits the proposal in the pop-up editor.
  onEdited?: (note: string) => void
}) {
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  const [approveError, setApproveError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  // WP-H: the card's CURRENT price — the proposal until the attorney edits it;
  // Approve always captures this (the attorney's version).
  const [current, setCurrent] = useState<CostProposal>(proposal)
  const [editing, setEditing] = useState(false)

  // Human-readable price line, e.g. "$350.00 / hour (est. 6 hrs)" or "$1,500.00 flat".
  const priceLabel =
    current.costType === 'hourly'
      ? `$${current.amount} / hour${current.hours != null ? ` (est. ${current.hours} hrs)` : ''}`
      : `$${current.amount} flat fee`

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
            costType: current.costType,
            amount: current.amount,
            hours: current.hours,
            ...(current.documentFees ? { documentFees: current.documentFees } : {}),
            summary: current.summary,
            confidence: current.confidence,
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
          {current.costType}
        </span>
      </div>

      {/* BUILDER-UX-1 WP-2.3/WP-3: the fee value appears ONCE, prominently. The
          model summary (which restated the fee) is dropped, and the card is
          confirm-only — the fee was already captured by the final wizard
          question; this is not a second entry, just a confirmation. */}
      <div className="uac-doc-body" style={{ fontSize: 15 }}>
        <strong>{priceLabel}</strong>
      </div>
      {current.documentFees && Object.keys(current.documentFees).length > 0 && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
          <strong>Per-document fees</strong>
          <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: '1.1rem' }}>
            {Object.entries(current.documentFees).map(([kind, amt]) => (
              <li key={kind}>
                {kind.replace(/_/g, ' ')}: ${amt}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="uac-doc-actions">
        <button
          type="button"
          className="uac-reply-btn"
          onClick={() => setEditing(true)}
          disabled={approveState === 'approving' || approveState === 'approved'}
          title="Edit the proposed billing before approving"
        >
          <EditIcon size={12} /> Edit
        </button>
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
      {editing && (
        <ConfigEditModal
          artifactKind="billing"
          targetId={`proposal:${current.serviceKey}`}
          title={`Edit proposed billing — ${current.serviceKey}`}
          initialContent={JSON.stringify(
            {
              costType: current.costType,
              amount: current.amount,
              hours: current.hours,
              ...(current.documentFees ? { documentFees: current.documentFees } : {}),
            },
            null,
            2,
          )}
          renderView={(content) => <BillingView content={content} />}
          renderEdit={jsonEditor}
          aiRegenerate={false}
          saveLabel="Save"
          onSave={async (content) => {
            const next = JSON.parse(content) as Partial<CostProposal>
            setCurrent((c) => ({ ...c, ...next }))
            onEdited?.(`billing for "${current.serviceKey}"`)
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
