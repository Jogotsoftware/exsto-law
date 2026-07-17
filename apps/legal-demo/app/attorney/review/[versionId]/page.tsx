'use client'

import { use, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { downloadAsPdf, downloadAsWord, shareUrlFor, watermarkForStatus } from '@/lib/draftExport'
import { formatDateTime } from '@/lib/datetime'
import { lineDiff, diffStats, type DiffOp } from '@/lib/lineDiff'
import { buildRedline, toReadableText } from '@/lib/wordDiff'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { DocumentActionBar } from '@/components/DocumentActionBar'
import { DocumentSheet, DocumentCanvas } from '@/components/DocumentSheet'
import { GemSparkle, GemShimmer } from '@/components/GemSparkle'
import { XIcon } from '@/components/icons'

// Step-through review session (started from the queue's "Begin review"): the ordered
// draft ids to walk, in sessionStorage, flagged on the URL with ?review=session.
const REVIEW_SESSION_KEY = 'reviewSession'

interface DraftDetail {
  documentVersionId: string
  documentEntityId: string
  matterEntityId: string
  matterNumber: string
  clientName: string
  serviceKey: string
  documentKind: string
  versionNumber: number
  status: string
  recordedAt: string
  channel: 'document' | 'communication'
  emailSubject: string | null
  emailToRole: string | null
  bodyMarkdown: string
  reasoningTrace: ReasoningTrace | null
  modelIdentity: string | null
  conclusion: string | null
  confidence: number | null
  reviewNotes: string | null
  aiReview: {
    reviewedDocumentVersionId: string | null
    reviewedDocumentEntityId: string | null
    reviewedOriginalFilename: string | null
    sourceText: string | null
    redlineText: string | null
  } | null
}

interface ReasoningTrace {
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

// The AI proposal currently under review as tracked changes (not yet persisted).
interface Revision {
  markdown: string
  instruction: string
  reasoningTraceId: string
}

const KIND_LABEL: Record<string, string> = {
  approved: 'Approved',
  executed: 'Executed',
  rejected: 'Rejected',
  revision_requested: 'Revision requested',
  pending_review: 'Pending review',
}
function statusChipClass(status: string): string {
  if (status === 'approved' || status === 'executed') return 'li-rev-chip li-rev-chip--ok'
  if (status === 'rejected') return 'li-rev-chip li-rev-chip--danger'
  if (status === 'revision_requested') return 'li-rev-chip li-rev-chip--warn'
  return 'li-rev-chip li-rev-chip--info'
}

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, ' ')
}
function humanizeService(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Line diff for AI-review MEMOS (client's doc vs the model's suggested redline) —
// a distinct, non-comp draft type kept working. The comp's word-level tracked
// changes (buildRedline) power the AI-revision flagship below.
function VersionDiff({ ops }: { ops: DiffOp[] }) {
  const rows: ReactNode[] = []
  let collapsed = false
  ops.forEach((op, i) => {
    if (op.type === 'same') {
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
    const cls = op.type === 'add' ? 'vdiff-add' : 'vdiff-del'
    const sign = op.type === 'add' ? '+' : '−'
    rows.push(
      <div key={i} className={`vdiff-line ${cls}`}>
        <span className="vdiff-sign" aria-hidden>
          {sign}
        </span>
        <span className="vdiff-text">{op.line || ' '}</span>
      </div>,
    )
  })
  return <>{rows}</>
}

// The four preset revision chips (comp-exact) — each runs immediately.
const REVISE_CHIPS = [
  'Make the tone firmer',
  'Shorten the deadline',
  'Add a confidentiality clause',
  'Simplify the language',
]

export default function DraftReviewPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params)
  const router = useRouter()
  const [draft, setDraft] = useState<DraftDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Matter context — the reasoning trace, inline below the toolbar (comp panel).
  const [mcOpen, setMcOpen] = useState(false)
  // AI-review memo suggested redline (memo drafts only).
  const [memoRedlineOpen, setMemoRedlineOpen] = useState(false)

  // Toolbar Edit → inline markdown editor over the sheet; save = new version.
  const [editing, setEditing] = useState(false)
  const [editMarkdown, setEditMarkdown] = useState('')
  const [editNote, setEditNote] = useState('')

  // The AI-revision flagship.
  const [reviseOpen, setReviseOpen] = useState(false)
  const [revisePrompt, setRevisePrompt] = useState('')
  const [reviseWorking, setReviseWorking] = useState(false)
  const [revision, setRevision] = useState<Revision | null>(null)
  const [redlineEditing, setRedlineEditing] = useState(false)
  const [redlineEditText, setRedlineEditText] = useState('')

  // Email drafts keep their existing regenerate (async legal.email.draft) path.
  const [regenOpen, setRegenOpen] = useState(false)
  const [regenGuidance, setRegenGuidance] = useState('')

  const [sessionIds, setSessionIds] = useState<string[] | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await callAttorneyMcp<{ draft: DraftDetail | null }>({
        toolName: 'legal.draft.get',
        input: { documentVersionId: versionId },
      })
      setDraft(res.draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    load()
    // A fresh version: drop any stale proposal / editor state.
    setRevision(null)
    setRedlineEditing(false)
    setEditing(false)
    setMcOpen(false)
    setNotice(null)
  }, [versionId])

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

  const sessionPos = sessionIds ? sessionIds.indexOf(versionId) : -1

  function exitSession() {
    try {
      window.sessionStorage.removeItem(REVIEW_SESSION_KEY)
    } catch {
      /* ignore */
    }
    router.push('/attorney/review')
  }

  function goSession(delta: number) {
    if (!sessionIds || sessionPos < 0) return
    const next = sessionPos + delta
    if (next < 0 || next >= sessionIds.length) return
    window.sessionStorage.setItem(
      REVIEW_SESSION_KEY,
      JSON.stringify({ ids: sessionIds, index: next }),
    )
    router.push(`/attorney/review/${sessionIds[next]}?review=session`)
  }

  // Approve / Reject (the comp's two dispositions; request-revision + standalone
  // regenerate are subsumed by AI revision). In a step-through session, a
  // disposition auto-advances to the next selected draft.
  async function dispose(toolName: string, label: string) {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      const res = await callAttorneyMcp<{ approvedDocumentVersionId?: string }>({
        toolName,
        input: { documentVersionId: versionId },
      })
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
      // Approve may have minted + approved a token-resolved version n+1; swap to it.
      const approvedId = res?.approvedDocumentVersionId
      if (approvedId && approvedId !== versionId) {
        router.replace(`/attorney/review/${approvedId}`)
        return
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // Toolbar Edit — inline markdown editor, seeded with the current body.
  function openEdit() {
    if (!draft) return
    setEditMarkdown(draft.bodyMarkdown)
    setEditNote('')
    setError(null)
    setNotice(null)
    setEditing(true)
  }
  async function saveEdit() {
    if (!draft || !editMarkdown.trim()) return
    setBusy('edit')
    setError(null)
    try {
      const result = await callAttorneyMcp<{ effects: Array<{ documentVersionId?: string }> }>({
        toolName: 'legal.draft.edit',
        input: {
          documentVersionId: versionId,
          documentMarkdown: editMarkdown,
          note: editNote.trim() || undefined,
        },
      })
      const newId = result.effects?.find((e) => e.documentVersionId)?.documentVersionId
      setEditing(false)
      if (newId && newId !== versionId) router.push(`/attorney/review/${newId}`)
      else await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // ── The AI-revision flagship ─────────────────────────────────────────────
  function openRevise() {
    setRevisePrompt('')
    setError(null)
    setReviseOpen(true)
  }

  // Generate the tracked-changes revision (sync AI). preset chips run immediately.
  async function runRevision(preset?: string) {
    const instruction = (preset ?? revisePrompt).trim()
    if (!instruction || reviseWorking) return
    setReviseWorking(true)
    setError(null)
    setRevisePrompt(instruction)
    try {
      const res = await callAttorneyMcp<{
        revisedMarkdown: string
        reasoningTraceId: string
        instruction: string
      }>({
        toolName: 'legal.draft.revise',
        input: { documentVersionId: versionId, instruction },
      })
      setRevision({
        markdown: res.revisedMarkdown,
        instruction: res.instruction,
        reasoningTraceId: res.reasoningTraceId,
      })
      setRedlineEditing(false)
      setReviseOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setReviseWorking(false)
    }
  }

  // Discard — no version was ever written; just drop the in-memory proposal.
  function discardRevision() {
    setRevision(null)
    setRedlineEditing(false)
  }

  // Accept all — persist the revised text as version n+1 (append-only draft.edit).
  async function acceptRevision() {
    if (!draft || !revision) return
    setBusy('accept')
    setError(null)
    try {
      const result = await callAttorneyMcp<{ effects: Array<{ documentVersionId?: string }> }>({
        toolName: 'legal.draft.edit',
        input: {
          documentVersionId: versionId,
          documentMarkdown: revision.markdown,
          note: `AI revision: ${revision.instruction}`,
        },
      })
      const newId = result.effects?.find((e) => e.documentVersionId)?.documentVersionId
      setRevision(null)
      if (newId && newId !== versionId) router.push(`/attorney/review/${newId}`)
      else await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  function enterRedlineEdit() {
    if (!revision) return
    setRedlineEditText(revision.markdown)
    setRedlineEditing(true)
  }
  function cancelRedlineEdit() {
    setRedlineEditing(false)
  }
  // Accept edits — persist the attorney-tweaked revised text as version n+1.
  async function acceptRedlineEdits() {
    if (!draft || !revision || !redlineEditText.trim()) return
    setBusy('accept')
    setError(null)
    try {
      const result = await callAttorneyMcp<{ effects: Array<{ documentVersionId?: string }> }>({
        toolName: 'legal.draft.edit',
        input: {
          documentVersionId: versionId,
          documentMarkdown: redlineEditText,
          note: `AI revision (edited): ${revision.instruction}`,
        },
      })
      const newId = result.effects?.find((e) => e.documentVersionId)?.documentVersionId
      setRevision(null)
      setRedlineEditing(false)
      if (newId && newId !== versionId) router.push(`/attorney/review/${newId}`)
      else await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // Email regenerate (existing variant behavior — async).
  function openRegen() {
    setRegenGuidance('')
    setError(null)
    setRegenOpen(true)
  }
  async function runRegenerateEmail() {
    if (!draft) return
    setBusy('regenerate')
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.email.draft',
        input: {
          matterEntityId: draft.matterEntityId,
          purpose: 'Regenerate this email',
          supersedesDocumentEntityId: draft.documentEntityId,
          guidance: regenGuidance.trim() || undefined,
        },
      })
      setRegenOpen(false)
      setNotice(
        'Regenerating this email with your instructions — the new version will appear in the review queue shortly.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const evidence = useMemo(() => draft?.reasoningTrace?.evidence ?? [], [draft])
  const alternatives = useMemo(() => draft?.reasoningTrace?.alternatives_considered ?? [], [draft])
  const ambiguities = useMemo(() => draft?.reasoningTrace?.ambiguities ?? [], [draft])
  const redlineParas = useMemo(
    () =>
      draft && revision && !redlineEditing
        ? buildRedline(toReadableText(draft.bodyMarkdown), toReadableText(revision.markdown))
        : [],
    [draft, revision, redlineEditing],
  )
  const memoRedlineOps = useMemo(
    () =>
      draft?.aiReview?.sourceText && draft.aiReview.redlineText
        ? lineDiff(draft.aiReview.sourceText, draft.aiReview.redlineText)
        : [],
    [draft],
  )
  const memoRedlineSummary = useMemo(() => diffStats(memoRedlineOps), [memoRedlineOps])

  if (!draft && !error) {
    return (
      <main className="li-rev">
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading draft…
        </div>
      </main>
    )
  }
  if (error && !draft) {
    return (
      <main className="li-rev">
        <div className="alert alert-error">{error}</div>
      </main>
    )
  }
  if (!draft) {
    return (
      <main className="li-rev">
        <p>Draft not found.</p>
      </main>
    )
  }

  const isEmail = draft.channel === 'communication'
  const isMemo = Boolean(draft.aiReview)
  const canRevise = !isEmail && !isMemo
  const hasTrace = Boolean(
    draft.reasoningTrace ||
    draft.modelIdentity ||
    draft.confidence !== null ||
    evidence.length ||
    alternatives.length ||
    ambiguities.length,
  )
  const docFileBase = `${humanizeKind(draft.documentKind).replace(/\s+/g, '-').toLowerCase()}-${draft.matterNumber}`
  const watermark = watermarkForStatus(draft.status)?.toUpperCase()
  const title = isEmail ? draft.emailSubject || 'Email draft' : humanizeKind(draft.documentKind)
  const subParts = [
    draft.clientName,
    isEmail ? 'Email' : draft.serviceKey ? humanizeService(draft.serviceKey) : '',
  ].filter(Boolean)

  const prevDisabled = !sessionIds || sessionPos <= 0
  const nextDisabled = !sessionIds || sessionPos < 0 || sessionPos >= sessionIds.length - 1

  return (
    <main className="li-rev">
      {/* top toolbar: exit / matter pills + prev / next */}
      <div className="li-rev-top">
        <div className="li-rev-top-left">
          {sessionPos >= 0 && sessionIds ? (
            <button type="button" className="li-rev-pill" onClick={exitSession}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <polyline
                  points="15 18 9 12 15 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Exit review ({sessionPos + 1} of {sessionIds.length})
            </button>
          ) : (
            <Link href="/attorney/review" className="li-rev-pill">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <polyline
                  points="15 18 9 12 15 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Review queue
            </Link>
          )}
          <Link
            href={`/attorney/matters/${draft.matterEntityId}`}
            className="li-rev-pill li-rev-pill--matter"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 4h9l5 5v11H4z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M13 4v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            Matter&nbsp;<span className="li-rev-mono">{draft.matterNumber}</span>
          </Link>
        </div>
        <div className="li-rev-top-right">
          <button
            type="button"
            className="li-rev-nav"
            onClick={() => goSession(-1)}
            disabled={prevDisabled}
            title="Previous draft"
            aria-label="Previous draft"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <polyline
                points="15 18 9 12 15 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="li-rev-nav"
            onClick={() => goSession(1)}
            disabled={nextDisabled}
            title="Next draft"
            aria-label="Next draft"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <polyline
                points="9 18 15 12 9 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* title row + meta */}
      <div className="li-rev-titlerow">
        <h1 className="li-rev-doctitle">{title}</h1>
        <div className="li-rev-meta">
          <span className="li-rev-generated">Generated {formatDateTime(draft.recordedAt)}</span>
          <span className="li-rev-vbadge">v{draft.versionNumber}</span>
          <span className={statusChipClass(draft.status)}>
            {KIND_LABEL[draft.status] ?? humanizeKind(draft.status)}
          </span>
        </div>
      </div>
      <div className="li-rev-subline">
        {subParts.join(' · ')}
        {subParts.length > 0 ? ' · ' : ''}
        <Link href={`/attorney/matters/${draft.matterEntityId}`} className="li-rev-openmatter">
          Open matter
        </Link>
      </div>

      {/* action toolbar */}
      <div className="li-rev-toolbar">
        <div className="li-rev-toolbar-group">
          <button
            type="button"
            className="li-rev-tbtn"
            onClick={openEdit}
            disabled={busy !== null || editing}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 20h9"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Edit
          </button>
          {!isEmail && (
            <>
              <button
                type="button"
                className="li-rev-tbtn li-rev-tbtn--pdf"
                onClick={() =>
                  downloadAsPdf(draft.bodyMarkdown, docFileBase, { status: draft.status })
                }
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M4 4h9l5 5v11H4z"
                    stroke="#c4443b"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                  <path d="M13 4v5h5" stroke="#c4443b" strokeWidth="1.7" strokeLinejoin="round" />
                </svg>
                PDF
              </button>
              <button
                type="button"
                className="li-rev-tbtn li-rev-tbtn--word"
                onClick={() =>
                  downloadAsWord(draft.bodyMarkdown, docFileBase, { status: draft.status })
                }
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M4 4h9l5 5v11H4z"
                    stroke="#2b579a"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                  <path d="M13 4v5h5" stroke="#2b579a" strokeWidth="1.7" strokeLinejoin="round" />
                </svg>
                Word
              </button>
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
            </>
          )}
          {isMemo && draft.aiReview?.reviewedDocumentVersionId && (
            <a
              className="li-rev-tbtn"
              href={`/api/attorney/matters/${draft.matterEntityId}/documents/${draft.aiReview.reviewedDocumentVersionId}/download`}
            >
              Reviewed file ↓
            </a>
          )}
          {isMemo && memoRedlineOps.length > 0 && (
            <button
              type="button"
              className="li-rev-tbtn"
              onClick={() => setMemoRedlineOpen((v) => !v)}
            >
              Suggested redline ({memoRedlineSummary.added}+ / {memoRedlineSummary.removed}−)
            </button>
          )}
          {hasTrace && (
            <button
              type="button"
              className={`li-rev-tbtn li-rev-tbtn--ai${mcOpen ? ' is-on' : ''}`}
              onClick={() => setMcOpen((v) => !v)}
            >
              <GemSparkle size={15} />
              Matter context
            </button>
          )}
        </div>
        <div className="li-rev-toolbar-group">
          <button
            type="button"
            className="li-rev-tbtn li-rev-tbtn--reject"
            onClick={() => dispose('legal.draft.reject', 'reject')}
            disabled={busy !== null || editing || draft.status === 'rejected'}
          >
            {busy === 'reject' ? (
              <span className="spinner" />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <line
                  x1="18"
                  y1="6"
                  x2="6"
                  y2="18"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <line
                  x1="6"
                  y1="6"
                  x2="18"
                  y2="18"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            )}
            Reject
          </button>
          {canRevise && (
            <button
              type="button"
              className="li-rev-tbtn li-rev-tbtn--revise"
              onClick={openRevise}
              disabled={busy !== null || editing || Boolean(revision)}
            >
              <GemSparkle size={16} />
              AI revision
            </button>
          )}
          {isEmail && (
            <button
              type="button"
              className="li-rev-tbtn"
              onClick={openRegen}
              disabled={busy !== null || editing}
            >
              <GemSparkle size={16} />
              Regenerate email
            </button>
          )}
          <button
            type="button"
            className="li-rev-tbtn li-rev-tbtn--approve"
            onClick={() => dispose('legal.draft.approve', 'approve')}
            disabled={busy !== null || editing || draft.status === 'approved'}
          >
            {busy === 'approve' ? (
              <span className="spinner" />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <polyline
                  points="20 6 9 17 4 12"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {isEmail ? 'Approve & send email' : 'Approve'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error li-rev-alert">{error}</div>}
      {notice && <div className="alert alert-success li-rev-alert">{notice}</div>}

      {/* Matter context — the reasoning trace, inline (comp panel). */}
      {mcOpen && hasTrace && (
        <div className="li-rev-mc">
          <div className="li-rev-mc-head">
            <GemSparkle size={15} />
            <span>Matter context</span>
          </div>
          <p className="li-rev-mc-intro">
            How the assistant drafted this — the inputs it used and the choices it made. Your
            context for the review; the client never sees it.
          </p>
          <div className="li-rev-mc-summary">
            <span>
              <strong>Model</strong> {draft.modelIdentity ?? '(unknown)'}
            </span>
            {draft.confidence !== null && (
              <span>
                <strong>Confidence</strong> {(draft.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
          {draft.conclusion && <p className="li-rev-mc-conclusion">{draft.conclusion}</p>}
          {evidence.length > 0 && (
            <div className="li-rev-mc-group">
              <h3>Evidence ({evidence.length})</h3>
              {evidence.map((e, i) => (
                <div key={i} className="li-rev-mc-card">
                  <div className="li-rev-mc-card-head">
                    <span
                      className={`source-badge ${e.source === 'questionnaire' || e.source === 'transcript' ? e.source : 'system'}`}
                    >
                      {e.source ?? 'system'}
                    </span>
                    {e.field && <span className="li-rev-mc-field">{e.field}</span>}
                  </div>
                  {e.value !== undefined && e.value !== null && e.value !== '' && (
                    <div className="li-rev-mc-value">{stringifyValue(e.value)}</div>
                  )}
                  {e.used_in && <div className="li-rev-mc-usedin">{e.used_in}</div>}
                </div>
              ))}
            </div>
          )}
          {alternatives.length > 0 && (
            <div className="li-rev-mc-group">
              <h3>Alternatives considered ({alternatives.length})</h3>
              {alternatives.map((a, i) => (
                <div key={i} className="li-rev-mc-card">
                  <strong>{a.decision_point ?? 'Decision'}</strong>
                  {a.rationale && <div className="li-rev-mc-usedin">{a.rationale}</div>}
                </div>
              ))}
            </div>
          )}
          {ambiguities.length > 0 && (
            <div className="li-rev-mc-group">
              <h3>Ambiguities flagged ({ambiguities.length})</h3>
              {ambiguities.map((a, i) => (
                <div key={i} className="li-rev-mc-card">
                  <strong>{a.topic ?? 'Ambiguity'}</strong>
                  {a.explanation && <div className="li-rev-mc-usedin">{a.explanation}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI-review memo: source vs suggested redline (memo drafts only). */}
      {isMemo && memoRedlineOpen && memoRedlineOps.length > 0 && (
        <div className="li-rev-mc">
          <div className="li-rev-mc-head">
            <span>
              Suggested redline
              {draft.aiReview?.reviewedOriginalFilename
                ? ` — ${draft.aiReview.reviewedOriginalFilename}`
                : ''}
            </span>
          </div>
          <div className="vdiff">
            <VersionDiff ops={memoRedlineOps} />
          </div>
        </div>
      )}

      {/* Tracked-changes banner (redline mode / edit mode). */}
      {revision && (
        <div className="li-rev-redline-banner">
          <GemSparkle size={24} />
          <div className="li-rev-redline-copy">
            <div className="li-rev-redline-head">
              AI revision — {redlineEditing ? 'edit the revised draft' : 'tracked changes'}
            </div>
            <div className="li-rev-redline-sub">
              “{revision.instruction}” ·{' '}
              {redlineEditing ? (
                'tweak the accepted text, then save your edits'
              ) : (
                <>
                  <span className="li-rev-redline-del">deletions</span> and{' '}
                  <span className="li-rev-redline-ins">insertions</span> shown inline
                </>
              )}
            </div>
          </div>
          {redlineEditing ? (
            <div className="li-rev-redline-btns">
              <button
                type="button"
                className="li-rev-rbtn"
                onClick={cancelRedlineEdit}
                disabled={busy !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className="li-rev-rbtn li-rev-rbtn--accept"
                onClick={acceptRedlineEdits}
                disabled={busy !== null || !redlineEditText.trim()}
              >
                {busy === 'accept' ? <span className="spinner" /> : '✓'} Accept edits
              </button>
            </div>
          ) : (
            <div className="li-rev-redline-btns">
              <button
                type="button"
                className="li-rev-rbtn li-rev-rbtn--discard"
                onClick={discardRevision}
                disabled={busy !== null}
              >
                Discard changes
              </button>
              <button
                type="button"
                className="li-rev-rbtn"
                onClick={enterRedlineEdit}
                disabled={busy !== null}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 20h9"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Edit
              </button>
              <button
                type="button"
                className="li-rev-rbtn li-rev-rbtn--accept"
                onClick={acceptRevision}
                disabled={busy !== null}
              >
                {busy === 'accept' ? <span className="spinner" /> : '✓'} Accept all
              </button>
            </div>
          )}
        </div>
      )}

      {/* the document, as a proportional letter page */}
      <DocumentCanvas>
        <DocumentSheet variant="full" watermark={editing ? undefined : watermark}>
          {editing ? (
            <div className="li-rev-editor">
              <textarea
                className="li-rev-editor-area"
                value={editMarkdown}
                onChange={(e) => setEditMarkdown(e.target.value)}
                spellCheck
                aria-label="Document markdown"
              />
              <input
                type="text"
                className="li-rev-editor-note"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Optional: note what you changed (kept in version history)"
                disabled={busy === 'edit'}
              />
              <div className="li-rev-editor-actions">
                <button
                  className="li-rev-rbtn li-rev-rbtn--accept"
                  onClick={saveEdit}
                  disabled={busy === 'edit' || !editMarkdown.trim()}
                >
                  {busy === 'edit' && <span className="spinner" />}
                  {busy === 'edit' ? 'Saving…' : 'Save as new version'}
                </button>
                <button
                  className="li-rev-rbtn"
                  onClick={() => setEditing(false)}
                  disabled={busy === 'edit'}
                >
                  Cancel
                </button>
                <span className="li-rev-editor-hint">
                  Saving creates a new version; the original is preserved.
                </span>
              </div>
            </div>
          ) : revision && redlineEditing ? (
            <textarea
              className="li-rev-redline-editarea"
              value={redlineEditText}
              onChange={(e) => setRedlineEditText(e.target.value)}
              spellCheck
              aria-label="Revised document text"
            />
          ) : revision ? (
            <div className="li-rev-redline-doc">
              {redlineParas.map((p, i) =>
                p.runs.length === 0 ? (
                  <p key={i} className="li-rev-redline-blank">
                    &nbsp;
                  </p>
                ) : (
                  <p key={i}>
                    {p.runs.map((r, j) => (
                      <span key={j} className={`li-rev-run li-rev-run--${r.kind}`}>
                        {r.text}
                      </span>
                    ))}
                  </p>
                ),
              )}
            </div>
          ) : (
            <div
              className="doc-rendered li-rev-doc"
              dangerouslySetInnerHTML={{ __html: renderDocumentHtml(draft.bodyMarkdown) }}
            />
          )}
          {reviseWorking && <GemShimmer />}
        </DocumentSheet>
      </DocumentCanvas>

      {/* Revise with AI modal (the flagship). */}
      {reviseOpen && (
        <div
          className="li-rev-modal-backdrop"
          onClick={() => !reviseWorking && setReviseOpen(false)}
          role="presentation"
        >
          <div
            className="li-rev-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Revise with AI"
          >
            {reviseWorking && <GemShimmer />}
            <div className="li-rev-modal-head">
              <GemSparkle size={20} />
              <div className="li-rev-modal-titles">
                <h2>Revise with AI</h2>
                <div className="li-rev-modal-sub">
                  {humanizeKind(draft.documentKind)}
                  {draft.clientName ? ` · ${draft.clientName}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="li-rev-modal-close"
                onClick={() => setReviseOpen(false)}
                disabled={reviseWorking}
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <div className="li-rev-modal-body">
              <label className="li-rev-modal-label">What should change?</label>
              <textarea
                className="li-rev-modal-textarea"
                value={revisePrompt}
                onChange={(e) => setRevisePrompt(e.target.value)}
                placeholder="e.g. Make the tone firmer and shorten the response deadline."
                disabled={reviseWorking}
                autoFocus
              />
              <div className="li-rev-chips">
                {REVISE_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="li-rev-chip-btn"
                    onClick={() => runRevision(chip)}
                    disabled={reviseWorking}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <line
                        x1="12"
                        y1="5"
                        x2="12"
                        y2="19"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <line
                        x1="5"
                        y1="12"
                        x2="19"
                        y2="12"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                    {chip}
                  </button>
                ))}
              </div>
              <div className="li-rev-modal-note">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
                  <line
                    x1="12"
                    y1="11"
                    x2="12"
                    y2="16"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                  <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="currentColor" />
                </svg>
                <span>
                  The AI drafts tracked changes on the current version. Nothing is sent to the
                  client — you review the redlines and accept or reject.
                </span>
              </div>
            </div>
            <div className="li-rev-modal-foot">
              <button
                type="button"
                className="li-rev-rbtn"
                onClick={() => setReviseOpen(false)}
                disabled={reviseWorking}
              >
                Cancel
              </button>
              <button
                type="button"
                className="li-rev-modal-generate"
                onClick={() => runRevision()}
                disabled={reviseWorking || !revisePrompt.trim()}
              >
                <GemSparkle size={16} />
                {reviseWorking ? 'Drafting…' : 'Generate revision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email regenerate modal (existing variant behavior). */}
      {regenOpen && (
        <div
          className="li-rev-modal-backdrop"
          onClick={() => setRegenOpen(false)}
          role="presentation"
        >
          <div
            className="li-rev-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Regenerate email"
          >
            <div className="li-rev-modal-head">
              <GemSparkle size={20} />
              <div className="li-rev-modal-titles">
                <h2>Regenerate email</h2>
                <div className="li-rev-modal-sub">{draft.emailSubject || 'Email draft'}</div>
              </div>
              <button
                type="button"
                className="li-rev-modal-close"
                onClick={() => setRegenOpen(false)}
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <div className="li-rev-modal-body">
              <label className="li-rev-modal-label">Instructions for the new draft</label>
              <textarea
                className="li-rev-modal-textarea"
                value={regenGuidance}
                onChange={(e) => setRegenGuidance(e.target.value)}
                placeholder="e.g. Warmer opening; confirm the consultation time."
                autoFocus
              />
              <div className="li-rev-modal-note">
                <span>
                  Redraft this email with the live model. The new version lands in the review queue
                  — approving it sends it.
                </span>
              </div>
            </div>
            <div className="li-rev-modal-foot">
              <button
                type="button"
                className="li-rev-rbtn"
                onClick={() => setRegenOpen(false)}
                disabled={busy === 'regenerate'}
              >
                Cancel
              </button>
              <button
                type="button"
                className="li-rev-modal-generate"
                onClick={runRegenerateEmail}
                disabled={busy === 'regenerate'}
              >
                {busy === 'regenerate' ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
