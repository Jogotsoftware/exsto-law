'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { CheckIcon, EditIcon } from '@/components/icons'
import type { OnApproved } from '@/components/ServiceProposalCard'
import { ProposalCardShell, ProposalSections } from '@/components/ProposalCardShell'
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
  const [editSeedSchema, setEditSeedSchema] = useState<unknown | null>(null)
  const [editLoading, setEditLoading] = useState(false)

  // Post-approval Edit seeds from the SAVED intake questionnaire, not the card's
  // frozen snapshot — an edit made meanwhile on the questionnaire tab must show up
  // here, not get silently replaced by Save.
  async function openEditor() {
    if (approveState !== 'approved') {
      setEditSeedSchema(null)
      setEditing(true)
      return
    }
    setEditLoading(true)
    try {
      const r = await callAttorneyMcp<{ questionnaire: { sections: unknown[] } | null }>({
        toolName: 'legal.service.questionnaire.get',
        input: { serviceKey: current.serviceKey },
      })
      setEditSeedSchema(r.questionnaire ?? current.schema)
    } catch {
      setEditSeedSchema(current.schema) // read failure: the card's copy is the best seed
    } finally {
      setEditLoading(false)
    }
    setEditing(true)
  }

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
    <ProposalCardShell
      kind="Questionnaire"
      title={(current.schema as ProposalSchema)?.title || `Intake — ${proposal.serviceKey}`}
      meta={`${fieldCount} field${fieldCount === 1 ? '' : 's'}`}
      actions={
        <>
          <button
            type="button"
            className={`li-uac-prop-btn primary${approveState === 'approved' ? ' done' : ''}`}
            onClick={approve}
            disabled={approveState === 'approving' || approveState === 'approved'}
            title="Approve this questionnaire — this writes the service's intake form"
          >
            <CheckIcon size={14} />{' '}
            {approveState === 'approving'
              ? 'Saving…'
              : approveState === 'approved'
                ? 'Saved'
                : 'Approve'}
          </button>
          <button
            type="button"
            className="li-uac-prop-btn"
            onClick={() => void openEditor()}
            disabled={approveState === 'approving' || editLoading}
            title={
              approveState === 'approved'
                ? 'Edit the saved questionnaire — saves a new version'
                : 'Edit the proposed questionnaire before approving'
            }
          >
            <EditIcon size={14} /> {editLoading ? 'Loading…' : 'Open & edit'}
          </button>
          {link && (
            <a className="li-uac-prop-btn" href={link} target="_blank" rel="noopener noreferrer">
              View questionnaire →
            </a>
          )}
        </>
      }
      footer={
        approveError ? (
          <div role="alert" className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
            {approveError}
          </div>
        ) : undefined
      }
    >
      {current.summary && <div className="li-uac-prop-summary">{current.summary}</div>}

      {/* BUILDER-UX-1 WP-2.1 (kept): every field listed under its section — now
          in the comp's sections preview (uppercase title + gold-dot items). */}
      <ProposalSections
        sections={sections.map((s, si) => ({
          title: s.title || s.id || `Section ${si + 1}`,
          items: (s.fields ?? []).map((f, fi) => (
            <span key={f.id ?? fi}>
              {fieldLabel(f)}
              {f.internal ? <span className="text-muted"> (you fill in review)</span> : null}
            </span>
          )),
        }))}
      />

      {/* The variable contract — a token with no field renders [[MISSING]]. Only the
          actionable GAP is shown; the positive "no gaps" outro (WP-2.2 redundant
          second blurb) is removed — the section list above already says what it
          collects. */}
      {missing.length > 0 && (
        <div role="alert" className="alert alert-warn" style={{ fontSize: 'var(--text-xs)' }}>
          Doesn&rsquo;t yet collect {missing.length} thing{missing.length === 1 ? '' : 's'} the
          document needs: <strong>{missing.map((m) => fieldLabel({ id: m })).join(', ')}</strong>.
          The document would leave {missing.length === 1 ? 'it' : 'them'} blank until added.
        </div>
      )}
      {editing && (
        // BUILDER-UX-1 WP-4: the REAL questionnaire builder in a pop-up (no JSON
        // textarea). Pre-approval, Save updates the CARD (the attorney's version) —
        // nothing is written until Approve. POST-approval (BUILDER-UX-2 WP-2), the
        // same editor persists to the service's saved intake questionnaire through
        // legal.service.questionnaire.update — the questionnaire tab's write path.
        <QuestionnaireEditorModal
          title={
            approveState === 'approved'
              ? `Edit questionnaire — ${current.serviceKey}`
              : `Edit proposed questionnaire — ${current.serviceKey}`
          }
          initialSchema={(editSeedSchema ?? current.schema ?? { sections: [] }) as ProposalSchema}
          name={(current.schema as ProposalSchema)?.title ?? current.serviceKey}
          regenerateTargetId={current.serviceKey}
          onSave={async (schema) => {
            if (approveState === 'approved') {
              await callAttorneyMcp({
                toolName: 'legal.service.questionnaire.update',
                input: { serviceKey: current.serviceKey, intakeSchema: schema },
              })
            }
            setCurrent((c) => ({ ...c, schema }))
            onEdited?.(
              approveState === 'approved'
                ? `questionnaire for "${current.serviceKey}" (saved)`
                : `questionnaire for "${current.serviceKey}"`,
            )
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </ProposalCardShell>
  )
}
