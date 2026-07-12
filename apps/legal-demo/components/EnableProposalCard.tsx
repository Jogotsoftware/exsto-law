'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { LayersIcon, CheckIcon } from '@/components/icons'
import type { OnApproved } from '@/components/ServiceProposalCard'

// CONSTRAINT (mirrors ServiceProposalCard): no server-package imports. This shape is a
// structural mirror of the EnableProposal captured in
// verticals/legal/src/api/costEnableTools.ts — the chat receives it over SSE as plain JSON.
export interface EnableProposal {
  serviceKey: string
  summary: string
  // BUILDER-UX-1 WP-2.1 — the completed service's steps, rendered as a bulleted
  // completion summary rather than a comma-run.
  completion?: string[]
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// The inline approval card for the TERMINAL Enable step (Build-Wizard Phase 6). It is
// the HUMAN GATE that makes the service LIVE: clicking Approve POSTs to the
// enable-from-ai route, which calls legal.service.set_active(true) — flipping the
// current version from the disabled-draft status ('deprecated') to 'active'. This is
// the step the old wizard never reached, which is why a wizard-built service stayed a
// hidden draft. Approving it is what publishes the service.
export function EnableProposalCard({
  proposal,
  onApproved,
}: {
  proposal: EnableProposal
  onApproved?: OnApproved
}) {
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  const [approveError, setApproveError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  // WP4: the REAL public booking URL for the service, from the enable route (never a
  // model-typed link). Rendered as a real button + copy action once the service is live.
  const [bookingLink, setBookingLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
        `/api/attorney/services/${encodeURIComponent(proposal.serviceKey)}/lifecycle/enable-from-ai`,
        { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify({}) },
      )
      const data = (await res.json().catch(() => null)) as {
        result?: { status?: string }
        serviceKey?: string
        link?: string
        label?: string
        bookingLink?: string
        error?: string
      } | null
      if (!res.ok) throw new Error(data?.error || `Enable failed (${res.status})`)
      setLink(data?.link ?? null)
      setBookingLink(
        data?.bookingLink ?? `/book?service=${encodeURIComponent(proposal.serviceKey)}`,
      )
      setApproveState('approved')
      // This is the TERMINAL step — onApproved tells the chat the service is live (with
      // its link). The chat does NOT auto-continue after Enable; the build is complete.
      if (data?.link) {
        onApproved?.({
          artifact: 'enable',
          link: data.link,
          serviceKey: data.serviceKey || proposal.serviceKey,
          label: data.label || `Service "${proposal.serviceKey}" (live)`,
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
          <LayersIcon size={14} /> Enable service — {proposal.serviceKey}
        </span>
        <span className="text-muted" style={{ fontSize: 12 }}>
          final step
        </span>
      </div>

      {proposal.summary && (
        <div className="uac-doc-body" style={{ fontSize: 13 }}>
          {proposal.summary}
        </div>
      )}

      {/* BUILDER-UX-1 WP-2.1: the completion summary is a BULLETED list under a
          bolded header — the service's steps — never a comma-run. */}
      {proposal.completion && proposal.completion.length > 0 && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
          <strong>This service is complete</strong>
          <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: '1.1rem' }}>
            {proposal.completion.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="uac-doc-body text-muted" style={{ fontSize: 12 }}>
        Approving makes this service live and bookable. Until you approve, it stays a draft.
      </div>

      <div className="uac-doc-actions">
        <button
          type="button"
          className={`uac-reply-btn uac-reply-btn-primary${approveState === 'approved' ? ' copied' : ''}`}
          onClick={approve}
          disabled={approveState === 'approving' || approveState === 'approved'}
          title="Enable this service — this makes it live and bookable"
        >
          {approveState === 'approved' ? <CheckIcon size={12} /> : <LayersIcon size={12} />}{' '}
          {approveState === 'approving'
            ? 'Enabling…'
            : approveState === 'approved'
              ? 'Live'
              : 'Approve & enable (go live)'}
        </button>
        {link && (
          <a className="uac-reply-btn" href={link} target="_blank" rel="noopener noreferrer">
            View live service →
          </a>
        )}
        {/* WP4: the real client booking link — open it, or copy the absolute URL to
            share. Never a model-generated href, so it can't route to "/". */}
        {bookingLink && approveState === 'approved' && (
          <>
            <a
              className="uac-reply-btn"
              href={bookingLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open booking page →
            </a>
            <button
              type="button"
              className={`uac-reply-btn${copied ? ' copied' : ''}`}
              onClick={() => {
                const abs =
                  typeof window !== 'undefined'
                    ? new URL(bookingLink, window.location.origin).toString()
                    : bookingLink
                void navigator.clipboard?.writeText(abs).then(
                  () => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  },
                  () => {},
                )
              }}
              title="Copy the client booking link to share"
            >
              {copied ? <CheckIcon size={12} /> : null} {copied ? 'Copied' : 'Copy booking link'}
            </button>
          </>
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
