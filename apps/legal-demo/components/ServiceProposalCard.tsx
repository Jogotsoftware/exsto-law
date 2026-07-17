'use client'

import { useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { ServiceEditorModal } from '@/components/ServiceEditorModal'
import { ProposalCardShell, ProposalFacts } from '@/components/ProposalCardShell'
import { CheckIcon, EditIcon } from '@/components/icons'

// CONSTRAINT (mirrors WorkflowProposalCard): no server-package imports. This shape
// is a structural mirror of verticals/legal/src/api/serviceAuthoring.ts's
// ServiceProposal — the chat receives it over SSE as plain JSON.
export interface ServiceProposal {
  displayName: string
  derivedKey: string
  description: string | null
  // Client-facing tile copy (UI-BUILDER-FIX-1 Phase 2): outcome-only, <=70 chars.
  clientDisplayName?: string | null
  clientDescription?: string | null
  // BUILDER-UX-2 WP-7 — the wizard-authored Spanish tile copy (falls back to English
  // on the Spanish intake when absent).
  clientDisplayNameEs?: string | null
  clientDescriptionEs?: string | null
  route: 'auto' | 'manual'
  generationMode: 'template_merge' | 'ai_draft'
  // BUILDER-CERT-1 (WP3) — booking mode: true = booking opens with a consultation
  // slot; false = intake-only (document-review). Forwarded on approve.
  appointmentRequired?: boolean
  summary: string
  confidence: number
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// Fired on a SUCCESSFUL approve so the chat can continue the guided build (Phase 6):
// it carries the artifact label + the link to it + the serviceKey so the chat can show
// "View … →" AND auto-send a continuation turn. Shared by every proposal card.
export type OnApproved = (info: {
  artifact: string
  link: string
  serviceKey: string
  label: string
}) => void

// The inline approval card for an AI-proposed NEW service (Build-Wizard Phase 1). It
// is the HUMAN GATE: the proposing chat turn wrote nothing; clicking Approve POSTs
// the proposal to the create-from-ai route, which is the only place the version-1
// (disabled) service is created. Visual style mirrors WorkflowProposalCard.
export function ServiceProposalCard({
  proposal,
  onApproved,
  onEdited,
}: {
  proposal: ServiceProposal
  onApproved?: OnApproved
  // WP-H: fired after the attorney edits the proposal in the pop-up editor.
  onEdited?: (note: string) => void
}) {
  const [approveState, setApproveState] = useState<'idle' | 'approving' | 'approved' | 'error'>(
    'idle',
  )
  // WP-H: the card's CURRENT shell — the proposal until the attorney edits it;
  // Approve always captures this (the attorney's version).
  const [current, setCurrent] = useState<ServiceProposal>(proposal)
  const [editing, setEditing] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  // WP-7 — the SAVED locale map from the freshest read, so a post-approval save
  // merges the es entry over OTHER locales instead of wiping them.
  const [savedI18n, setSavedI18n] = useState<Record<
    string,
    { displayName?: string; description?: string }
  > | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [serviceKey, setServiceKey] = useState<string | null>(null)
  // The link to the created service, returned by the approve route — shown as
  // "View service →" and handed to onApproved for the auto-continuation.
  const [link, setLink] = useState<string | null>(null)

  // Post-approval Edit seeds from the SAVED service, not the card's frozen snapshot —
  // an edit made meanwhile on the Settings tab must show up here, not get silently
  // reverted by Save. The fresh read lands in `current` so the card re-renders too.
  async function openEditor() {
    if (approveState === 'approved' && serviceKey) {
      setEditLoading(true)
      try {
        const r = await callAttorneyMcp<{
          service: {
            displayName: string
            description: string | null
            clientDisplayName: string | null
            clientDescription: string | null
            clientCopyI18n: Record<string, { displayName?: string; description?: string }> | null
            route: 'auto' | 'manual'
            generationMode: 'template_merge' | 'ai_draft'
            appointmentRequired: boolean
          } | null
        }>({ toolName: 'legal.service.get', input: { serviceKey } })
        if (r.service) {
          const svc = r.service
          setSavedI18n(svc.clientCopyI18n ?? null)
          setCurrent((c) => ({
            ...c,
            displayName: svc.displayName,
            description: svc.description,
            clientDisplayName: svc.clientDisplayName,
            clientDescription: svc.clientDescription,
            clientDisplayNameEs: svc.clientCopyI18n?.es?.displayName ?? null,
            clientDescriptionEs: svc.clientCopyI18n?.es?.description ?? null,
            route: svc.route,
            generationMode: svc.generationMode,
            appointmentRequired: svc.appointmentRequired,
          }))
        }
      } catch {
        /* read failure: the card's copy is the best seed we have */
      } finally {
        setEditLoading(false)
      }
    }
    setEditing(true)
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
      const res = await fetch('/api/attorney/services/create-from-ai', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({
          displayName: current.displayName,
          description: current.description,
          clientDisplayName: current.clientDisplayName ?? null,
          clientDescription: current.clientDescription ?? null,
          clientDisplayNameEs: current.clientDisplayNameEs ?? null,
          clientDescriptionEs: current.clientDescriptionEs ?? null,
          route: current.route,
          generationMode: current.generationMode,
          ...(typeof current.appointmentRequired === 'boolean'
            ? { appointmentRequired: current.appointmentRequired }
            : {}),
          summary: current.summary,
          confidence: current.confidence,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        result?: { serviceKey?: string }
        serviceKey?: string
        link?: string
        label?: string
        error?: string
      } | null
      if (!res.ok) throw new Error(data?.error || `Approve failed (${res.status})`)
      const key = data?.serviceKey ?? data?.result?.serviceKey ?? null
      setServiceKey(key)
      setLink(data?.link ?? null)
      setApproveState('approved')
      // Drive the build forward: tell the chat the service is created (with its link)
      // so it auto-continues to the next step. Fires once (approve is disabled after).
      if (key && data?.link) {
        onApproved?.({
          artifact: 'service',
          link: data.link,
          serviceKey: key,
          label: data.label || `Service "${current.displayName}"`,
        })
      }
    } catch (e) {
      setApproveState('error')
      setApproveError(e instanceof Error ? e.message : String(e))
    }
  }

  // BUILDER-UX-1 WP-1.2 (kept): the two copies stay LABELED — "Client sees" (the
  // public booking tile) vs "Internal" — now as comp facts-grid cells (WP-L).
  const facts: Array<{ label: string; value: React.ReactNode }> = []
  if (current.clientDisplayName || current.clientDescription) {
    facts.push({
      label: 'Client sees',
      value: `${current.clientDisplayName ?? ''}${
        current.clientDescription ? ` — ${current.clientDescription}` : ''
      }`,
    })
  }
  if (current.clientDisplayNameEs || current.clientDescriptionEs) {
    facts.push({
      label: 'Client sees (Español)',
      value: `${current.clientDisplayNameEs ?? ''}${
        current.clientDescriptionEs ? ` — ${current.clientDescriptionEs}` : ''
      }`,
    })
  }
  if (current.description) facts.push({ label: 'Internal', value: current.description })
  facts.push({ label: 'Route', value: current.route === 'auto' ? 'Automatic' : 'Manual' })
  facts.push({
    label: 'Documents',
    value: current.generationMode === 'ai_draft' ? 'AI draft' : 'Template merge',
  })

  return (
    <ProposalCardShell
      kind="New service"
      title={current.displayName}
      meta={`key: ${current.derivedKey}`}
      actions={
        <>
          <button
            type="button"
            className={`li-uac-prop-btn primary${approveState === 'approved' ? ' done' : ''}`}
            onClick={approve}
            disabled={approveState === 'approving' || approveState === 'approved'}
            title="Approve this service — this creates the (disabled) service"
          >
            <CheckIcon size={14} />{' '}
            {approveState === 'approving'
              ? 'Creating…'
              : approveState === 'approved'
                ? serviceKey
                  ? `Created (${serviceKey})`
                  : 'Created'
                : 'Approve'}
          </button>
          <button
            type="button"
            className="li-uac-prop-btn"
            onClick={() => void openEditor()}
            disabled={
              approveState === 'approving' ||
              editLoading ||
              (approveState === 'approved' && !serviceKey)
            }
            title={
              approveState === 'approved'
                ? 'Edit the created service — saves a new version'
                : 'Edit the proposed service shell before approving'
            }
          >
            <EditIcon size={14} /> {editLoading ? 'Loading…' : 'Open & edit'}
          </button>
          {link && (
            <a className="li-uac-prop-btn" href={link} target="_blank" rel="noopener noreferrer">
              View service →
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
      <ProposalFacts facts={facts} />
      {/* Set expectations: a created service starts disabled until it's completed. */}
      <div className="li-uac-prop-note">
        Created disabled — finish setting it up, then enable it.
      </div>
      {editing && (
        <ServiceEditorModal
          title={
            approveState === 'approved'
              ? `Edit service — ${current.displayName}`
              : `Edit proposed service — ${current.displayName}`
          }
          initialValue={{
            displayName: current.displayName,
            route: current.route,
            clientDisplayName: current.clientDisplayName ?? '',
            clientDescription: current.clientDescription ?? '',
            clientDisplayNameEs: current.clientDisplayNameEs ?? '',
            clientDescriptionEs: current.clientDescriptionEs ?? '',
            description: current.description ?? '',
            generationMode: current.generationMode,
            appointmentRequired: current.appointmentRequired ?? true,
          }}
          onSave={async (next) => {
            if (approveState === 'approved' && serviceKey) {
              // Post-approval: persist to the CREATED service (a new immutable version
              // through legal.service.update — the same write the settings page does).
              await callAttorneyMcp({
                toolName: 'legal.service.update',
                input: {
                  serviceKey,
                  displayName: next.displayName,
                  description: next.description || null,
                  clientDisplayName: next.clientDisplayName || null,
                  clientDescription: next.clientDescription || null,
                  // WP-7: merge the es entry over the SAVED locale map (other
                  // locales survive); clearing both es inputs drops only es.
                  clientCopyI18n: (() => {
                    const rest = Object.fromEntries(
                      Object.entries(savedI18n ?? {}).filter(([k]) => k !== 'es'),
                    )
                    if (next.clientDisplayNameEs || next.clientDescriptionEs) {
                      rest.es = {
                        ...(next.clientDisplayNameEs
                          ? { displayName: next.clientDisplayNameEs }
                          : {}),
                        ...(next.clientDescriptionEs
                          ? { description: next.clientDescriptionEs }
                          : {}),
                      }
                    }
                    return Object.keys(rest).length ? rest : null
                  })(),
                  route: next.route,
                  generationMode: next.generationMode,
                  appointmentRequired: next.appointmentRequired,
                },
              })
            }
            // Either way the card re-renders with the attorney's version.
            setCurrent((c) => ({
              ...c,
              displayName: next.displayName,
              route: next.route,
              clientDisplayName: next.clientDisplayName || null,
              clientDescription: next.clientDescription || null,
              clientDisplayNameEs: next.clientDisplayNameEs || null,
              clientDescriptionEs: next.clientDescriptionEs || null,
              description: next.description || null,
              generationMode: next.generationMode,
              appointmentRequired: next.appointmentRequired,
            }))
            onEdited?.(
              approveState === 'approved' && serviceKey
                ? `service shell "${next.displayName}" (saved)`
                : `service shell "${current.displayName}"`,
            )
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </ProposalCardShell>
  )
}
