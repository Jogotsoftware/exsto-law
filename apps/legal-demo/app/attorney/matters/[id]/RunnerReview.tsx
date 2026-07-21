'use client'

// The workflow runner's flagship surface (WORKFLOW-RUNNER-1 WP2): the FULL review
// — document + Edit + Regenerate + Approve — lives inside the step's pop-up.
// Opening the step IS opening the review; there is no intermediate confirm and no
// navigation to /attorney/review. B2.1 (DOCUMENTREVIEWER-UNIFY-1): the review
// itself is now the SAME <DocumentReviewer> the standalone /attorney/review
// reader uses — same toolbar (Edit / Share ▾ / eSign / Matter context + Reject /
// AI Revision / Approve), tracked-changes Edit/AI-revision, Approve/Reject
// (unified on MCP legal.draft.approve/reject). This file keeps only what's
// specific to running inside a workflow step: the producing/spinner/failed
// states before a draft exists (#414), and the stage-level full-redraft-with-
// notes "Regenerate from scratch" capability (worker-driven, distinct from
// DocumentReviewer's in-place Edit/AI revision — Contract W only, per
// RUNNER-FIXES-1 WP5). WF-RUNNER-TOOLBAR-1 removed this file's own standalone
// "Regenerate…" toolbar button + subpanel — the call + poll-for-landing still
// live here (only the runner has the stage context the route needs), but the
// entry point is now the AI-revision editor's "Regenerate from scratch" option
// (onRegenerateFromScratch, threaded through DocumentReviewer).
import { useCallback, useEffect, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Modal } from '@/components/Modal'
import { ConfirmModal } from '@/components/ConfirmModal'
import { DocumentReviewer } from '@/components/DocumentReviewer'
import { acceptClientStep, regenerateStep, skipStep, completeMatter } from '@/lib/stepRunner'
import { humanizeService, type MatterDetail, type WfStage } from './shared'

// Poll interval + attempts for a draft landing off the worker (regenerate, or the
// auto-run producing capability on stage entry). Honest: we poll the real read;
// we never animate fake progress.
const POLL_MS = 3500
const POLL_TRIES = 40 // ~2.3 min — model drafting budget

export function RunnerReview({
  matter,
  stage,
  isCurrent,
  producing,
  onChanged,
  onClose,
  advanceFooter,
  waitsNote,
}: {
  matter: MatterDetail
  stage: WfStage
  isCurrent: boolean
  // True when this stage produces a document (generate_document, or an
  // invoke_capability document_generation) — so a not-yet-drafted current stage is
  // shown as "running on the worker" rather than an empty confirm box.
  producing: boolean
  onChanged: () => Promise<void>
  onClose: () => void
  advanceFooter?: React.ReactNode
  waitsNote?: React.ReactNode
}) {
  const versionId = matter.latestDraftVersionId

  // ── Worker polling (regenerate / auto-run producing capability) ─────────────
  // 'running' means a draft is being produced off-request on the worker. We watch
  // the real read for a NEW version id (regenerate supersedes; first draft appears)
  // and reload the matter when it lands. No simulated progress.
  const [phase, setPhase] = useState<'idle' | 'running' | 'timeout'>('idle')
  const [phaseErr, setPhaseErr] = useState<string | null>(null)
  const pollRef = useRef<{ cancelled: boolean } | null>(null)

  const pollForNewVersion = useCallback(
    async (startVersionId: string | null) => {
      // Cancel any prior poll before starting a fresh one.
      if (pollRef.current) pollRef.current.cancelled = true
      const token = { cancelled: false }
      pollRef.current = token
      setPhase('running')
      setPhaseErr(null)
      for (let i = 0; i < POLL_TRIES; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        if (token.cancelled) return
        const res = await callAttorneyMcp<{ matter: MatterDetail | null }>({
          toolName: 'legal.matter.get',
          input: { matterEntityId: matter.matterEntityId },
        }).catch(() => null)
        const landed = res?.matter?.latestDraftVersionId ?? null
        if (landed && landed !== startVersionId) {
          if (token.cancelled) return
          await onChanged() // parent reloads → new matter prop → draft re-fetches
          setPhase('idle')
          return
        }
      }
      if (!token.cancelled) setPhase('timeout')
    },
    [matter.matterEntityId, onChanged],
  )

  // A current producing stage with no draft yet: the auto-run is drafting on the
  // worker (CAPABILITY-AUTORUN / RUNTIME-AUTORUN-2). Start watching for it.
  useEffect(() => {
    if (producing && isCurrent && !versionId && phase === 'idle') {
      void pollForNewVersion(null)
    }
    return () => {
      if (pollRef.current) pollRef.current.cancelled = true
    }
    // Intentionally keyed on the stage identity only; pollForNewVersion is stable
    // for a given matter and re-running on its identity would restart the poll.
  }, [producing, isCurrent, versionId])

  // ── Regenerate from scratch (stage-level, worker full redraft with change
  // notes) — the toolbar's old standalone "Regenerate…" button was deleted;
  // this file still owns the actual call + poll-for-landing (only the runner
  // has the matterEntityId + stage.key the stage-scoped regenerate route
  // needs), but the entry point now lives inside DocumentReviewer's AI-revision
  // editor as a "Regenerate from scratch" option (WF-RUNNER-TOOLBAR-1).
  const [notice, setNotice] = useState<string | null>(null)

  const runRegenerateFromScratch = useCallback(
    async (changeNotes: string): Promise<void> => {
      const startVersionId = versionId
      await regenerateStep(matter.matterEntityId, stage.key, { changeNotes })
      setNotice('Re-drafting on the worker — the new version will appear here when it lands.')
      void pollForNewVersion(startVersionId)
    },
    [matter.matterEntityId, stage.key, versionId, pollForNewVersion],
  )

  const footer = (
    <>
      {advanceFooter && <span className="li-modal-foot-spacer" />}
      {advanceFooter}
    </>
  )

  return (
    <Modal title={stage.label} onClose={onClose} size="wide" footer={advanceFooter ? footer : null}>
      {notice && <div className="alert alert-success">{notice}</div>}

      {/* No draft yet ------------------------------------------------------- */}
      {!versionId ? (
        producing && isCurrent ? (
          phase === 'timeout' ? (
            <div className="runner-state failed">
              <div className="runner-state-row">
                <span className="runner-state-title">Drafting didn’t finish in time</span>
              </div>
              <p className="runner-state-detail">
                The document hasn’t landed yet. It may still be running, or the run may have failed.
                {phaseErr ? ` (${phaseErr})` : ''}
              </p>
              <div>
                <button className="primary" onClick={() => void pollForNewVersion(null)}>
                  Keep waiting
                </button>
              </div>
            </div>
          ) : (
            <div className="runner-state running">
              <div className="runner-state-row">
                <span className="spinner" />
                <span className="runner-state-title">Drafting on the worker…</span>
              </div>
              <p className="runner-state-detail">
                This step drafts its document off-request. It appears here the moment it lands — no
                need to leave the matter.
              </p>
            </div>
          )
        ) : (
          <p className="text-muted text-sm">
            No document has been produced for this step yet.
            {producing ? ' It drafts when this step becomes current.' : ''}
          </p>
        )
      ) : (
        // ── The document, via the SAME review surface the queue uses ──────────
        <>
          {phase === 'running' && (
            <div className="runner-state running" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="runner-state-row">
                <span className="spinner" />
                <span className="runner-state-title">Re-drafting on the worker…</span>
              </div>
              <p className="runner-state-detail">
                The current version stays visible below until the new one lands (append-only —
                superseded versions are never deleted).
              </p>
            </div>
          )}
          <DocumentReviewer
            versionId={versionId}
            embedded
            onVersionChanged={() => void onChanged()}
            onCompleted={async (result) => {
              // EDITOR-FIX-1 (item 3): approve advances the workflow — refresh the
              // matter (so the step strip recomputes), then CLOSE this modal so the
              // attorney lands back on the strip with the matter visibly moved (the
              // parent focuses/scrolls the new current step). Returning true tells
              // DocumentReviewer the host handled the aftermath (skip its in-place
              // swap/refresh). Reject does NOT advance — refresh in place and stay
              // open so the rejected status shows.
              await onChanged()
              if (result.disposition === 'approved') {
                onClose()
                return true
              }
              return false
            }}
            onRegenerateFromScratch={runRegenerateFromScratch}
          />
        </>
      )}

      {waitsNote}
    </Modal>
  )
}

// ── invoke_capability (non-producing) status panel ────────────────────────────
// Producing capabilities (document_generation) render through RunnerReview above.
// A capability that yields NO document (e.g. request client materials) is shown as
// an honest status panel: done if the matter has already moved past it, running on
// the worker while it is the current step (auto-run fired on entry), or waiting if
// it is still upcoming. We poll the real matter read for the step to advance — we
// never animate fake progress. WF-FIX-1 (WP6): when the poll exhausts, the panel
// reads the matter history for a recorded capability failure on this stage
// (capability_invoke_failed / capability_run_stalled / capability_run_enqueue_failed)
// and shows an honest FAILED state; either way the attorney gets "Run this step
// again", which re-enqueues through the workflow/invoke route (worker-side
// idempotency makes a duplicate run safe).

const CAPABILITY_FAIL_TAGS = new Set([
  'capability_invoke_failed',
  'capability_run_stalled',
  'capability_run_enqueue_failed',
])

interface HistoryEventEntry {
  eventId: string
  kindName: string
  data: Record<string, unknown>
  occurredAt: string
}

async function readCapabilityFailure(
  matterEntityId: string,
  stageKey: string,
): Promise<string | null> {
  const res = await callAttorneyMcp<{ events?: HistoryEventEntry[] }>({
    toolName: 'legal.matter.history',
    input: { matterEntityId },
  }).catch(() => null)
  const events = res?.events ?? []
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kindName !== 'observation') continue
    const kind = typeof e.data?.kind === 'string' ? e.data.kind : ''
    if (!CAPABILITY_FAIL_TAGS.has(kind)) continue
    const evStage = typeof e.data?.stage === 'string' ? e.data.stage : null
    if (evStage && evStage !== stageKey) continue
    const reason = typeof e.data?.reason === 'string' ? e.data.reason : ''
    return reason || 'The automated step recorded a failure.'
  }
  return null
}

export function CapabilityStatePanel({
  stage,
  matter,
  state,
  onChanged,
  onClose,
  advanceFooter,
  waitsNote,
}: {
  stage: WfStage
  matter: MatterDetail
  state: 'done' | 'current' | 'upcoming'
  onChanged: () => Promise<void>
  onClose: () => void
  advanceFooter?: React.ReactNode
  waitsNote?: React.ReactNode
}) {
  const [stalled, setStalled] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)
  // Bumping attempt restarts the poll loop (Keep watching / Run again).
  const [attempt, setAttempt] = useState(0)
  const pollRef = useRef<{ cancelled: boolean } | null>(null)

  useEffect(() => {
    if (state !== 'current') return
    if (pollRef.current) pollRef.current.cancelled = true
    const token = { cancelled: false }
    pollRef.current = token
    setStalled(false)
    setFailure(null)
    ;(async () => {
      const startState = matter.workflow?.currentState ?? null
      for (let i = 0; i < POLL_TRIES; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        if (token.cancelled) return
        const res = await callAttorneyMcp<{ matter: MatterDetail | null }>({
          toolName: 'legal.matter.get',
          input: { matterEntityId: matter.matterEntityId },
        }).catch(() => null)
        const nowState = res?.matter?.workflow?.currentState ?? null
        if (nowState && nowState !== startState) {
          if (token.cancelled) return
          await onChanged()
          return
        }
      }
      if (!token.cancelled) {
        // Exhausted: before settling on "still running", check the history for a
        // recorded failure on this stage — honesty beats a hopeful spinner.
        const recorded = await readCapabilityFailure(matter.matterEntityId, stage.key)
        if (token.cancelled) return
        setFailure(recorded)
        setStalled(true)
      }
    })()
    return () => {
      token.cancelled = true
    }
    // Keyed on the step becoming current for this matter (+ manual retry); onChanged is stable.
  }, [state, matter.matterEntityId, attempt])

  const runAgain = async (): Promise<void> => {
    setRerunning(true)
    try {
      const res = await fetch(
        `/api/attorney/matters/${encodeURIComponent(matter.matterEntityId)}/workflow/invoke`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setFailure(body?.error ?? 'Could not queue the step to run again.')
        return
      }
      setAttempt((a) => a + 1)
    } finally {
      setRerunning(false)
    }
  }

  const waitingOn =
    (typeof stage.action?.config?.waiting_on === 'string' && stage.action.config.waiting_on) ||
    stage.client_label ||
    stage.label

  return (
    <Modal title={stage.label} onClose={onClose} footer={advanceFooter ?? null}>
      {state === 'done' ? (
        <div className="runner-state">
          <div className="runner-state-row">
            <span className="runner-state-title">Completed</span>
          </div>
          <p className="runner-state-detail">
            This automated step has already run — the matter has moved past it.
          </p>
        </div>
      ) : state === 'current' ? (
        stalled ? (
          failure ? (
            <div className="runner-state">
              <div className="runner-state-row">
                <span className="runner-state-title">This step hit a problem</span>
              </div>
              <p className="runner-state-detail">{failure}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => void runAgain()} disabled={rerunning}>
                  {rerunning ? 'Queueing…' : 'Run this step again'}
                </button>
              </div>
            </div>
          ) : (
            <div className="runner-state running">
              <div className="runner-state-row">
                <span className="runner-state-title">Still running on the worker</span>
              </div>
              <p className="runner-state-detail">
                This step hasn’t advanced yet. It runs off-request on the worker and advances
                automatically when it completes; keep this open to watch, or check back shortly.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setAttempt((a) => a + 1)}>Keep watching</button>
                <button onClick={() => void runAgain()} disabled={rerunning}>
                  {rerunning ? 'Queueing…' : 'Run this step again'}
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="runner-state running">
            <div className="runner-state-row">
              <span className="spinner" />
              <span className="runner-state-title">Running on the worker…</span>
            </div>
            <p className="runner-state-detail">
              {waitingOn ? <>Working on: {waitingOn}. </> : null}
              This step runs its automation off-request and advances automatically the moment it
              completes — nothing to do here by hand.
            </p>
          </div>
        )
      ) : (
        <div className="runner-state">
          <div className="runner-state-row">
            <span className="runner-state-title">Waiting</span>
          </div>
          <p className="runner-state-detail">
            This automated step runs when the matter reaches it
            {waitingOn ? <> ({waitingOn})</> : null}.
          </p>
        </div>
      )}
      {waitsNote}
    </Modal>
  )
}

// ── Client-review step ────────────────────────────────────────────────────────
// A current step gated on the CLIENT (e.g. client reviews/accepts the document).
// RUNNER-FIXES-1 WP4: an HONEST status panel — what was asked of the client and
// when (the workflow.advanced event that parked the matter here), plus what has
// actually come back since (client uploads / portal messages, read from the real
// matter history — "nothing yet" is said plainly). Two ways forward, both in-app
// confirmed: record the client's out-of-band acceptance (phone/email → Contract W
// accept, fires legal.client_request.accept) or skip the step entirely (Contract W
// skip, records client_step_skipped_by_attorney).
interface ClientStageActivity {
  requestedAt: string | null
  uploads: Array<{ name: string; at: string }>
  messages: Array<{ preview: string; at: string }>
}

export function ClientReviewStep({
  stage,
  matter,
  onChanged,
  onClose,
}: {
  stage: WfStage
  matter: MatterDetail
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState<null | 'accept' | 'skip'>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<null | 'accept' | 'skip'>(null)
  // null = loading; 'failed' = the history read errored (said as such — an empty
  // panel would misread as "the client has done nothing").
  const [activity, setActivity] = useState<ClientStageActivity | 'failed' | null>(null)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{
      events: Array<{ kindName: string; data: Record<string, unknown>; occurredAt: string }>
    }>({
      toolName: 'legal.matter.history',
      input: { matterEntityId: matter.matterEntityId },
    })
      .then((h) => {
        if (cancelled) return
        // When this stage was handed to the client: the LAST advance into it.
        const entered = [...h.events]
          .reverse()
          .find((e) => e.kindName === 'workflow.advanced' && e.data.to === stage.key)
        const since = entered?.occurredAt ?? null
        const after = (at: string) => !since || at >= since
        setActivity({
          requestedAt: since,
          uploads: h.events
            .filter(
              (e) =>
                e.kindName === 'document.uploaded' &&
                e.data.document_source === 'client_uploaded' &&
                after(e.occurredAt),
            )
            .map((e) => ({
              name: String(e.data.original_filename ?? 'document'),
              at: e.occurredAt,
            })),
          messages: h.events
            .filter((e) => e.kindName === 'client.message.received' && after(e.occurredAt))
            .map((e) => ({ preview: String(e.data.preview ?? ''), at: e.occurredAt })),
        })
      })
      .catch(() => {
        if (!cancelled) setActivity('failed')
      })
    return () => {
      cancelled = true
    }
  }, [matter.matterEntityId, stage.key])

  const [acceptNote, setAcceptNote] = useState<string | null>(null)

  async function run(kind: 'accept' | 'skip') {
    setConfirming(null)
    setBusy(kind)
    setErr(null)
    try {
      if (kind === 'accept') {
        const r = await acceptClientStep(matter.matterEntityId, stage.key)
        if (!r.advancedTo) {
          // Honest: the acceptance IS recorded (client_request.accepted), but this
          // stage's client edge advances only on the client's own named action
          // (its `via` — e.g. a portal reply or a booking), so the matter stayed
          // put. Say so and keep the panel open; Skip still advances.
          setAcceptNote(
            'Acceptance recorded in the matter history. This step still advances only on the client’s own action — use Skip to move past it without that.',
          )
          setBusy(null)
          await onChanged()
          return
        }
      } else {
        await skipStep(matter.matterEntityId, stage.key)
      }
      await onChanged()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const cameBack =
    activity && activity !== 'failed' ? activity.uploads.length + activity.messages.length : 0

  return (
    <Modal title={stage.label} onClose={onClose}>
      {confirming === 'accept' && (
        <ConfirmModal
          title="Record client acceptance?"
          body="Records that the client accepted this step out-of-band (phone or email) and advances the matter. The acceptance is attributed and kept in the matter history."
          confirmLabel="Record acceptance"
          onConfirm={() => void run('accept')}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === 'skip' && (
        <ConfirmModal
          title="Skip this client step?"
          body="Advances the matter without the client’s acceptance — the skip is recorded in the matter history as an attorney override."
          confirmLabel="Skip step"
          danger
          onConfirm={() => void run('skip')}
          onCancel={() => setConfirming(null)}
        />
      )}
      {err && <div className="alert alert-error">{err}</div>}
      {acceptNote && <div className="alert alert-success">{acceptNote}</div>}

      <div className="runner-state">
        <div className="runner-state-row">
          <span className="runner-state-title">Waiting on the client</span>
        </div>
        <p className="runner-state-detail">
          {stage.client_label
            ? `The client was asked to: “${stage.client_label}”`
            : 'This step is with the client'}
          {activity && activity !== 'failed' && activity.requestedAt
            ? ` — since ${new Date(activity.requestedAt).toLocaleDateString()}.`
            : '.'}
        </p>
      </div>

      {/* What has come back — the real reads, stated plainly. */}
      <div style={{ marginTop: 'var(--space-3)' }}>
        {activity === null ? (
          <p className="text-muted text-sm">
            <span className="spinner" /> Checking for client activity…
          </p>
        ) : activity === 'failed' ? (
          <p className="text-muted text-sm">
            Couldn’t load the client activity for this step — the actions below still work.
          </p>
        ) : cameBack === 0 ? (
          <p className="text-muted text-sm">Nothing has come back from the client yet.</p>
        ) : (
          <>
            {activity.uploads.length > 0 && (
              <div className="text-sm" style={{ marginBottom: 'var(--space-2)' }}>
                <strong>Materials received:</strong>
                <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-4)' }}>
                  {activity.uploads.map((u, i) => (
                    <li key={i}>
                      {u.name} — {new Date(u.at).toLocaleDateString()}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {activity.messages.length > 0 && (
              <div className="text-sm">
                <strong>
                  {activity.messages.length === 1
                    ? 'Message from the client:'
                    : `${activity.messages.length} messages from the client:`}
                </strong>
                <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-4)' }}>
                  {activity.messages.map((m, i) => (
                    <li key={i}>
                      “{m.preview}” — {new Date(m.at).toLocaleDateString()}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-muted text-sm" style={{ marginTop: 'var(--space-4)' }}>
        The step advances when the client completes it in the portal. If they’ve already accepted by
        phone or email, record it; or skip the step entirely.
      </p>
      <div className="runner-toolbar" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>
        <button
          className="primary"
          onClick={() => setConfirming('accept')}
          disabled={busy !== null}
        >
          {busy === 'accept' && <span className="spinner" />}
          {busy === 'accept' ? 'Recording…' : 'Record client acceptance'}
        </button>
        <button className="warn" onClick={() => setConfirming('skip')} disabled={busy !== null}>
          {busy === 'skip' && <span className="spinner" />}
          {busy === 'skip' ? 'Skipping…' : 'Skip this step'}
        </button>
      </div>
    </Modal>
  )
}

// ── Complete matter step ──────────────────────────────────────────────────────
// The matter summary + a real "Complete & archive" action (Contract W complete
// { archive: true } — advance to terminal, accrue the completion fee, archive).
// Archived, never deleted.
export function CompleteMatterStep({
  stage,
  matter,
  onChanged,
  onClose,
  advanceFooter,
}: {
  stage: WfStage
  matter: MatterDetail
  onChanged: () => Promise<void>
  onClose: () => void
  advanceFooter?: React.ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<{ archived: boolean } | null>(null)

  async function complete() {
    setConfirming(false)
    setBusy(true)
    setErr(null)
    try {
      const r = await completeMatter(matter.matterEntityId)
      setDone({ archived: r.archived })
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={stage.label} onClose={onClose} footer={advanceFooter ?? null}>
      {confirming && (
        <ConfirmModal
          title="Complete and archive this matter?"
          body="The matter moves out of the active list — it is archived, not deleted, and stays available in the archived view."
          confirmLabel="Complete matter"
          onConfirm={() => void complete()}
          onCancel={() => setConfirming(false)}
        />
      )}
      {err && <div className="alert alert-error">{err}</div>}
      {done ? (
        <div className="alert alert-success">
          Matter completed
          {done.archived ? ' and archived — it’s moved out of the active list.' : '.'}
        </div>
      ) : (
        <>
          <div className="kv-grid" style={{ marginBottom: 'var(--space-4)' }}>
            <div>
              <div className="kv-label">Client</div>
              <div className="kv-value">{matter.clientName || '—'}</div>
            </div>
            <div>
              <div className="kv-label">Matter</div>
              <div className="kv-value">{matter.matterNumber}</div>
            </div>
            <div>
              <div className="kv-label">Practice area</div>
              <div className="kv-value">{humanizeService(matter.practiceArea)}</div>
            </div>
          </div>
          <p className="text-sm">
            Every step in this matter’s workflow has run. Completing archives the matter — it’s{' '}
            <strong>archived, not deleted</strong>, and stays available in the archived view.
          </p>
          <button
            className="primary"
            onClick={() => setConfirming(true)}
            disabled={busy}
            style={{ marginTop: 'var(--space-3)' }}
          >
            {busy && <span className="spinner" />}
            {busy ? 'Completing…' : 'Complete matter'}
          </button>
        </>
      )}
    </Modal>
  )
}
