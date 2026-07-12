'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { LayersIcon, CheckIcon, EditIcon } from '@/components/icons'
import type { OnApproved } from '@/components/ServiceProposalCard'
import { QuestionnaireEditorModal } from '@/components/QuestionnaireEditorModal'

// CONSTRAINT (mirrors ServiceProposalCard): no server-package imports. This shape is
// a structural mirror of the QuestionnaireProposal captured in
// verticals/legal/src/api/intakeTemplateTools.ts — the chat receives it over SSE as
// plain JSON. The schema is intentionally `unknown` (the card renders a structural
// preview + the variable-contract coverage, not an editor).
interface ProposalSection {
  id?: string
  title?: string
  fields?: Array<{ id?: string; label?: string; type?: string; internal?: boolean }>
}
interface ProposalSchema {
  title?: string
  sections?: ProposalSection[]
}

// WP7 — show human labels, never raw field-id slugs. Prefer the authored label; fall
// back to a de-slugged id so "client_name" reads as "Client name".
function fieldLabel(f: { id?: string; label?: string }): string {
  if (f.label && f.label.trim()) return f.label
  return (f.id ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
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
export function QuestionnaireProposalCard({
  proposal,
  onApproved,
  onEdited,
}: {
  proposal: QuestionnaireProposal
  onApproved?: OnApproved
  // WP-H (HARDENING-RESIDUALS-1): fired after the attorney edits the proposal in
  // the pop-up editor, so the session records proposal → human edit → approval.
  onEdited?: (note: string) => void
}) {
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  const [approveError, setApproveError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  // WP-H: the card's CURRENT artifact — the proposal until the attorney edits it
  // in the pop-up; Approve always captures this (the attorney's version).
  const [current, setCurrent] = useState<QuestionnaireProposal>(proposal)
  const [editing, setEditing] = useState(false)

  const sections = current.schema?.sections ?? []
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
            schema: current.schema,
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
      // Continue the guided build to the next step (Phase 6).
      if (data?.link) {
        onApproved?.({
          artifact: 'questionnaire',
          link: data.link,
          serviceKey: data.serviceKey || proposal.serviceKey,
          label: data.label || 'Questionnaire',
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
          <LayersIcon size={14} /> Proposed questionnaire — {proposal.serviceKey}
        </span>
        <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
          {fieldCount} field{fieldCount === 1 ? '' : 's'}
        </span>
      </div>

      {current.summary && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-sm)' }}>
          {current.summary}
        </div>
      )}

      {/* BUILDER-UX-1 WP-2.1: each section is a bolded header with its fields as a
          BULLETED list, never a comma-run. */}
      <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
        {sections.map((s, si) => (
          <div key={s.id ?? si} style={{ marginBottom: 'var(--space-2)' }}>
            <strong>{s.title || s.id || `Section ${si + 1}`}</strong>
            {s.fields && s.fields.length > 0 && (
              <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: '1.1rem' }}>
                {s.fields.map((f, fi) => (
                  <li key={f.id ?? fi}>
                    {fieldLabel(f)}
                    {f.internal ? <span className="text-muted"> (you fill in review)</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* The variable contract — a token with no field renders [[MISSING]]. Only the
          actionable GAP is shown; the positive "no gaps" outro (WP-2.2 redundant
          second blurb) is removed — the section list above already says what it
          collects. */}
      {missing.length > 0 && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
          <div role="alert" className="alert alert-warn" style={{ fontSize: 'var(--text-xs)' }}>
            Doesn&rsquo;t yet collect {missing.length} thing{missing.length === 1 ? '' : 's'} the
            document needs: <strong>{missing.map((m) => fieldLabel({ id: m })).join(', ')}</strong>.
            The document would leave {missing.length === 1 ? 'it' : 'them'} blank until added.
          </div>
        </div>
      )}

      <div className="uac-doc-actions">
        <button
          type="button"
          className="uac-reply-btn"
          onClick={() => setEditing(true)}
          disabled={approveState === 'approving' || approveState === 'approved'}
          title="Edit the proposed questionnaire before approving"
        >
          <EditIcon size={12} /> Edit
        </button>
        <button
          type="button"
          className={`uac-reply-btn uac-reply-btn-primary${approveState === 'approved' ? ' copied' : ''}`}
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
        {link && (
          <a className="uac-reply-btn" href={link} target="_blank" rel="noopener noreferrer">
            View questionnaire →
          </a>
        )}
      </div>
      {approveError && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
          {approveError}
        </div>
      )}
      {editing && (
        // BUILDER-UX-1 WP-4: the REAL questionnaire builder in a pop-up (no JSON
        // textarea). Save updates the CARD (the attorney's version); nothing is
        // written until Approve — the same human gate as the proposal.
        <QuestionnaireEditorModal
          title={`Edit proposed questionnaire — ${current.serviceKey}`}
          initialSchema={(current.schema ?? { sections: [] }) as ProposalSchema}
          name={(current.schema as ProposalSchema)?.title ?? current.serviceKey}
          onSave={(schema) => {
            setCurrent((c) => ({ ...c, schema }))
            onEdited?.(`questionnaire for "${current.serviceKey}"`)
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
