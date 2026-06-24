'use client'

import { use, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { downloadAsPdf, downloadAsWord, shareUrlFor } from '@/lib/draftExport'
import { formatDateTime } from '@/lib/datetime'
import { lineDiff, diffStats, type DiffOp } from '@/lib/lineDiff'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { DocumentActionBar } from '@/components/DocumentActionBar'
import { BackButton } from '@/components/BackButton'
import { PageHead } from '@/components/PageHead'
import { SparklesIcon, XIcon } from '@/components/icons'

// Step-through review session (started from the queue's "Begin review"): the ordered
// draft ids to walk, in sessionStorage, flagged on the URL with ?review=session.
const REVIEW_SESSION_KEY = 'reviewSession'

interface DraftDetail {
  documentVersionId: string
  documentEntityId: string
  matterEntityId: string
  matterNumber: string
  documentKind: string
  versionNumber: number
  status: string
  recordedAt: string
  bodyMarkdown: string
  reasoningTrace: ReasoningTrace | null
  modelIdentity: string | null
  conclusion: string | null
  confidence: number | null
  reviewNotes: string | null
}

interface ReasoningTrace {
  prompt_id?: string
  model_identity?: string
  evidence?: EvidenceItem[]
  alternatives_considered?: Alternative[]
  conclusion?: string
  confidence?: number
  ambiguities?: Ambiguity[]
  [k: string]: unknown
}

interface EvidenceItem {
  source?: string
  field?: string
  value?: unknown
  used_in?: string
  confidence?: number
}

interface Alternative {
  decision_point?: string
  alternatives?: string[]
  selected?: string
  rationale?: string
}

interface Ambiguity {
  topic?: string
  explanation?: string
  needs_input_from?: string
}

interface SkillCatalogItem {
  slug: string
  name: string
  practiceArea: string
  whenToUse: string
  userInvocable: boolean
}

function statusBadge(status: string): string {
  if (status === 'approved') return 'badge ok'
  if (status === 'rejected') return 'badge danger'
  if (status === 'revision_requested') return 'badge warn'
  return 'badge info'
}

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, ' ')
}

interface VersionSummary {
  documentVersionId: string
  versionNumber: number
  status: string
  recordedAt: string
  source: 'original' | 'generated' | 'edited'
  note: string | null
}

// Short label for where a version came from, shown in the compare picker.
function versionSourceLabel(s: VersionSummary['source']): string {
  if (s === 'original') return 'original'
  if (s === 'edited') return 'edited'
  return 'regenerated'
}

// Renders a line diff: removed lines (red), added lines (green), and — unless
// hidden — unchanged lines (muted), with a "···" marker standing in for a
// collapsed run of unchanged lines.
function VersionDiff({ ops, showUnchanged }: { ops: DiffOp[]; showUnchanged: boolean }) {
  const rows: ReactNode[] = []
  let collapsed = false
  ops.forEach((op, i) => {
    if (op.type === 'same' && !showUnchanged) {
      if (!collapsed) {
        rows.push(
          <div key={`gap-${i}`} className="vdiff-gap" aria-hidden>
            ···
          </div>,
        )
        collapsed = true
      }
      return
    }
    collapsed = false
    const cls = op.type === 'add' ? 'vdiff-add' : op.type === 'del' ? 'vdiff-del' : 'vdiff-same'
    const sign = op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' '
    rows.push(
      <div key={i} className={`vdiff-line ${cls}`}>
        <span className="vdiff-sign" aria-hidden>
          {sign}
        </span>
        <span className="vdiff-text">{op.line || ' '}</span>
      </div>,
    )
  })
  return <>{rows}</>
}

export default function DraftReviewPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params)
  const router = useRouter()
  const [draft, setDraft] = useState<DraftDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // Reasoning trace lives in a drawer now (it's attorney context, not part of the
  // document) — opened from a toolbar button instead of crowding the page.
  const [traceOpen, setTraceOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Compare-versions drawer: the document's version history + a line diff of a
  // chosen earlier version against this one.
  const [compareOpen, setCompareOpen] = useState(false)
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null)
  const [baseMarkdown, setBaseMarkdown] = useState<string | null>(null)
  const [showUnchanged, setShowUnchanged] = useState(true)
  // Regenerate modal: an editable prompt (prefilled with the revision notes) + a
  // skills picker, so the redraft acts on exactly what the attorney asked.
  const [regenOpen, setRegenOpen] = useState(false)
  const [regenGuidance, setRegenGuidance] = useState('')
  const [regenSkills, setRegenSkills] = useState<Set<string>>(new Set())
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogItem[] | null>(null)
  const [skillQuery, setSkillQuery] = useState('')
  // After "Request revision", nudge the attorney to regenerate now with those very
  // notes — closing the loop between asking for changes and producing them.
  const [revisionNudge, setRevisionNudge] = useState(false)
  // Inline edit: swap the rendered document for a markdown editor so the attorney
  // can fix a clause/name directly. Saving creates a NEW version (document.edit).
  const [editing, setEditing] = useState(false)
  const [editMarkdown, setEditMarkdown] = useState('')
  const [editNote, setEditNote] = useState('')
  // The ordered ids of an in-progress step-through review, or null for a normal
  // single visit. Loaded only when the URL carries ?review=session.
  const [sessionIds, setSessionIds] = useState<string[] | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await callAttorneyMcp<{ draft: DraftDetail | null }>({
        toolName: 'legal.draft.get',
        input: { documentVersionId: versionId },
      })
      setDraft(res.draft)
      if (res.draft?.reviewNotes) setNotes(res.draft.reviewNotes)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    load()
  }, [versionId])

  // Pick up an in-progress step-through session for this draft (queue → Begin review).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const inSession = new URLSearchParams(window.location.search).get('review') === 'session'
    if (!inSession) {
      setSessionIds(null)
      return
    }
    try {
      const raw = window.sessionStorage.getItem(REVIEW_SESSION_KEY)
      const parsed = raw ? (JSON.parse(raw) as { ids?: unknown }) : null
      setSessionIds(Array.isArray(parsed?.ids) ? (parsed.ids as string[]) : null)
    } catch {
      setSessionIds(null)
    }
  }, [versionId])

  // Esc closes whichever drawer is open.
  useEffect(() => {
    if (!traceOpen && !compareOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTraceOpen(false)
        setCompareOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [traceOpen, compareOpen])

  // Open the compare drawer: load the version history (once) and default the
  // base to the immediate predecessor of the version being viewed.
  async function openCompare() {
    setCompareOpen(true)
    if (versions) return
    try {
      const res = await callAttorneyMcp<{ versions: VersionSummary[] }>({
        toolName: 'legal.draft.versions',
        input: { documentVersionId: versionId },
      })
      setVersions(res.versions)
      const current = res.versions.find((v) => v.documentVersionId === versionId)
      const predecessor = res.versions
        .filter((v) => !current || v.versionNumber < current.versionNumber)
        .sort((a, b) => b.versionNumber - a.versionNumber)[0]
      if (predecessor) setBaseVersionId(predecessor.documentVersionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // Fetch the chosen base version's markdown whenever the selection changes.
  useEffect(() => {
    if (!baseVersionId) {
      setBaseMarkdown(null)
      return
    }
    let live = true
    callAttorneyMcp<{ draft: { bodyMarkdown: string } | null }>({
      toolName: 'legal.draft.get',
      input: { documentVersionId: baseVersionId },
    })
      .then((res) => {
        if (live) setBaseMarkdown(res.draft?.bodyMarkdown ?? null)
      })
      .catch(() => {
        if (live) setBaseMarkdown(null)
      })
    return () => {
      live = false
    }
  }, [baseVersionId])

  // The line diff of the base version against the one being viewed.
  const diffOps = useMemo(
    () => (baseMarkdown != null && draft ? lineDiff(baseMarkdown, draft.bodyMarkdown) : []),
    [baseMarkdown, draft],
  )
  const diffSummary = useMemo(() => diffStats(diffOps), [diffOps])

  const sessionPos = sessionIds ? sessionIds.indexOf(versionId) : -1

  function exitSession() {
    try {
      window.sessionStorage.removeItem(REVIEW_SESSION_KEY)
    } catch {
      /* ignore */
    }
    router.push('/attorney/review')
  }

  async function review(toolName: string, label: string, requireNotes: boolean) {
    if (requireNotes && !notes.trim()) {
      setError('Review notes are required for this action.')
      return
    }
    setBusy(label)
    setError(null)
    setNotice(null)
    setRevisionNudge(false)
    try {
      await callAttorneyMcp({
        toolName,
        input: { documentVersionId: versionId, reviewNotes: notes.trim() || undefined },
      })
      // In a step-through session, auto-advance to the next selected draft once this
      // one is dispositioned; finish back at the queue when the list is exhausted.
      if (sessionIds && sessionPos >= 0) {
        const next = sessionPos + 1
        if (next < sessionIds.length) {
          window.sessionStorage.setItem(
            REVIEW_SESSION_KEY,
            JSON.stringify({ ids: sessionIds, index: next }),
          )
          router.push(`/attorney/review/${sessionIds[next]}?review=session`)
        } else {
          window.sessionStorage.removeItem(REVIEW_SESSION_KEY)
          router.push('/attorney/review')
        }
        return
      }
      await load()
      // Outside a step-through session, requesting a revision leaves the attorney on
      // this page — so nudge them to regenerate now with the notes they just wrote.
      if (toolName === 'legal.draft.request_revision') setRevisionNudge(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // Open the regenerate prompt window: prefill the editable instructions with the
  // current review notes (so "request revision" notes carry straight into the
  // redraft), reset the skill selection, and lazy-load the skills catalog.
  function openRegen() {
    setRegenGuidance(notes)
    setRegenSkills(new Set())
    setError(null)
    setRevisionNudge(false)
    setRegenOpen(true)
    if (!skillCatalog) {
      callAttorneyMcp<{ skills: SkillCatalogItem[] }>({ toolName: 'legal.skill.list' })
        .then((r) => setSkillCatalog(r.skills.filter((s) => s.userInvocable && s.slug)))
        .catch(() => setSkillCatalog([]))
    }
  }

  function toggleSkill(slug: string) {
    setRegenSkills((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  // Drafting is async (enqueues a worker job), so we confirm + return the attorney
  // to the queue where the regenerated version will appear, rather than waiting.
  async function runRegenerate() {
    if (!draft) return
    setBusy('regenerate')
    setError(null)
    setNotice(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.draft.generate',
        input: {
          matterEntityId: draft.matterEntityId,
          documentKind:
            draft.documentKind === 'engagement_letter'
              ? 'engagement_letter'
              : 'operating_agreement',
          guidance: regenGuidance.trim() || undefined,
          skillSlugs: [...regenSkills],
        },
      })
      setRegenOpen(false)
      setNotice(
        'Regenerating with your instructions — the updated draft will appear in the review queue shortly.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // Enter the inline editor, seeded with the current document markdown.
  function openEdit() {
    if (!draft) return
    setEditMarkdown(draft.bodyMarkdown)
    setEditNote('')
    setError(null)
    setNotice(null)
    setEditing(true)
  }

  // Save the edited markdown as a NEW version (document.edit), then open that
  // version — append-only, so the original is preserved and lands in history.
  async function saveEdit() {
    if (!draft || !editMarkdown.trim()) return
    setBusy('edit')
    setError(null)
    setNotice(null)
    try {
      const result = await callAttorneyMcp<{
        effects: Array<{ documentVersionId?: string }>
      }>({
        toolName: 'legal.draft.edit',
        input: {
          documentVersionId: versionId,
          documentMarkdown: editMarkdown,
          note: editNote.trim() || undefined,
        },
      })
      const newId = result.effects?.find((e) => e.documentVersionId)?.documentVersionId
      setEditing(false)
      if (newId && newId !== versionId) {
        // Drop any step-through session: this edit is a deliberate detour.
        router.push(`/attorney/review/${newId}`)
      } else {
        await load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const evidence = useMemo(() => draft?.reasoningTrace?.evidence ?? [], [draft])
  const alternatives = useMemo(() => draft?.reasoningTrace?.alternatives_considered ?? [], [draft])
  const ambiguities = useMemo(() => draft?.reasoningTrace?.ambiguities ?? [], [draft])

  if (!draft && !error) {
    return (
      <main>
        <div className="loading-block">
          <span className="spinner" /> Loading draft…
        </div>
      </main>
    )
  }
  if (error && !draft) {
    return (
      <main>
        <div className="alert alert-error">{error}</div>
      </main>
    )
  }
  if (!draft) {
    return (
      <main>
        <p>Draft not found.</p>
      </main>
    )
  }

  const hasTrace = Boolean(
    draft.reasoningTrace ||
    draft.modelIdentity ||
    draft.confidence !== null ||
    evidence.length ||
    alternatives.length ||
    ambiguities.length,
  )
  const docFileBase = `${humanizeKind(draft.documentKind).replace(/\s+/g, '-').toLowerCase()}-${draft.matterNumber}`

  return (
    <main className="review-page">
      <div className="review-topbar">
        {sessionPos >= 0 && sessionIds ? (
          <BackButton
            label={`Exit review (${sessionPos + 1} of ${sessionIds.length})`}
            onBack={exitSession}
            className="review-back"
            style={{ marginBottom: 0 }}
          />
        ) : (
          <BackButton
            fallback="/attorney/review"
            className="review-back"
            style={{ marginBottom: 0 }}
          />
        )}
        <Link href={`/attorney/matters/${draft.matterEntityId}`} className="review-back">
          Matter {draft.matterNumber}
        </Link>
      </div>

      <PageHead
        title={humanizeKind(draft.documentKind)}
        description={`Generated ${formatDateTime(draft.recordedAt)}`}
        actions={
          <>
            <span className="review-version">v{draft.versionNumber}</span>
            <span className={statusBadge(draft.status)}>{draft.status.replace(/_/g, ' ')}</span>
          </>
        }
      />

      <div className="review-toolbar">
        <button
          onClick={openEdit}
          disabled={busy !== null || editing}
          title="Edit the document text directly — saves as a new version; the original is kept."
        >
          Edit document
        </button>
        <button onClick={() => downloadAsPdf(draft.bodyMarkdown, docFileBase)}>Download PDF</button>
        <button onClick={() => downloadAsWord(draft.bodyMarkdown, docFileBase)}>
          Download Word
        </button>
        {/* Contract J: auto-discovered document actions (Send via email; the
            e-signature session's Send for signature appears here automatically). */}
        <DocumentActionBar
          context={{
            documentVersionId: draft.documentVersionId,
            documentEntityId: draft.documentEntityId,
            matterEntityId: draft.matterEntityId,
            matterNumber: draft.matterNumber,
            documentKind: draft.documentKind,
            shareUrl: shareUrlFor(draft.documentVersionId),
          }}
        />
        {draft.versionNumber > 1 && (
          <button
            type="button"
            className="review-trace-btn"
            onClick={openCompare}
            title="See what changed between this version and an earlier one."
          >
            ⇄ Compare versions
          </button>
        )}
        {hasTrace && (
          <button
            type="button"
            className="review-trace-btn"
            onClick={() => setTraceOpen(true)}
            title="How the AI drafted this — your context, not part of the document."
          >
            <SparklesIcon size={14} /> Reasoning trace
          </button>
        )}
        <a
          href={shareUrlFor(draft.documentVersionId)}
          target="_blank"
          rel="noopener noreferrer"
          className="review-toolbar-end"
        >
          <button>Open client view ↗</button>
        </a>
      </div>

      {/* The document, as a page — or the inline editor when editing. */}
      <div className="review-canvas">
        {editing ? (
          <div className="doc-editor doc-paper">
            <textarea
              className="doc-editor-area"
              value={editMarkdown}
              onChange={(e) => setEditMarkdown(e.target.value)}
              spellCheck
              aria-label="Document markdown"
            />
            <input
              type="text"
              className="doc-editor-note"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Optional: note what you changed (kept in version history)"
              disabled={busy === 'edit'}
            />
            <div className="doc-editor-actions">
              <button
                className="primary"
                onClick={saveEdit}
                disabled={busy === 'edit' || !editMarkdown.trim()}
              >
                {busy === 'edit' && <span className="spinner" />}
                {busy === 'edit' ? 'Saving…' : 'Save as new version'}
              </button>
              <button onClick={() => setEditing(false)} disabled={busy === 'edit'}>
                Cancel
              </button>
              <span className="doc-editor-hint">
                Saving creates a new version; the original is preserved.
              </span>
            </div>
          </div>
        ) : (
          <article
            className="doc-rendered doc-paper"
            dangerouslySetInnerHTML={{ __html: renderDocumentHtml(draft.bodyMarkdown) }}
          />
        )}
      </div>

      <section className="review-decision">
        <h2>
          Review
          {sessionPos >= 0 && sessionIds && (
            <span className="review-decision-sub">
              {' '}
              · {sessionPos + 1} of {sessionIds.length} — a disposition advances to the next
            </span>
          )}
        </h2>
        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success">{notice}</div>}
        {revisionNudge && (
          <div className="review-nudge">
            <span>
              Revision requested. Regenerate the draft now with these notes — or keep editing them
              first.
            </span>
            <span className="review-nudge-actions">
              <button className="primary" onClick={openRegen}>
                Regenerate now…
              </button>
              <button onClick={() => setRevisionNudge(false)}>Not now</button>
            </span>
          </div>
        )}
        <label>
          Notes (required for revision; optional otherwise)
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What needs to change, or anything to flag for the client?"
            style={{ marginTop: 'var(--space-1)' }}
          />
        </label>
        <div className="review-actions">
          <button
            className="ok"
            disabled={busy !== null || editing || draft.status === 'approved'}
            onClick={() => review('legal.draft.approve', 'approve', false)}
          >
            {busy === 'approve' && <span className="spinner" />}
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button
            className="warn"
            disabled={busy !== null || editing}
            onClick={() => review('legal.draft.request_revision', 'revision', true)}
          >
            {busy === 'revision' && <span className="spinner" />}
            {busy === 'revision' ? 'Requesting…' : 'Request revision'}
          </button>
          <button
            className="danger"
            disabled={busy !== null || editing || draft.status === 'rejected'}
            onClick={() => review('legal.draft.reject', 'reject', false)}
          >
            {busy === 'reject' && <span className="spinner" />}
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
          <span style={{ marginLeft: 'auto' }} />
          <button
            disabled={busy !== null || editing}
            onClick={openRegen}
            title="Redraft this document with the live model — add instructions and pick legal skills first."
          >
            Regenerate draft…
          </button>
        </div>
      </section>

      {/* Reasoning trace — a drawer, not part of the page. */}
      {traceOpen && (
        <div
          className="trace-drawer-backdrop"
          onClick={() => setTraceOpen(false)}
          role="presentation"
        >
          <aside
            className="trace-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Reasoning trace"
          >
            <div className="trace-drawer-head">
              <h2>Reasoning trace</h2>
              <button
                type="button"
                className="trace-drawer-close"
                onClick={() => setTraceOpen(false)}
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <p className="trace-drawer-intro">
              How the assistant drafted this — the inputs it used, the choices it made, and anything
              it flagged. This is your context for the review; the client never sees it.
            </p>

            <div className="trace-summary">
              <div className="trace-summary-row">
                <span>
                  <strong>Model</strong> {draft.modelIdentity ?? '(unknown)'}
                </span>
              </div>
              {draft.confidence !== null && (
                <>
                  <div className="trace-summary-row">
                    <span>
                      <strong>Overall confidence</strong> {(draft.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="trace-confidence-bar">
                    <div
                      className="trace-confidence-fill"
                      style={{ width: `${draft.confidence * 100}%` }}
                    />
                  </div>
                </>
              )}
              {draft.conclusion && <p className="trace-conclusion">{draft.conclusion}</p>}
            </div>

            {evidence.length > 0 && (
              <div className="trace-group">
                <h3>Evidence ({evidence.length})</h3>
                <div className="trace-cards">
                  {evidence.map((e, i) => (
                    <EvidenceCardView key={i} item={e} />
                  ))}
                </div>
              </div>
            )}
            {alternatives.length > 0 && (
              <div className="trace-group">
                <h3>Alternatives considered ({alternatives.length})</h3>
                <div className="trace-cards">
                  {alternatives.map((a, i) => (
                    <AlternativeCardView key={i} item={a} />
                  ))}
                </div>
              </div>
            )}
            {ambiguities.length > 0 && (
              <div className="trace-group">
                <h3>Ambiguities flagged ({ambiguities.length})</h3>
                <div className="trace-cards">
                  {ambiguities.map((a, i) => (
                    <AmbiguityCardView key={i} item={a} />
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Compare-versions drawer: pick an earlier version, see a line diff. */}
      {compareOpen && (
        <div
          className="trace-drawer-backdrop"
          onClick={() => setCompareOpen(false)}
          role="presentation"
        >
          <aside
            className="trace-drawer vcmp-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Compare versions"
          >
            <div className="trace-drawer-head">
              <h2>Compare versions</h2>
              <button
                type="button"
                className="trace-drawer-close"
                onClick={() => setCompareOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {versions === null ? (
              <p className="trace-drawer-intro">
                <span className="spinner" /> Loading version history…
              </p>
            ) : versions.length < 2 ? (
              <p className="trace-drawer-intro">
                This document has only one version — nothing to compare yet.
              </p>
            ) : (
              <>
                <div className="vcmp-controls">
                  <label className="vcmp-pick">
                    <span>Compare</span>
                    <select
                      value={baseVersionId ?? ''}
                      onChange={(e) => setBaseVersionId(e.target.value || null)}
                      aria-label="Earlier version to compare"
                    >
                      {versions
                        .filter((v) => v.documentVersionId !== versionId)
                        .map((v) => (
                          <option key={v.documentVersionId} value={v.documentVersionId}>
                            v{v.versionNumber} · {versionSourceLabel(v.source)} ·{' '}
                            {formatDateTime(v.recordedAt)}
                          </option>
                        ))}
                    </select>
                    <span>with v{draft.versionNumber} (this one)</span>
                  </label>
                  <div className="vcmp-meta">
                    <label className="vcmp-toggle">
                      <input
                        type="checkbox"
                        checked={showUnchanged}
                        onChange={(e) => setShowUnchanged(e.target.checked)}
                      />
                      Show unchanged
                    </label>
                    <span className="vcmp-stat">
                      <span className="vcmp-stat-add">+{diffSummary.added}</span>{' '}
                      <span className="vcmp-stat-del">−{diffSummary.removed}</span>
                    </span>
                  </div>
                </div>

                {baseMarkdown === null ? (
                  <p className="trace-drawer-intro">
                    <span className="spinner" /> Loading…
                  </p>
                ) : diffSummary.added === 0 && diffSummary.removed === 0 ? (
                  <p className="trace-drawer-intro">These two versions are identical.</p>
                ) : (
                  <div className="vdiff">
                    <VersionDiff ops={diffOps} showUnchanged={showUnchanged} />
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}

      {/* Regenerate prompt window: editable instructions (prefilled with the
          revision notes) + a legal-skills picker, then redraft. */}
      {regenOpen && (
        <div className="modal-backdrop" onClick={() => setRegenOpen(false)} role="presentation">
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Regenerate draft"
          >
            <div className="modal-head">
              <h2>Regenerate draft</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setRegenOpen(false)}
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-muted" style={{ marginTop: 0 }}>
                Redraft this {humanizeKind(draft.documentKind)} with the live model. Your
                instructions and any selected legal skills guide the new version; the matter&apos;s
                questionnaire and transcript are always included.
              </p>
              <label>
                <span>Instructions for this draft</span>
                <textarea
                  rows={4}
                  value={regenGuidance}
                  onChange={(e) => setRegenGuidance(e.target.value)}
                  placeholder="e.g. Make the indemnification clause mutual and add a 30-day cure period."
                  autoFocus
                />
              </label>

              <div className="regen-skills">
                <div className="regen-skills-head">
                  <span>
                    Legal skills{' '}
                    {regenSkills.size > 0 && (
                      <span className="badge info">{regenSkills.size} selected</span>
                    )}
                  </span>
                  {skillCatalog && skillCatalog.length > 6 && (
                    <input
                      type="text"
                      value={skillQuery}
                      onChange={(e) => setSkillQuery(e.target.value)}
                      placeholder="Search skills…"
                      style={{ width: 'auto', flex: '1 1 10rem', minWidth: '9rem' }}
                    />
                  )}
                </div>
                {skillCatalog === null ? (
                  <p className="text-muted text-sm">
                    <span className="spinner" /> Loading skills…
                  </p>
                ) : skillCatalog.length === 0 ? (
                  <p className="text-muted text-sm">No legal skills configured.</p>
                ) : (
                  <div className="regen-skills-list">
                    {skillCatalog
                      .filter((s) => {
                        const q = skillQuery.trim().toLowerCase()
                        return (
                          !q ||
                          s.name.toLowerCase().includes(q) ||
                          s.slug.toLowerCase().includes(q) ||
                          s.practiceArea.toLowerCase().includes(q)
                        )
                      })
                      .map((s) => (
                        <label key={s.slug} className="regen-skill" title={s.whenToUse}>
                          <input
                            type="checkbox"
                            checked={regenSkills.has(s.slug)}
                            onChange={() => toggleSkill(s.slug)}
                            style={{ width: 'auto' }}
                          />
                          <span>
                            <strong>{s.name}</strong>
                            <span className="text-muted text-sm"> · {s.practiceArea}</span>
                          </span>
                        </label>
                      ))}
                  </div>
                )}
              </div>
              {error && <div className="alert alert-error">{error}</div>}
            </div>
            <div className="modal-foot">
              <button onClick={() => setRegenOpen(false)} disabled={busy === 'regenerate'}>
                Cancel
              </button>
              <button className="primary" onClick={runRegenerate} disabled={busy === 'regenerate'}>
                {busy === 'regenerate' && <span className="spinner" />}
                {busy === 'regenerate' ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function EvidenceCardView({ item }: { item: EvidenceItem }) {
  const source = item.source ?? 'system'
  const sourceClass = source === 'questionnaire' || source === 'transcript' ? source : 'system'
  return (
    <div className="evidence-card">
      <div className="evidence-card-head">
        <span className={`source-badge ${sourceClass}`}>{source}</span>
        {item.field && <span className="evidence-field">{item.field}</span>}
        {typeof item.confidence === 'number' && (
          <span className="evidence-confidence">
            {(item.confidence * 100).toFixed(0)}% confident
          </span>
        )}
      </div>
      {item.value !== undefined && item.value !== null && item.value !== '' && (
        <div className="evidence-value">{stringifyValue(item.value)}</div>
      )}
      {item.used_in && <div className="evidence-used-in">{item.used_in}</div>}
    </div>
  )
}

function AlternativeCardView({ item }: { item: Alternative }) {
  return (
    <div className="alt-card">
      <h3>{item.decision_point ?? 'Decision'}</h3>
      <div className="alt-options">
        {item.alternatives?.map((opt, i) => (
          <span key={i} className={opt === item.selected ? 'selected' : ''}>
            {opt}
            {i < (item.alternatives?.length ?? 0) - 1 ? ' · ' : ''}
          </span>
        ))}
      </div>
      {item.rationale && <div className="alt-rationale">{item.rationale}</div>}
    </div>
  )
}

function AmbiguityCardView({ item }: { item: Ambiguity }) {
  return (
    <div className="amb-card">
      <div className="amb-card-head">
        <span className="amb-card-topic">{item.topic ?? 'Ambiguity'}</span>
        {item.needs_input_from && (
          <span className="needs-input">needs {item.needs_input_from}</span>
        )}
      </div>
      {item.explanation && <div className="amb-card-body">{item.explanation}</div>}
    </div>
  )
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
