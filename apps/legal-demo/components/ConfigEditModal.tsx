'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from '@/components/Modal'
import { readDevSession } from '@/lib/auth'
import { SparklesIcon, CheckIcon, EditIcon } from '@/components/icons'

// UI-BUILDER-FIX-1 Phase 9 — THE shared edit-in-modal shell. Templates,
// workflows, questionnaires, and billing configs all edit through this ONE
// component (wrapping the existing Modal primitive): view ⇄ edit, AI-regenerate
// (prompt → legal.config.regenerate worker_job → poll → proposal preview),
// save, and approve — without navigating away. Type-specific rendering comes in
// as renderView/renderEdit; type-specific persistence as onSave/onApprove.
export type ConfigArtifactKind = 'template' | 'questionnaire' | 'workflow' | 'billing'

const POLL_MS = 2_500
const POLL_LIMIT = 120 // ≈5 minutes of polling before we call it stuck

export interface ConfigEditModalProps {
  artifactKind: ConfigArtifactKind
  targetId: string
  title: ReactNode
  // The current artifact, serialized (template html/markdown; JSON for the rest).
  initialContent: string
  renderView: (content: string) => ReactNode
  renderEdit: (content: string, onChange: (next: string) => void) => ReactNode
  // Persist the content. Where a type distinguishes saving from approving (the
  // live write), pass both; with onApprove omitted the single button reads
  // "Save & approve" and onSave IS the live write.
  onSave: (content: string) => Promise<void>
  onApprove?: (content: string) => Promise<void>
  // WP-H: the AI-regenerate rail targets a SAVED artifact (config.regenerate by
  // targetId); a wizard PROPOSAL has no saved target yet, so proposal editors
  // pass false to hide the rail. Default true (the saved-artifact surfaces).
  aiRegenerate?: boolean
  // Label for the single-button save (default "Save & approve"). Proposal
  // editors pass "Save" — saving updates the CARD; Approve stays on the card.
  saveLabel?: string
  onClose: () => void
  // Fired after a successful save/approve so the surface can reload its list.
  onChanged?: () => void
}

export function ConfigEditModal(props: ConfigEditModalProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [content, setContent] = useState(props.initialContent)
  const [busy, setBusy] = useState<'save' | 'approve' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)

  // AI-regenerate rail: prompt → enqueue → poll → proposal preview → use/discard.
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [proposal, setProposal] = useState<string | null>(null)
  const pollGen = useRef(0)

  useEffect(() => () => void pollGen.current++, []) // cancel polls on unmount

  // Phase 10: surface a PENDING rebuild proposal for this artifact on open (e.g.
  // the questionnaire rebuild a template edit enqueued). Best-effort read.
  useEffect(() => {
    let cancelled = false
    const headers: Record<string, string> = {}
    if (process.env.NODE_ENV !== 'production') {
      const dev = readDevSession()
      if (dev) {
        headers['x-actor-id'] = dev.actorId
        headers['x-tenant-id'] = dev.tenantId
      }
    }
    fetch(
      `/api/attorney/config/regenerate?artifactKind=${encodeURIComponent(props.artifactKind)}&targetId=${encodeURIComponent(props.targetId)}`,
      { headers, credentials: 'same-origin' },
    )
      .then((r) => r.json())
      .then((body: { result?: { ok?: boolean; proposed?: string } | null }) => {
        if (!cancelled && body?.result?.ok && typeof body.result.proposed === 'string') {
          setProposal(body.result.proposed)
        }
      })
      .catch(() => {
        /* no pending proposal — nothing to surface */
      })
    return () => {
      cancelled = true
    }
  }, [props.artifactKind, props.targetId])

  function devHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (process.env.NODE_ENV !== 'production') {
      const dev = readDevSession()
      if (dev) {
        headers['x-actor-id'] = dev.actorId
        headers['x-tenant-id'] = dev.tenantId
      }
    }
    return headers
  }

  async function regenerate() {
    const prompt = aiPrompt.trim()
    if (!prompt || aiBusy) return
    setAiBusy(true)
    setError(null)
    setProposal(null)
    const gen = ++pollGen.current
    try {
      const res = await fetch('/api/attorney/config/regenerate', {
        method: 'POST',
        headers: devHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({
          artifactKind: props.artifactKind,
          targetId: props.targetId,
          prompt,
          current: content,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        requestId?: string
        error?: string
      } | null
      if (!res.ok || !data?.requestId)
        throw new Error(data?.error || `Enqueue failed (${res.status})`)
      // Poll the worker's outcome event. Generation runs OFF-REQUEST; the modal
      // just waits for the proposal to land.
      for (let i = 0; i < POLL_LIMIT; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        if (pollGen.current !== gen) return // superseded/unmounted
        const poll = await fetch(
          `/api/attorney/config/regenerate?requestId=${encodeURIComponent(data.requestId)}`,
          { headers: devHeaders(), credentials: 'same-origin' },
        )
        const body = (await poll.json().catch(() => null)) as {
          result?: { ok: boolean; proposed?: string; errors?: string[] } | null
        } | null
        const result = body?.result
        if (!result) continue
        if (!result.ok) {
          throw new Error(result.errors?.join('; ') || 'Regeneration failed.')
        }
        setProposal(result.proposed ?? '')
        return
      }
      throw new Error('Regeneration is taking too long — check the worker and try again.')
    } catch (e) {
      if (pollGen.current === gen) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (pollGen.current === gen) setAiBusy(false)
    }
  }

  async function persist(kind: 'save' | 'approve') {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'approve' && props.onApprove) await props.onApprove(content)
      else await props.onSave(content)
      setSavedFlash(kind === 'approve' ? 'Approved' : 'Saved')
      props.onChanged?.()
      setTimeout(() => setSavedFlash(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title={props.title} onClose={props.onClose} size="wide">
      <div className="li-modal-seg-row">
        <button
          type="button"
          className={`li-modal-seg${mode === 'view' ? ' is-active' : ''}`}
          onClick={() => setMode('view')}
        >
          View
        </button>
        <button
          type="button"
          className={`li-modal-seg${mode === 'edit' ? ' is-active' : ''}`}
          onClick={() => setMode('edit')}
        >
          <EditIcon size={14} /> Edit
        </button>
        {props.aiRegenerate !== false && (
          <button
            type="button"
            className="li-modal-seg"
            onClick={() => setAiOpen((v) => !v)}
            aria-expanded={aiOpen}
          >
            <SparklesIcon size={14} /> AI regenerate
          </button>
        )}
        <span style={{ flex: 1 }} />
        {savedFlash && (
          <span className="li-modal-muted" role="status">
            <CheckIcon size={13} /> {savedFlash}
          </span>
        )}
      </div>

      {aiOpen && (
        <form
          style={{ display: 'flex', gap: 6, marginBottom: 10 }}
          onSubmit={(e) => {
            e.preventDefault()
            void regenerate()
          }}
        >
          <input
            type="text"
            className="li-modal-input"
            style={{ flex: 1 }}
            placeholder="What should change? The AI regenerates against the current version."
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            disabled={aiBusy}
          />
          <button
            type="submit"
            className="li-modal-btn-ghost"
            disabled={aiBusy || !aiPrompt.trim()}
          >
            {aiBusy ? 'Working…' : 'Regenerate'}
          </button>
        </form>
      )}

      {proposal !== null && (
        <div className="li-modal-proposal">
          <div className="li-modal-proposal-head">
            <strong>AI proposal</strong>
            <span className="li-modal-muted">review, then use it or discard</span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="li-modal-btn-ghost"
              onClick={() => {
                setContent(proposal)
                setProposal(null)
                setMode('edit')
              }}
            >
              Use this
            </button>
            <button type="button" className="li-modal-btn-ghost" onClick={() => setProposal(null)}>
              Discard
            </button>
          </div>
          {props.renderView(proposal)}
        </div>
      )}

      {mode === 'view' ? props.renderView(content) : props.renderEdit(content, setContent)}

      {error && (
        <div role="alert" className="li-modal-alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        {props.onApprove ? (
          <>
            <button
              type="button"
              className="li-modal-btn-ghost"
              onClick={() => void persist('save')}
              disabled={busy !== null}
            >
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="li-modal-btn-primary"
              onClick={() => void persist('approve')}
              disabled={busy !== null}
            >
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="li-modal-btn-primary"
            onClick={() => void persist('save')}
            disabled={busy !== null}
          >
            {busy === 'save' ? 'Saving…' : (props.saveLabel ?? 'Save & approve')}
          </button>
        )}
      </div>
    </Modal>
  )
}
