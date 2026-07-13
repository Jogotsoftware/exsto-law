'use client'

// BUILDER-UX-2 WP-2 — the "Edit with AI" rail, extracted from ConfigEditModal so the
// REAL per-artifact editor modals keep the AI affordance without the prohibited
// View/Edit shell. Prompt → enqueue legal.config.regenerate (worker_job, OFF-request)
// → poll → proposed replacement → Use/Discard. The worker regenerates AGAINST the
// serialized `current` the host passes (content-based — targetId is correlation), so
// the rail works on wizard PROPOSALS (targetId "proposal:…") and saved artifacts alike.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { readDevSession } from '@/lib/auth'
import { SparklesIcon } from '@/components/icons'

export type RegenArtifactKind = 'template' | 'questionnaire' | 'workflow' | 'billing'

const POLL_MS = 2_500
const POLL_LIMIT = 120 // ≈5 minutes of polling before we call it stuck

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

export function AiRegenerateRail({
  artifactKind,
  targetId,
  current,
  renderProposal,
  onUse,
}: {
  artifactKind: RegenArtifactKind
  targetId: string
  // The CURRENT artifact serialized (template markdown; JSON for the rest) — read
  // fresh per regenerate so mid-edit state is what the AI revises.
  current: () => string
  // Render the proposed replacement for review (same renderer the editor's view uses).
  renderProposal: (proposed: string) => ReactNode
  // Apply the proposal into the live editor. Throw to surface a parse error inline.
  onUse: (proposed: string) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollGen = useRef(0)
  useEffect(() => () => void pollGen.current++, []) // cancel polls on unmount

  // Surface a PENDING regeneration for this artifact on mount (ConfigEditModal's
  // Phase-10 behavior, kept through the extraction): a regeneration that completed
  // while the editor was closed — or on another surface — is offered here instead
  // of being orphaned. Best-effort read.
  useEffect(() => {
    let cancelled = false
    fetch(
      `/api/attorney/config/regenerate?artifactKind=${encodeURIComponent(artifactKind)}&targetId=${encodeURIComponent(targetId)}`,
      { headers: devHeaders(), credentials: 'same-origin' },
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
  }, [artifactKind, targetId])

  async function regenerate() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    setError(null)
    setProposal(null)
    const gen = ++pollGen.current
    try {
      const res = await fetch('/api/attorney/config/regenerate', {
        method: 'POST',
        headers: devHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({ artifactKind, targetId, prompt: p, current: current() }),
      })
      const data = (await res.json().catch(() => null)) as {
        requestId?: string
        error?: string
      } | null
      if (!res.ok || !data?.requestId)
        throw new Error(data?.error || `Enqueue failed (${res.status})`)
      let consecutiveHttpErrors = 0
      for (let i = 0; i < POLL_LIMIT; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        if (pollGen.current !== gen) return // superseded/unmounted
        const poll = await fetch(
          `/api/attorney/config/regenerate?requestId=${encodeURIComponent(data.requestId)}`,
          { headers: devHeaders(), credentials: 'same-origin' },
        )
        const body = (await poll.json().catch(() => null)) as {
          result?: { ok: boolean; proposed?: string; errors?: string[] } | null
          error?: string
        } | null
        // A failing poll is an ERROR, not a pending state — surface it instead of
        // silently retrying for five minutes and misreporting a timeout. Auth/
        // not-found fail immediately; transient 5xx gets three tries.
        if (!poll.ok) {
          if (poll.status === 401 || poll.status === 403 || poll.status === 404) {
            throw new Error(body?.error || `Regeneration status check failed (${poll.status}).`)
          }
          consecutiveHttpErrors += 1
          if (consecutiveHttpErrors >= 3) {
            throw new Error(body?.error || `Regeneration status check failed (${poll.status}).`)
          }
          continue
        }
        consecutiveHttpErrors = 0
        const result = body?.result
        if (!result) continue
        if (!result.ok) throw new Error(result.errors?.join('; ') || 'Regeneration failed.')
        setProposal(result.proposed ?? '')
        return
      }
      throw new Error('Regeneration is taking too long — check the worker and try again.')
    } catch (e) {
      if (pollGen.current === gen) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (pollGen.current === gen) setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button"
        className="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <SparklesIcon size={14} /> Edit with AI
      </button>
      {open && (
        <form
          style={{ display: 'flex', gap: 6, marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault()
            void regenerate()
          }}
        >
          <input
            type="text"
            className="input"
            style={{ flex: 1 }}
            placeholder="What should change? The AI revises the current version."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="button" disabled={busy || !prompt.trim()}>
            {busy ? 'Working…' : 'Regenerate'}
          </button>
        </form>
      )}
      {error && (
        <div role="alert" className="alert alert-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {proposal !== null && (
        <div
          style={{
            border: '1px solid var(--border, rgba(127,127,127,0.35))',
            borderRadius: 8,
            padding: 10,
            marginTop: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <strong>AI proposal</strong>
            <span className="text-muted text-sm">review, then use it or discard</span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="button"
              onClick={() => {
                try {
                  onUse(proposal)
                  setProposal(null)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              Use this
            </button>
            <button type="button" className="button" onClick={() => setProposal(null)}>
              Discard
            </button>
          </div>
          {renderProposal(proposal)}
        </div>
      )}
    </div>
  )
}
