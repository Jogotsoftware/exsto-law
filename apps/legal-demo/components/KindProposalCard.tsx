'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { LayersIcon, CheckIcon } from '@/components/icons'
import type { OnApproved } from '@/components/ServiceProposalCard'

// Structural mirror of verticals/legal/src/api/kindAuthoring.ts's KindProposal —
// received over SSE as plain JSON (no server-package import).
export interface KindProposal {
  registry: 'entity' | 'attribute' | 'relationship' | 'event'
  kindName: string
  displayName: string
  description: string | null
  onEntityKind: string | null
  valueType: string | null
  sourceEntityKind: string | null
  targetEntityKind: string | null
  summary: string
  confidence: number
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// Inline approval card for an AI-proposed NEW data kind (Tier 1 data-as-schema).
// The HUMAN GATE: the proposing turn wrote nothing; Approve mints the kind via
// kind.define. Mirrors ServiceProposalCard.
export function KindProposalCard({
  proposal,
  onApproved,
}: {
  proposal: KindProposal
  onApproved?: OnApproved
}) {
  const [state, setState] = useState<'idle' | 'approving' | 'approved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const detail =
    proposal.registry === 'attribute'
      ? `field on ${proposal.onEntityKind ?? '—'}${proposal.valueType ? ` · ${proposal.valueType}` : ''}`
      : proposal.registry === 'relationship'
        ? `${proposal.sourceEntityKind ?? '—'} → ${proposal.targetEntityKind ?? '—'}`
        : proposal.registry

  async function approve() {
    setState('approving')
    setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (IS_DEV) {
        const dev = readDevSession()
        if (dev) {
          headers['x-actor-id'] = dev.actorId
          headers['x-tenant-id'] = dev.tenantId
        }
      }
      const res = await fetch('/api/attorney/kinds/define', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify(proposal),
      })
      const data = (await res.json().catch(() => null)) as {
        result?: { kindName?: string }
        link?: string
        label?: string
        error?: string
      } | null
      if (!res.ok) throw new Error(data?.error || `Approve failed (${res.status})`)
      setState('approved')
      if (data?.link) {
        onApproved?.({
          artifact: 'kind',
          link: data.link,
          serviceKey: proposal.kindName,
          label: data.label || `${proposal.registry} kind "${proposal.kindName}"`,
        })
      }
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="uac-doc-card">
      <div className="uac-doc-head">
        <span className="uac-doc-title">
          <LayersIcon size={14} /> Proposed {proposal.registry} kind — {proposal.displayName}
        </span>
        <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
          {proposal.kindName}
        </span>
      </div>

      {proposal.summary && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-sm)' }}>
          {proposal.summary}
        </div>
      )}

      <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
        {proposal.description && (
          <div>
            <strong>Captures:</strong> {proposal.description}
          </div>
        )}
        <div>
          <strong>Type:</strong> {detail}
        </div>
        <div className="text-muted">
          A new data concept for this firm — created as a definition row, no code.
        </div>
      </div>

      <div className="uac-doc-actions">
        <button
          type="button"
          className={`uac-reply-btn uac-reply-btn-primary${state === 'approved' ? ' copied' : ''}`}
          onClick={approve}
          disabled={state === 'approving' || state === 'approved'}
          title="Approve — this defines the new data kind"
        >
          {state === 'approved' ? <CheckIcon size={12} /> : <LayersIcon size={12} />}{' '}
          {state === 'approving'
            ? 'Defining…'
            : state === 'approved'
              ? 'Defined'
              : 'Approve & define kind'}
        </button>
      </div>
      {error && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
