'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { LayersIcon, CheckIcon } from '@/components/icons'

// CONSTRAINT (mirrors ServiceProposalCard): no server-package imports. This shape is
// a structural mirror of the QuestionnaireProposal captured in
// verticals/legal/src/api/intakeTemplateTools.ts — the chat receives it over SSE as
// plain JSON. The schema is intentionally `unknown` (the card renders a structural
// preview + the variable-contract coverage, not an editor).
interface ProposalSection {
  id?: string
  title?: string
  fields?: Array<{ id?: string; label?: string; type?: string }>
}
interface ProposalSchema {
  title?: string
  sections?: ProposalSection[]
}

export interface QuestionnaireProposal {
  serviceKey: string
  schema: ProposalSchema
  summary: string
  confidence: number
  // The variable contract: template tokens the form does NOT collect (incomplete),
  // and fields no template uses (collected-but-unused). missingForTokens is the one
  // the attorney must see — it means a document would render [[MISSING]].
  missingForTokens: string[]
  unusedFields: string[]
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// The inline approval card for an AI-proposed intake QUESTIONNAIRE (Build-Wizard
// Phase 2). It is the HUMAN GATE: the proposing chat turn wrote nothing; clicking
// Approve POSTs the schema to the questionnaire approve-from-ai route, the only place
// the form is written. The card surfaces the variable contract — how many template
// tokens the form covers — so the attorney never approves an incomplete form.
export function QuestionnaireProposalCard({ proposal }: { proposal: QuestionnaireProposal }) {
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  const [approveError, setApproveError] = useState<string | null>(null)

  const sections = proposal.schema?.sections ?? []
  const fieldCount = sections.reduce((n, s) => n + (s.fields?.length ?? 0), 0)
  const missing = proposal.missingForTokens ?? []

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
        `/api/attorney/services/${encodeURIComponent(proposal.serviceKey)}/questionnaire/approve-from-ai`,
        {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({
            schema: proposal.schema,
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
          <LayersIcon size={14} /> Proposed questionnaire — {proposal.serviceKey}
        </span>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {fieldCount} field{fieldCount === 1 ? '' : 's'}
        </span>
      </div>

      {proposal.summary && (
        <div className="uac-doc-body" style={{ fontSize: 13 }}>
          {proposal.summary}
        </div>
      )}

      <div className="uac-doc-body" style={{ fontSize: 12 }}>
        {sections.map((s, si) => (
          <div key={s.id ?? si} style={{ marginBottom: 4 }}>
            <strong>{s.title || s.id || `Section ${si + 1}`}</strong>
            {s.fields && s.fields.length > 0 && (
              <span className="text-muted">
                {' '}
                — {s.fields.map((f) => f.id || f.label).join(', ')}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* The variable contract — the point of the wizard. A token with no field would
          render [[MISSING]] in the document, so the attorney sees coverage first. */}
      <div className="uac-doc-body" style={{ fontSize: 12 }}>
        {missing.length === 0 ? (
          <div className="text-muted">Covers every document token — no [[MISSING]] gaps.</div>
        ) : (
          <div role="alert" className="alert alert-warn" style={{ fontSize: 12 }}>
            Does not yet collect {missing.length} document token{missing.length === 1 ? '' : 's'}:{' '}
            <strong>{missing.join(', ')}</strong>. These would render [[MISSING]] until added.
          </div>
        )}
      </div>

      <div className="uac-doc-actions">
        <button
          type="button"
          className={`uac-reply-btn${approveState === 'approved' ? ' copied' : ''}`}
          onClick={approve}
          disabled={approveState === 'approving' || approveState === 'approved'}
          title="Approve this questionnaire — this writes the service's intake form"
        >
          {approveState === 'approved' ? <CheckIcon size={12} /> : <LayersIcon size={12} />}{' '}
          {approveState === 'approving'
            ? 'Saving…'
            : approveState === 'approved'
              ? 'Saved'
              : 'Approve & save questionnaire'}
        </button>
      </div>
      {approveError && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 6 }}>
          {approveError}
        </div>
      )}
    </div>
  )
}
