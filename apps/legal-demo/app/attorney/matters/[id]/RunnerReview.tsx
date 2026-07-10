'use client'

// The workflow runner's flagship surface (WORKFLOW-RUNNER-1 WP2): the FULL review
// — document + Edit + Regenerate + Approve — lives inside the step's pop-up.
// Opening the step IS opening the review; there is no intermediate confirm and no
// navigation to /attorney/review. It reuses the exact pieces the standalone review
// page uses (renderDocumentHtml for the document; the TipTap TemplateEditor for
// Word-like editing; legal.draft.edit for the write path) and drives the four
// Contract W write ops through lib/stepRunner (which falls back to the proven MCP
// operations until the sibling session's routes land).
import { useCallback, useEffect, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Modal } from '@/components/Modal'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'
import { downloadAsPdf, downloadAsWord, shareUrlFor } from '@/lib/draftExport'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import { approveDocument, regenerateStep, skipStep, completeMatter } from '@/lib/stepRunner'
import { humanizeKind, humanizeService, type MatterDetail, type WfStage } from './shared'

interface DraftPayload {
  documentKind: string
  versionNumber: number
  status: string
  bodyMarkdown: string
}

// Poll interval + attempts for a draft landing off the worker (regenerate, or the
// auto-run producing capability on stage entry). Honest: we poll the real read;
// we never animate fake progress.
const POLL_MS = 3500
const POLL_TRIES = 40 // ~2.3 min — model drafting budget

function useLatestDraft(versionId: string | null): {
  draft: DraftPayload | null
  loading: boolean
  reload: () => void
} {
  const [draft, setDraft] = useState<DraftPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!versionId) {
      setDraft(null)
      return
    }
    let cancelled = false
    setLoading(true)
    callAttorneyMcp<{ draft: DraftPayload | null }>({
      toolName: 'legal.draft.get',
      input: { documentVersionId: versionId },
    })
      .then((r) => {
        if (!cancelled) setDraft(r.draft)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [versionId, nonce])
  return { draft, loading, reload: () => setNonce((n) => n + 1) }
}

function statusBadgeClass(status: string): string {
  if (status === 'approved') return 'badge ok'
  if (status === 'rejected') return 'badge danger'
  if (status === 'revision_requested') return 'badge warn'
  return 'badge info'
}

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
  const { draft, loading, reload } = useLatestDraft(versionId)

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

  // ── Edit (TipTap, Word-like) ────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [editNote, setEditNote] = useState('')
  const editorRef = useRef<TemplateEditorHandle | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function openEdit() {
    setErr(null)
    setNotice(null)
    setEditNote('')
    setEditing(true)
  }

  async function saveEdit() {
    if (!draft) return
    const html = editorRef.current?.getHTML() ?? ''
    const md = htmlToMarkdown(html).trim()
    if (!md) return
    setBusy('edit')
    setErr(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.draft.edit',
        input: {
          documentVersionId: versionId,
          documentMarkdown: md,
          note: editNote.trim() || undefined,
        },
      })
      setEditing(false)
      setNotice('Saved as a new version — the original is preserved in history.')
      await onChanged() // new version becomes latest; reload
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // ── Regenerate ──────────────────────────────────────────────────────────────
  const [regenOpen, setRegenOpen] = useState(false)
  const [changeNotes, setChangeNotes] = useState('')

  async function runRegenerate() {
    if (!draft || !changeNotes.trim()) return
    setBusy('regenerate')
    setErr(null)
    try {
      const startVersionId = versionId
      const r = await regenerateStep(matter.matterEntityId, stage.key, {
        changeNotes: changeNotes.trim(),
        documentKind: draft.documentKind,
      })
      setRegenOpen(false)
      setChangeNotes('')
      setNotice(
        r.via === 'contract-w'
          ? 'Re-drafting on the worker — the new version will appear here when it lands.'
          : 'Re-drafting on the worker — the new version supersedes this one and appears here when it lands.',
      )
      void pollForNewVersion(startVersionId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // ── Approve (± send) ──────────────────────────────────────────────────────────
  const [approveOpen, setApproveOpen] = useState(false)
  const approved = matter.latestDraftStatus === 'approved'

  async function doApprove(send: boolean) {
    if (!versionId) return
    setBusy(send ? 'approve-send' : 'approve')
    setErr(null)
    try {
      const r = await approveDocument(versionId, {
        send,
        matterEntityId: matter.matterEntityId,
        shareUrl: shareUrlFor(versionId),
        to: matter.clientEmail,
      })
      setApproveOpen(false)
      setNotice(
        r.sent
          ? `Approved and emailed to the client${matter.clientEmail ? ` at ${matter.clientEmail}` : ''}.`
          : 'Approved — the document fee (if the service sets one) is now accrued and ready to bill.',
      )
      await onChanged()
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const fileBase = draft ? `${matter.matterNumber}-${draft.documentKind}` : matter.matterNumber

  const footer = (
    <>
      {advanceFooter && <span className="modal-foot-spacer" />}
      {advanceFooter}
    </>
  )

  return (
    <Modal title={stage.label} onClose={onClose} size="wide" footer={advanceFooter ? footer : null}>
      {err && <div className="alert alert-error">{err}</div>}
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
      ) : loading || !draft ? (
        <p className="text-muted text-sm">
          <span className="spinner" /> Loading document…
        </p>
      ) : editing ? (
        // ── Inline TipTap editor (Word-like) ──────────────────────────────────
        <div>
          <div className="runner-editor-wrap">
            <TemplateEditor
              initialHtml={markdownToHtml(draft.bodyMarkdown)}
              editorRef={editorRef}
              placeholder="Edit the document…"
            />
          </div>
          <input
            type="text"
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="Optional: note what you changed (kept in version history)"
            disabled={busy === 'edit'}
            style={{ marginTop: 'var(--space-3)' }}
          />
          <div className="runner-toolbar" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
            <button className="primary" onClick={() => void saveEdit()} disabled={busy === 'edit'}>
              {busy === 'edit' && <span className="spinner" />}
              {busy === 'edit' ? 'Saving…' : 'Save as new version'}
            </button>
            <button onClick={() => setEditing(false)} disabled={busy === 'edit'}>
              Cancel
            </button>
            <span className="text-muted text-sm runner-toolbar-end">
              Saving creates a new version; the original is preserved.
            </span>
          </div>
        </div>
      ) : regenOpen ? (
        // ── Regenerate window (in-place) ──────────────────────────────────────
        <div className="runner-subpanel">
          <h3 style={{ marginTop: 0 }}>Regenerate document</h3>
          <p className="text-muted text-sm">
            Re-drafts this {humanizeKind(draft.documentKind)} (v{draft.versionNumber}) on the
            worker. The matter’s questionnaire and consultation are always included; describe what
            should change. The current version is kept — the redraft supersedes it, append-only.
          </p>
          <label>
            <span>What needs to change</span>
            <textarea
              rows={4}
              value={changeNotes}
              onChange={(e) => setChangeNotes(e.target.value)}
              placeholder="e.g. Name the alternate executor as the client’s sister; add a no-contest clause."
              autoFocus
            />
          </label>
          <div className="runner-toolbar" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
            <button
              className="primary"
              onClick={() => void runRegenerate()}
              disabled={busy === 'regenerate' || !changeNotes.trim()}
            >
              {busy === 'regenerate' && <span className="spinner" />}
              {busy === 'regenerate' ? 'Starting…' : 'Regenerate'}
            </button>
            <button onClick={() => setRegenOpen(false)} disabled={busy === 'regenerate'}>
              Cancel
            </button>
          </div>
        </div>
      ) : approveOpen ? (
        // ── Approve window (in-place): two explicit choices ───────────────────
        <div className="runner-subpanel">
          <h3 style={{ marginTop: 0 }}>Approve document</h3>
          <p className="text-muted text-sm">
            Approving marks v{draft.versionNumber} as the firm-approved version and accrues the
            document fee per the service’s billing declaration. Choose whether to send it now.
          </p>
          <div className="runner-approve-choices">
            <button
              type="button"
              className="runner-approve-choice"
              onClick={() => void doApprove(false)}
              disabled={busy !== null}
            >
              <span className="rc-title">
                {busy === 'approve' && <span className="spinner" />} Approve
              </span>
              <span className="rc-sub">
                Marks the document approved and accrues its fee. Nothing is emailed.
              </span>
            </button>
            <button
              type="button"
              className="runner-approve-choice"
              onClick={() => void doApprove(true)}
              disabled={busy !== null}
            >
              <span className="rc-title">
                {busy === 'approve-send' && <span className="spinner" />} Approve &amp; send to
                client
              </span>
              <span className="rc-sub">
                Approves, accrues the fee, and emails the approved version
                {matter.clientEmail
                  ? ` to ${matter.clientEmail}`
                  : ' (no client email on file yet)'}
                .
              </span>
            </button>
          </div>
          <div className="runner-toolbar" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
            <button onClick={() => setApproveOpen(false)} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        // ── The document, as a document + review actions ──────────────────────
        <div>
          <div className="runner-head">
            <span className="kv-label" style={{ margin: 0 }}>
              {humanizeKind(draft.documentKind)}
            </span>
            <span className="review-version">v{draft.versionNumber}</span>
            <span className={statusBadgeClass(draft.status)}>
              {draft.status.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="runner-toolbar">
            <button onClick={openEdit} disabled={busy !== null}>
              Edit
            </button>
            <button
              onClick={() => setRegenOpen(true)}
              disabled={busy !== null || phase === 'running'}
            >
              Regenerate…
            </button>
            <button
              className="primary"
              onClick={() => setApproveOpen(true)}
              disabled={busy !== null || approved}
            >
              {approved ? 'Approved' : 'Approve…'}
            </button>
            <button
              className="runner-toolbar-end"
              onClick={() => downloadAsWord(draft.bodyMarkdown, fileBase)}
            >
              Word
            </button>
            <button onClick={() => downloadAsPdf(draft.bodyMarkdown, fileBase)}>PDF</button>
          </div>

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

          <div className="runner-doc">
            <article
              className="doc-rendered doc-paper"
              dangerouslySetInnerHTML={{ __html: renderDocumentHtml(draft.bodyMarkdown) }}
            />
          </div>
        </div>
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
// never animate fake progress. There is no worker job-status read exposed to the
// app yet, so a recorded-error "failed" state is not shown (tracked as OPEN).
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
  const pollRef = useRef<{ cancelled: boolean } | null>(null)

  useEffect(() => {
    if (state !== 'current') return
    if (pollRef.current) pollRef.current.cancelled = true
    const token = { cancelled: false }
    pollRef.current = token
    setStalled(false)
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
        setStalled(true)
      }
    })()
    return () => {
      token.cancelled = true
    }
    // Keyed on the step becoming current for this matter; onChanged is stable.
  }, [state, matter.matterEntityId])

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
          <div className="runner-state running">
            <div className="runner-state-row">
              <span className="runner-state-title">Still running on the worker</span>
            </div>
            <p className="runner-state-detail">
              This step hasn’t advanced yet. It runs off-request on the worker and advances
              automatically when it completes; keep this open to watch, or check back shortly.
            </p>
            <div>
              <button onClick={() => setStalled(false)}>Keep watching</button>
            </div>
          </div>
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
// Shows the client-facing status + an attorney "Skip this step" override that
// advances without the client's acceptance (Contract W skip; falls back to
// legal.matter.advance along the client edge).
export function ClientReviewStep({
  stage,
  matter,
  clientEdge,
  onChanged,
  onClose,
}: {
  stage: WfStage
  matter: MatterDetail
  clientEdge: { to: string; gate: string }
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function skip() {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Advance this matter without the client’s acceptance of this step? This overrides the client gate.',
      )
    )
      return
    setBusy(true)
    setErr(null)
    try {
      await skipStep(matter.matterEntityId, stage.key, {
        toState: clientEdge.to,
        gate: clientEdge.gate,
      })
      await onChanged()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={stage.label} onClose={onClose}>
      {err && <div className="alert alert-error">{err}</div>}
      <div className="runner-state">
        <div className="runner-state-row">
          <span className="runner-state-title">Waiting on the client</span>
        </div>
        <p className="runner-state-detail">
          {stage.client_label
            ? `The client sees: “${stage.client_label}”. `
            : 'This step is with the client. '}
          It advances when the client completes it. There’s no acceptance recorded yet.
        </p>
      </div>
      <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
        You can advance the matter without waiting — the client step is skipped.
      </p>
      <button
        className="warn"
        onClick={() => void skip()}
        disabled={busy}
        style={{ marginTop: 'var(--space-2)' }}
      >
        {busy && <span className="spinner" />}
        {busy ? 'Skipping…' : 'Skip this step'}
      </button>
    </Modal>
  )
}

// ── Complete matter step ──────────────────────────────────────────────────────
// Replaces the static "this matter is complete" text with the matter summary + a
// real "Complete & archive" action (Contract W complete { archive: true }). When
// the endpoint isn't deployed yet the matter is still completed via the workflow
// advance and archiving is reported as pending — never faked.
export function CompleteMatterStep({
  stage,
  matter,
  terminalState,
  onChanged,
  onClose,
  advanceFooter,
}: {
  stage: WfStage
  matter: MatterDetail
  // The state to advance to in order to complete, or null if the matter is already
  // at its terminal step (then only Contract W can archive).
  terminalState: string | null
  onChanged: () => Promise<void>
  onClose: () => void
  advanceFooter?: React.ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ archived: boolean; archivePending: boolean } | null>(null)

  async function complete() {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Complete and archive this matter? It moves out of the active list.')
    )
      return
    setBusy(true)
    setErr(null)
    try {
      const r = await completeMatter(matter.matterEntityId, { terminalState })
      setDone({ archived: r.archived, archivePending: r.archivePending })
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={stage.label} onClose={onClose} footer={advanceFooter ?? null}>
      {err && <div className="alert alert-error">{err}</div>}
      {done ? (
        <div className="alert alert-success">
          Matter completed
          {done.archived
            ? ' and archived — it’s moved out of the active list.'
            : done.archivePending
              ? '. Archiving is pending the completion endpoint; the matter is marked complete.'
              : '.'}
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
            onClick={() => void complete()}
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
