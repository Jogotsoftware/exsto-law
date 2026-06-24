'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { LayersIcon, CheckIcon } from '@/components/icons'

// CONSTRAINT (mirrors ServiceProposalCard): no server-package imports. This shape is
// a structural mirror of the TemplateProposal captured in
// verticals/legal/src/api/intakeTemplateTools.ts — the chat receives it over SSE as
// plain JSON.
export interface TemplateProposal {
  serviceKey: string
  name: string
  body: string
  docKind: string
  summary: string
  confidence: number
  // The {{tokens}} the body references, and the orphans (no matching question) — the
  // broken half of the variable contract the attorney must see before approving.
  tokens: string[]
  orphanTokens: string[]
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// A short body preview — the first few lines, so the attorney sees the shape without
// the card swallowing the chat. The full body is sent on approve.
const PREVIEW_CHARS = 600

// The inline approval card for an AI-proposed document TEMPLATE (Build-Wizard Phase
// 3). It is the HUMAN GATE: the proposing chat turn wrote nothing; clicking Approve
// POSTs the body to the templates approve-from-ai route, the only place the template
// is written (bound to the service by docKind). The card lists the {{tokens}} and
// flags any ORPHAN (a token with no question) so the attorney never approves a body
// that would render [[MISSING]].
export function TemplateProposalCard({ proposal }: { proposal: TemplateProposal }) {
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  const [approveError, setApproveError] = useState<string | null>(null)

  const orphans = new Set((proposal.orphanTokens ?? []).map((t) => t.toLowerCase()))
  const preview =
    proposal.body.length > PREVIEW_CHARS
      ? `${proposal.body.slice(0, PREVIEW_CHARS).trimEnd()}…`
      : proposal.body

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
        `/api/attorney/services/${encodeURIComponent(proposal.serviceKey)}/templates/approve-from-ai`,
        {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({
            name: proposal.name,
            body: proposal.body,
            docKind: proposal.docKind,
            summary: proposal.summary,
            confidence: proposal.confidence,
          }),
        },
      )
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error || `Approve failed (${res.status})`)
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
          <LayersIcon size={14} /> Proposed template — {proposal.name}
        </span>
        <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
          {proposal.serviceKey} · {proposal.docKind}
        </span>
      </div>

      {proposal.summary && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-sm)' }}>
          {proposal.summary}
        </div>
      )}

      <div
        className="uac-doc-body"
        style={{
          fontSize: 'var(--text-xs)',
          whiteSpace: 'pre-wrap',
          maxHeight: 200,
          overflow: 'auto',
        }}
      >
        {preview}
      </div>

      {/* The variable contract — the {{tokens}} the body merges, orphans flagged. An
          orphan has no question, so it would render [[MISSING]] in the document. */}
      <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
        {proposal.tokens.length === 0 ? (
          <div className="text-muted">No merge tokens — this is a static document.</div>
        ) : (
          <div>
            <strong>Tokens:</strong>{' '}
            {proposal.tokens.map((t, i) => (
              <span key={t}>
                {i > 0 && ', '}
                <code style={orphans.has(t.toLowerCase()) ? { color: 'var(--danger)' } : undefined}>
                  {`{{${t}}}`}
                </code>
              </span>
            ))}
          </div>
        )}
      </div>

      {orphans.size > 0 && (
        <div role="alert" className="alert alert-warn" style={{ fontSize: 'var(--text-xs)' }}>
          {orphans.size} token{orphans.size === 1 ? '' : 's'} have NO matching question and would
          render [[MISSING]]: <strong>{[...orphans].join(', ')}</strong>. Add those questions to the
          questionnaire before sending documents.
        </div>
      )}

      <div className="uac-doc-actions">
        <button
          type="button"
          className={`uac-reply-btn${approveState === 'approved' ? ' copied' : ''}`}
          onClick={approve}
          disabled={approveState === 'approving' || approveState === 'approved'}
          title="Approve this template — this writes it to the service"
        >
          {approveState === 'approved' ? <CheckIcon size={12} /> : <LayersIcon size={12} />}{' '}
          {approveState === 'approving'
            ? 'Saving…'
            : approveState === 'approved'
              ? 'Saved'
              : 'Approve & save template'}
        </button>
      </div>
      {approveError && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
          {approveError}
        </div>
      )}
    </div>
  )
}
