'use client'

// Brief engine WP2/WP3 — the Brief door (design: docs/design/briefs/DESIGN.md
// §6: "Shared <BriefButton scope target/> + <BriefModal/>"). A plain button
// that opens the BriefModal. `scope` is the one thing that differs between
// homes — the matter header (WP2) and the CRM client detail (WP3) pass a
// different target and get the matter-flavored or client-flavored copy/tool
// calls for free.
//
// B2.2 (MATTER-BRIEF-BACKGROUND-1) — MATTER scope only: this component now owns
// the background generate lifecycle (mount read, enqueue via
// legal.matter.brief.request, poll legal.matter.brief.get) instead of leaving
// all state to the modal. That's what makes the button itself three-state
// ("Generate Brief" / "Matter Brief" / "Generating…") and lets a poll survive
// the modal being closed — this component lives in the matter layout, which
// stays mounted across tab navigation within a matter, so the poll (and the
// completion pulse) keep running in the background either way. CLIENT scope is
// completely unchanged: no mount read, plain button, BriefModal keeps its own
// original synchronous get-on-open / generate-on-click.
import { useCallback, useEffect, useRef, useState } from 'react'
import { SparklesIcon } from '@/components/icons'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import {
  BriefModal,
  type BriefReadResult,
  type BriefScope,
  type MatterBriefController,
} from '@/components/BriefModal'

// Poll interval + attempts for a background brief landing off the worker — the
// same budget the workflow runner uses for its own worker polls
// (RunnerReview.tsx POLL_MS/POLL_TRIES). Honest: we poll the real read; we
// never animate fake progress.
const POLL_MS = 3500
const POLL_TRIES = 40 // ~2.3 min — model synthesis budget
const PULSE_MS = 2200

export function BriefButton({
  scope,
  className,
  label,
  lazy,
}: {
  scope: BriefScope
  // Homes style this differently (li-brief-btn beside the matter Actions menu
  // vs li-crm-btn beside CRM's Email/Schedule/Edit) — default to li-brief-btn.
  className?: string
  label?: string
  // List homes (the review queue renders one button PER ROW) skip the on-mount
  // brief.get read — N rows must not fire N MCP reads on page load. The first
  // click does the read, then opens or generates exactly like the eager path.
  lazy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const isMatter = scope.kind === 'matter'
  const matterEntityId = scope.kind === 'matter' ? scope.matterEntityId : null
  const defaultLabel = isMatter ? 'Matter Brief' : 'Client Brief'
  const title = isMatter
    ? 'The synthesized brief of everything on this matter'
    : 'The synthesized brief of this client and every one of their matters'

  // ── Matter-scope background lifecycle (B2.2) ────────────────────────────────
  const [matterState, setMatterState] = useState<BriefReadResult | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [justCompleted, setJustCompleted] = useState(false)
  const pollRef = useRef<{ cancelled: boolean } | null>(null)
  const pulseTimerRef = useRef<number | null>(null)

  // Read on mount so the button's own label is right before anyone opens
  // anything — this is a pure read (legal.matter.brief.get never generates).
  useEffect(() => {
    if (!matterEntityId || lazy) return
    let cancelled = false
    callAttorneyMcp<BriefReadResult>({
      toolName: 'legal.matter.brief.get',
      input: { matterEntityId },
    })
      .then((r) => {
        if (!cancelled) setMatterState(r)
      })
      .catch(() => {
        // Fall back to the quiet label; the modal's own error state (via
        // matterController below) surfaces anything real once opened.
      })
    return () => {
      cancelled = true
    }
  }, [matterEntityId])

  const pollForBrief = useCallback(
    async (startGeneratedAt: string | null) => {
      if (!matterEntityId) return
      if (pollRef.current) pollRef.current.cancelled = true
      const token = { cancelled: false }
      pollRef.current = token
      for (let i = 0; i < POLL_TRIES; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        if (token.cancelled) return
        const r = await callAttorneyMcp<BriefReadResult>({
          toolName: 'legal.matter.brief.get',
          input: { matterEntityId },
        }).catch(() => null)
        const landedAt = r?.brief?.generatedAt ?? null
        if (r && landedAt && landedAt !== startGeneratedAt) {
          if (token.cancelled) return
          setMatterState(r)
          setGenerating(false)
          setJustCompleted(true)
          if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
          pulseTimerRef.current = window.setTimeout(() => setJustCompleted(false), PULSE_MS)
          return
        }
      }
      if (!token.cancelled) {
        setGenerating(false)
        setGenError(
          'Still generating — this can take a couple of minutes for a large matter. Check back shortly.',
        )
      }
    },
    [matterEntityId],
  )

  const startGenerate = useCallback(
    (force: boolean) => {
      if (!matterEntityId || generating) return
      const startGeneratedAt = matterState?.brief?.generatedAt ?? null
      setGenerating(true)
      setGenError(null)
      setJustCompleted(false)
      callAttorneyMcp({
        toolName: 'legal.matter.brief.request',
        input: { matterEntityId, force },
      })
        .then(() => pollForBrief(startGeneratedAt))
        .catch((e) => {
          setGenerating(false)
          setGenError(e instanceof Error ? e.message : String(e))
        })
    },
    [matterEntityId, generating, matterState, pollForBrief],
  )

  useEffect(() => {
    return () => {
      if (pollRef.current) pollRef.current.cancelled = true
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
    }
  }, [])

  const hasNoBriefYet = isMatter && matterState !== null && matterState.brief === null

  // PO-1 (founder product-walk 2026-07-20): clicking Generate must never open
  // the modal into a loading state — the button's own "Generating…" pill IS
  // the loading UX. First run (no brief exists yet): kick off the background
  // generate and stay closed; the modal opens only once a finished brief
  // exists — a later click, once the label flips off "Generate Brief". No
  // auto-open is added here: pollForBrief only updates matterState, it never
  // calls setOpen itself, so landing a brief while the attorney is elsewhere
  // on the page still requires a click, same as before this fix.
  function handleClick() {
    // Lazy home, state unknown: do the skipped mount read now, then route the
    // click exactly like the eager path would have.
    if (isMatter && lazy && matterState === null && !generating && matterEntityId) {
      setGenerating(true)
      callAttorneyMcp<BriefReadResult>({
        toolName: 'legal.matter.brief.get',
        input: { matterEntityId },
      })
        .then((r) => {
          setGenerating(false)
          setMatterState(r)
          if (r.brief === null) startGenerate(false)
          else setOpen(true)
        })
        .catch((e) => {
          setGenerating(false)
          setGenError(e instanceof Error ? e.message : String(e))
        })
      return
    }
    if (hasNoBriefYet) {
      if (!generating) startGenerate(false)
      return
    }
    setOpen(true)
  }

  const buttonLabel = generating
    ? 'Generating…'
    : (label ?? (hasNoBriefYet ? 'Generate Brief' : defaultLabel))

  const buttonClass =
    (className ??
      (hasNoBriefYet && !generating ? 'li-brief-btn li-brief-btn--primary' : 'li-brief-btn')) +
    (justCompleted ? ' li-brief-btn--pulse' : '')

  const matterController: MatterBriefController | undefined = isMatter
    ? {
        state: matterState,
        generating,
        error: genError,
        justCompleted,
        onGenerate: startGenerate,
      }
    : undefined

  return (
    <>
      <button type="button" className={buttonClass} onClick={handleClick} title={title}>
        {generating ? <span className="spinner" /> : <SparklesIcon size={15} />}
        {buttonLabel}
      </button>
      {open && (
        <BriefModal
          scope={scope}
          onClose={() => setOpen(false)}
          matterController={matterController}
        />
      )}
    </>
  )
}
