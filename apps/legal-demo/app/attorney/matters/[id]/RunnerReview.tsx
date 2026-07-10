'use client'

// The workflow runner's flagship surface (WORKFLOW-RUNNER-1 WP2): the FULL review
// — document + Edit + Regenerate + Approve — lives inside the step's pop-up.
// Opening the step IS opening the review; there is no intermediate confirm and no
// navigation to /attorney/review. It reuses the exact pieces the standalone review
// page uses (renderDocumentHtml for the document; the TipTap TemplateEditor for
// Word-like editing; legal.draft.edit for the write path) and drives the write ops
// through lib/stepRunner — Contract W only (the interim MCP fallback was retired
// in RUNNER-FIXES-1 once BACKHALF-BLOCKS-1's routes were verified deployed).
import { useCallback, useEffect, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Modal } from '@/components/Modal'
import { ConfirmModal } from '@/components/ConfirmModal'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'
import { downloadAsPdf, downloadAsWord } from '@/lib/draftExport'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import {
  acceptClientStep,
  approveDocument,
  regenerateStep,
  skipStep,
  completeMatter,
} from '@/lib/stepRunner'
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

  // Unsaved-changes guard (RUNNER-FIXES-1 WP1): the editor is dirty after any
  // keystroke (TemplateEditor's onChange never fires on the initial seed). Leaving
  // edit mode with unsaved changes — Cancel, or closing the modal via ×/backdrop/
  // Escape — asks first via an in-app dialog. Never a silent discard, never a
  // native confirm. `discardGuard` also remembers what discarding should do:
  // return to the review view ('cancel') or close the whole step ('close').
  const [dirty, setDirty] = useState(false)
  const [discardGuard, setDiscardGuard] = useState<null | 'cancel' | 'close'>(null)

  function openEdit() {
    setErr(null)
    setNotice(null)
    setEditNote('')
    setDirty(false)
    setEditing(true)
  }

  function cancelEdit() {
    if (dirty) {
      setDiscardGuard('cancel')
      return
    }
    setEditing(false)
  }

  function requestClose() {
    if (editing && dirty) {
      // The guard is already up (e.g. Escape pressed twice): keep it, don't stack.
      if (!discardGuard) setDiscardGuard('close')
      return
    }
    onClose()
  }

  function discardEdits() {
    const mode = discardGuard
    setDiscardGuard(null)
    setDirty(false)
    setEditing(false)
    if (mode === 'close') onClose()
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
      setDirty(false)
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
      await regenerateStep(matter.matterEntityId, stage.key, {
        changeNotes: changeNotes.trim(),
      })
      setRegenOpen(false)
      setChangeNotes('')
      setNotice('Re-drafting on the worker — the new version will appear here when it lands.')
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
      const r = await approveDocument(versionId, { send })
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
    <Modal
      title={stage.label}
      onClose={requestClose}
      size="wide"
      footer={advanceFooter ? footer : null}
    >
      {discardGuard && (
        <ConfirmModal
          title="Discard unsaved changes?"
          body="Your edits to this document haven’t been saved. Discarding returns to the last saved version."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          danger
          onConfirm={discardEdits}
          onCancel={() => setDiscardGuard(null)}
        />
      )}
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
              onChange={() => setDirty(true)}
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
            <button onClick={cancelEdit} disabled={busy === 'edit'}>
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

  async function run(kind: 'accept' | 'skip') {
    setConfirming(null)
    setBusy(kind)
    setErr(null)
    try {
      if (kind === 'accept') await acceptClientStep(matter.matterEntityId, stage.key)
      else await skipStep(matter.matterEntityId, stage.key)
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
