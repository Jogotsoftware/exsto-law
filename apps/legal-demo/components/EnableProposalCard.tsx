'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { buildFirmBookingUrl, useFirmPublicSlug } from '@/lib/firmBookingLink'
import { ProposalCardShell } from '@/components/ProposalCardShell'
import { CheckIcon, EyeIcon, Share2Icon, MailIcon } from '@/components/icons'
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
  onDone,
}: {
  proposal: EnableProposal
  onApproved?: OnApproved
  // WP-5 (BUILDER-UX-2) — the explicit end of the one-build-one-thread lifecycle:
  // "Done · Close setup" exits build mode, seals the build session, and returns to
  // normal assistant chat. Shown once the service is live.
  onDone?: () => void
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
  // MULTI-TENANT-1: firm slug for the firm-scoped fallback link (the server value is
  // preferred; this only applies if the enable response omitted bookingLink).
  const publicSlug = useFirmPublicSlug()

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
        data?.bookingLink ??
          buildFirmBookingUrl('', publicSlug, { serviceKey: proposal.serviceKey }),
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

  // WP-L: the ABSOLUTE booking URL the comp's Share/Email actions carry — always
  // the real link (server-provided path made absolute), never a model-typed href.
  const absBookingUrl =
    bookingLink && typeof window !== 'undefined'
      ? new URL(bookingLink, window.location.origin).toString()
      : bookingLink

  function shareBooking() {
    if (!absBookingUrl) return
    void navigator.clipboard?.writeText(absBookingUrl).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2200)
      },
      () => {},
    )
  }

  return (
    <ProposalCardShell
      kind="Review & publish"
      title={proposal.serviceKey}
      meta="final step"
      footer={
        approveError ? (
          <div role="alert" className="alert alert-error" style={{ marginTop: 6 }}>
            {approveError}
          </div>
        ) : undefined
      }
    >
      {proposal.summary && <div className="li-uac-prop-summary">{proposal.summary}</div>}

      {/* WP-5 (BUILDER-UX-2, kept) — no step recap. Before enabling, one line sets
          expectations; after, the comp's post-publish actions speak. */}
      {approveState !== 'approved' && (
        <div className="li-uac-prop-note">
          Publishing makes this service live and bookable. Until then, it stays a draft.
        </div>
      )}

      {approveState !== 'approved' ? (
        <button
          type="button"
          className="li-uac-publish"
          onClick={approve}
          disabled={approveState === 'approving'}
          title="Publish this service — this makes it live and bookable"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
          {approveState === 'approving' ? 'Publishing…' : 'Publish service'}
        </button>
      ) : (
        // WP-L (comp isDone): View service / Share link / Email link + the
        // "Booking link copied" confirmation chip; Done closes the build thread.
        <div className="li-uac-done">
          {link && (
            <a className="li-uac-done-primary" href={link}>
              <EyeIcon size={15} /> View service
            </a>
          )}
          <div className="li-uac-done-row">
            <button
              type="button"
              className="li-uac-prop-btn"
              onClick={shareBooking}
              disabled={!absBookingUrl}
              title="Copy the client booking link to share"
            >
              <Share2Icon size={14} /> Share link
            </button>
            <a
              className={`li-uac-prop-btn${absBookingUrl ? '' : ' is-disabled'}`}
              href={
                absBookingUrl
                  ? `mailto:?subject=${encodeURIComponent('Book with us')}&body=${encodeURIComponent(
                      `You can book this service here: ${absBookingUrl}`,
                    )}`
                  : undefined
              }
              title="Email the booking link"
            >
              <MailIcon size={14} /> Email link
            </a>
          </div>
          {copied && (
            <div className="li-uac-copied" role="status">
              <CheckIcon size={12} /> Booking link copied
            </div>
          )}
          {/* WP-5 (kept): the formal end of the build — returns to normal chat. */}
          {onDone && (
            <button
              type="button"
              className="li-uac-prop-btn"
              onClick={onDone}
              title="Finish setup and return to the assistant"
            >
              <CheckIcon size={14} /> Done · Close setup
            </button>
          )}
        </div>
      )}
    </ProposalCardShell>
  )
}
