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

  // WP-3.2 (BUILDER-UX-2) — the single-billing-card coherence invariant, stated in
  // code, not prose. The founder's cease-and-desist walk produced a "$0.00" billing
  // card that nonetheless listed a "$500.00" line item; an attorney approving it sets
  // a $0 fee and mis-bills. RULE: a fixed-fee card that lists per-document line items
  // must have a header amount EQUAL to the sum of those line items — the fee shown once
  // is the same money the breakdown lists (confirm-only, one billing point per WP-3.3),
  // never a separate additive charge and never a $0 header beside a paid line. When the
  // amounts disagree (or any is unparseable), the card is INCOHERENT: it refuses to
  // render an Approve control — a correction notice + Edit stands in — and logs, so no
  // one approves a contradictory price. (Root cause of the *duplicate* card is fixed
  // upstream in costEnableTools.buildProposeCostTool: one build → one billing proposal,
  // superseded in place.)
  const toCents = (s: string | number | null | undefined): number | null => {
    if (s == null) return null
    const n = Number.parseFloat(String(s).replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) ? Math.round(n * 100) : null
  }
  const docFeeEntries = Object.entries(current.documentFees ?? {})
  const lineCentsList = docFeeEntries.map(([k, v]) => [k, toCents(v)] as const)
  const lineCentsSum = lineCentsList.reduce((a, [, c]) => a + (c ?? 0), 0)
  const headerCents = toCents(current.amount)
  const billingIncoherent =
    current.costType === 'fixed' &&
    docFeeEntries.length > 0 &&
    (headerCents === null ||
      lineCentsList.some(([, c]) => c === null) ||
      headerCents !== lineCentsSum)
  if (billingIncoherent && typeof console !== 'undefined') {
    // Logged (not silent) so a mismatch is observable and the model can regenerate.
    console.warn(
      `[billing-card] incoherent proposal for ${current.serviceKey}: header $${current.amount} ≠ line items ${JSON.stringify(current.documentFees)} — Approve suppressed.`,
    )
  }

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

      {billingIncoherent && (
        <div role="alert" className="alert alert-warn" style={{ fontSize: 'var(--text-xs)' }}>
          This price is inconsistent — the fee (${current.amount}) does not match the per-document
          amount{docFeeEntries.length === 1 ? '' : 's'} listed above. Edit it so the fee equals what
          the document charges, then approve.
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
        {/* WP-3.2: no Approve control while the card is incoherent — the attorney
            must reconcile the fee and the line items first. */}
        {!billingIncoherent && (
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
        )}
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
