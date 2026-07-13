'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { LayersIcon, CheckIcon, EditIcon } from '@/components/icons'
import type { OnApproved } from '@/components/ServiceProposalCard'
import { TemplateEditorModal } from '@/components/TemplateEditorModal'
import { TemplatePreview } from '@/components/templates/TemplatePreview'

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
  // BUILDER-CERT-1 (WP3) — signability declared on the card; forwarded on approve so
  // the firm-library template carries it (what lets an e-sign step compose after it).
  signature?: { required: boolean; signer_roles: string[] }
  // The {{tokens}} the body references, and the orphans (no matching question on THIS
  // service). With the documents→variables→questionnaire flow, orphans before the
  // questionnaire exists are NOT broken — they're the fields the questionnaire collects
  // next; hasQuestionnaire picks the framing.
  tokens: string[]
  orphanTokens: string[]
  // Phase 7 — whether this service already has a questionnaire (drives the framing:
  // forward-looking "will become questions" vs. red "missing → [[MISSING]]").
  hasQuestionnaire: boolean
  // Phase 7 — orphan tokens that already exist as questions elsewhere in the firm; the
  // questionnaire step should REUSE those rather than re-invent them.
  reusableFromFirm: string[]
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// Display form of a kind slug ("operating_agreement" → "Operating Agreement"),
// matching the templates pages — attorneys never see snake_case.
function humanKind(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// The inline approval card for an AI-proposed document TEMPLATE (Build-Wizard Phase
// 3). It is the HUMAN GATE: the proposing chat turn wrote nothing; clicking Approve
// POSTs the body to the templates approve-from-ai route, the only place the template
// is written (bound to the service by docKind). The card lists the {{tokens}} and
// flags any ORPHAN (a token with no question) so the attorney never approves a body
// that would render [[MISSING]].
export function TemplateProposalCard({
  proposal,
  onApproved,
  onEdited,
}: {
  proposal: TemplateProposal
  onApproved?: OnApproved
  // WP-H: fired after the attorney edits the proposal in the pop-up editor.
  onEdited?: (note: string) => void
}) {
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  const [approveError, setApproveError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  // WP-H: the card's CURRENT body — the proposal until the attorney edits it in
  // the pop-up; Approve always captures this (the attorney's version).
  const [currentBody, setCurrentBody] = useState(proposal.body)
  const [editing, setEditing] = useState(false)
  const [editSeedBody, setEditSeedBody] = useState<string | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  // BUILDER-UX-2 WP-2: the PERSISTED template's entity id, from the approve response.
  // Post-approval Edit saves against the SAVED artifact — never a stale in-memory
  // proposal.
  const [templateEntityId, setTemplateEntityId] = useState<string | null>(null)

  // Post-approval Edit seeds from the SAVED service-bound body (the copy drafting
  // reads), not the card's frozen snapshot — an edit made meanwhile on the service's
  // Templates tab must show up here, not get silently reverted on Save.
  async function openEditor() {
    if (approveState !== 'approved') {
      setEditSeedBody(null)
      setEditing(true)
      return
    }
    setEditLoading(true)
    try {
      const r = await callAttorneyMcp<{ template: { templateText: string | null } | null }>({
        toolName: 'legal.service.template.get',
        input: { serviceKey: proposal.serviceKey, documentKind: proposal.docKind },
      })
      setEditSeedBody(r.template?.templateText ?? currentBody)
    } catch {
      setEditSeedBody(currentBody) // read failure: the card's copy is the best seed we have
    } finally {
      setEditLoading(false)
    }
    setEditing(true)
  }

  const orphans = new Set((proposal.orphanTokens ?? []).map((t) => t.toLowerCase()))
  const reusable = new Set((proposal.reusableFromFirm ?? []).map((t) => t.toLowerCase()))
  // REUSE-AWARE: a token that already exists as a question elsewhere in the firm is NOT
  // missing — it has a definition to adopt. So the genuinely-missing set is the orphans
  // that are NOT reusable. Reusable tokens must never appear red or in the [[MISSING]]
  // warning; they are surfaced positively in the reuse note below.
  const missing = new Set([...orphans].filter((t) => !reusable.has(t)))
  // FLOW-AWARE FRAMING (Phase 7): a token with no question is only a real, alarming
  // problem once the service HAS a questionnaire. Before that, the questionnaire is
  // built FROM these tokens in the next step — so they are forward-looking, not broken.
  // Only paint tokens red / show the [[MISSING]] warning when a questionnaire exists AND
  // there is a genuinely-missing (non-reusable) token.
  const showOrphanError = proposal.hasQuestionnaire && missing.size > 0

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
            body: currentBody,
            docKind: proposal.docKind,
            summary: proposal.summary,
            confidence: proposal.confidence,
            ...(proposal.signature ? { signature: proposal.signature } : {}),
          }),
        },
      )
      const data = (await res.json().catch(() => null)) as {
        result?: { templateEntityId?: string }
        serviceKey?: string
        link?: string
        label?: string
        error?: string
      } | null
      if (!res.ok) throw new Error(data?.error || `Approve failed (${res.status})`)
      setLink(data?.link ?? null)
      setTemplateEntityId(data?.result?.templateEntityId ?? null)
      setApproveState('approved')
      // Continue the guided build to the next step (Phase 6).
      if (data?.link) {
        onApproved?.({
          artifact: 'template',
          link: data.link,
          serviceKey: data.serviceKey || proposal.serviceKey,
          label: data.label || `Template "${proposal.name}"`,
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
          <LayersIcon size={14} /> Proposed template — {proposal.name}
        </span>
        <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
          {proposal.serviceKey} · {humanKind(proposal.docKind)}
          {proposal.signature?.required
            ? ` · signed by ${proposal.signature.signer_roles.join(', ')}`
            : ''}
        </span>
      </div>

      {proposal.summary && (
        <div className="uac-doc-body" style={{ fontSize: 'var(--text-sm)' }}>
          {proposal.summary}
        </div>
      )}

      {/* WP-4 (BUILDER-UX-2) — render the FORMATTED preview (the SAME renderer the
          pop-up View uses), not raw markdown source. Height-capped so the card never
          swallows the chat. */}
      <div className="uac-doc-body" style={{ maxHeight: 260, overflow: 'auto' }}>
        <TemplatePreview body={currentBody} />
      </div>

      {/* WP-4 — the variable contract as CHIPS with a count, never a comma-run. An
          orphan with no question (once a questionnaire exists) is flagged red because
          it would render [[MISSING]] in the document. */}
      <div className="uac-doc-body" style={{ fontSize: 'var(--text-xs)' }}>
        {proposal.tokens.length === 0 ? (
          <div className="text-muted">No merge fields — this is a static document.</div>
        ) : (
          <>
            <div className="text-muted" style={{ marginBottom: 4 }}>
              {proposal.tokens.length} merge field{proposal.tokens.length === 1 ? '' : 's'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {proposal.tokens.map((t) => {
                const isMissing = showOrphanError && missing.has(t.toLowerCase())
                const isReusable = reusable.has(t.toLowerCase())
                return (
                  <span
                    key={t}
                    className="uac-chip"
                    title={
                      isMissing
                        ? 'No matching question yet — would render [[MISSING]]'
                        : isReusable
                          ? 'Already exists on another service — will be reused'
                          : undefined
                    }
                    style={{
                      display: 'inline-block',
                      padding: '1px 7px',
                      borderRadius: 10,
                      fontSize: 'var(--text-xs)',
                      border: '1px solid var(--border, rgba(127,127,127,0.35))',
                      color: isMissing ? 'var(--danger)' : undefined,
                      borderColor: isMissing ? 'var(--danger)' : undefined,
                    }}
                  >
                    {t}
                  </span>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Only the HARD alert survives (no forward-looking / reuse outro paragraphs):
          once a questionnaire exists, an unmatched token is a real gap. */}
      {showOrphanError && (
        <div role="alert" className="alert alert-warn" style={{ fontSize: 'var(--text-xs)' }}>
          {missing.size} field{missing.size === 1 ? '' : 's'} have no matching question and would
          render [[MISSING]]: <strong>{[...missing].join(', ')}</strong>.
        </div>
      )}

      <div className="uac-doc-actions">
        <button
          type="button"
          className="uac-reply-btn"
          onClick={() => void openEditor()}
          disabled={
            approveState === 'approving' ||
            editLoading ||
            (approveState === 'approved' && !templateEntityId)
          }
          title={
            approveState === 'approved'
              ? 'Edit the saved template — saves a new version'
              : 'Edit the proposed template before approving'
          }
        >
          <EditIcon size={12} /> {editLoading ? 'Loading…' : 'Edit'}
        </button>
        <button
          type="button"
          className={`uac-reply-btn uac-reply-btn-primary${approveState === 'approved' ? ' copied' : ''}`}
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
        {link && (
          <a className="uac-reply-btn" href={link} target="_blank" rel="noopener noreferrer">
            View templates →
          </a>
        )}
      </div>
      {approveError && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
          {approveError}
        </div>
      )}
      {editing && (
        <TemplateEditorModal
          title={
            approveState === 'approved'
              ? `Edit template — ${proposal.name}`
              : `Edit proposed template — ${proposal.name}`
          }
          initialBody={editSeedBody ?? currentBody}
          regenerateTargetId={
            approveState === 'approved' && templateEntityId
              ? templateEntityId
              : `proposal:${proposal.serviceKey}`
          }
          onSave={async (body) => {
            if (approveState === 'approved' && templateEntityId) {
              // Post-approval: approve wrote TWO stores (createTemplateAI's dual
              // write) — the SERVICE-BOUND body drafting + completeness read, and the
              // firm-library twin. The edit must land in BOTH, or new matters draft
              // the stale clause while the card claims the fix saved.
              await callAttorneyMcp({
                toolName: 'legal.service.template.update',
                input: {
                  serviceKey: proposal.serviceKey,
                  documentKind: proposal.docKind,
                  templateText: body,
                },
              })
              await callAttorneyMcp({
                toolName: 'legal.template.update',
                input: { templateEntityId, body },
              })
              setCurrentBody(body)
              onEdited?.(`template "${proposal.name}" for "${proposal.serviceKey}" (saved)`)
              return
            }
            // Pre-approval: Save updates the CARD; nothing is written until Approve.
            setCurrentBody(body)
            onEdited?.(`template "${proposal.name}" for "${proposal.serviceKey}"`)
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
