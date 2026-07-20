'use client'

import { use, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { downloadAsPdf, downloadAsWord, shareUrlFor, watermarkForStatus } from '@/lib/draftExport'
import { formatDateTimeShort } from '@/lib/datetime'
import { lineDiff, diffStats, type DiffOp } from '@/lib/lineDiff'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { DocumentActionBar } from '@/components/DocumentActionBar'
import { DocumentSheet, DocumentCanvas } from '@/components/DocumentSheet'
import { GemCluster } from '@/components/GemSparkle'
import { SendIcon, XIcon } from '@/components/icons'
import { SendToClientModal, type SendToClientMatter } from '@/components/SendToClientModal'
import { TrackedChangesEditor } from '@/components/TrackedChangesEditor'

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

const KIND_LABEL: Record<string, string> = {
  approved: 'Approved',
  executed: 'Executed',
  rejected: 'Rejected',
  revision_requested: 'Revision requested',
  pending_review: 'Awaiting review',
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
// Sentence case for the doc title only: capitalize the first character.
// humanizeKind's underscore-replace leaves a raw kind key ("attorney letter")
// all-lowercase; the comp shows sentence case ("Attorney letter"), not
// Title-Cased or CSS `capitalize` (which would upper the first letter of
// every word — "Attorney Letter").
function sentenceCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
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

  // Toolbar Edit / AI revision → the tracked-changes editor (li-edtr flagship).
  // 'ai' opens it with the Edit-with-AI rail focused; both are the SAME editor —
  // one flow, superseding the old inline markdown editor and the whole-doc
  // Revise-with-AI redline modal.
  const [editorMode, setEditorMode] = useState<null | 'page' | 'ai'>(null)

  // Email drafts keep their existing regenerate (async legal.email.draft) path.
  const [regenOpen, setRegenOpen] = useState(false)
  const [regenGuidance, setRegenGuidance] = useState('')

  // "Send to client" (unified send modal). DraftDetail has no clientEmail, so
  // opening fetches the matter first; sendMatter non-null = modal open.
  const [sendMatter, setSendMatter] = useState<SendToClientMatter | null>(null)
  const [sendOpening, setSendOpening] = useState(false)

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
    // A fresh version: drop any stale editor state.
    setEditorMode(null)
    setMcOpen(false)
    setNotice(null)
    setSendMatter(null)
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

  // Open the tracked-changes editor. 'page' = the toolbar Edit button; 'ai' = the
  // AI-revision disposition (same editor, AI rail focused).
  function openEditor(mode: 'page' | 'ai') {
    if (!draft) return
    setError(null)
    setNotice(null)
    setEditorMode(mode)
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

  // "Send to client" — fetch the matter (for the client's email) then open the
  // unified send modal, grounded on THIS loaded draft version.
  async function openSendToClient() {
    if (!draft || sendOpening) return
    setSendOpening(true)
    setError(null)
    try {
      const res = await callAttorneyMcp<{
        matter: { clientName: string | null; clientEmail: string | null } | null
      }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId: draft.matterEntityId },
      })
      if (!res.matter) throw new Error('Matter not found for this draft.')
      setSendMatter({
        entityId: draft.matterEntityId,
        matterNumber: draft.matterNumber,
        clientName: res.matter.clientName ?? draft.clientName,
        clientEmail: res.matter.clientEmail,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSendOpening(false)
    }
  }

  const evidence = useMemo(() => draft?.reasoningTrace?.evidence ?? [], [draft])
  const alternatives = useMemo(() => draft?.reasoningTrace?.alternatives_considered ?? [], [draft])
  const ambiguities = useMemo(() => draft?.reasoningTrace?.ambiguities ?? [], [draft])
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
  const title = isEmail
    ? draft.emailSubject || 'Email draft'
    : sentenceCase(humanizeKind(draft.documentKind))
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
            // Direct-open (row click / deep link, no Begin-review session): no
            // honest n/m is available here without fetching the whole pending
            // queue just to guess a position the attorney never walked — so the
            // pill reads plain "Exit review" rather than fabricate a count.
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
              Exit review
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
          <span className="li-rev-generated">
            Generated {formatDateTimeShort(draft.recordedAt)}
          </span>
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
            onClick={() => openEditor('page')}
            disabled={busy !== null}
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
              <button
                type="button"
                className="li-rev-tbtn"
                onClick={() => void openSendToClient()}
                disabled={busy !== null || sendOpening}
              >
                {sendOpening ? <span className="spinner" /> : <SendIcon size={15} />}
                Send To Client
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
              <GemCluster size={17} />
              Matter context
            </button>
          )}
        </div>
        <div className="li-rev-toolbar-group">
          <button
            type="button"
            className="li-rev-tbtn li-rev-tbtn--reject"
            onClick={() => dispose('legal.draft.reject', 'reject')}
            disabled={busy !== null || draft.status === 'rejected'}
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
              onClick={() => openEditor('ai')}
              disabled={busy !== null}
            >
              <GemCluster size={18} />
              AI Revision
            </button>
          )}
          {isEmail && (
            <button
              type="button"
              className="li-rev-tbtn"
              onClick={openRegen}
              disabled={busy !== null}
            >
              <GemCluster size={18} />
              Regenerate Email
            </button>
          )}
          <button
            type="button"
            className="li-rev-tbtn li-rev-tbtn--approve"
            onClick={() => dispose('legal.draft.approve', 'approve')}
            disabled={busy !== null || draft.status === 'approved'}
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

      {sendMatter && (
        <SendToClientModal
          matter={sendMatter}
          doc={{
            documentVersionId: draft.documentVersionId,
            documentKind: draft.documentKind,
            versionNumber: draft.versionNumber,
            status: draft.status,
          }}
          onClose={() => setSendMatter(null)}
          onSent={(msg) => setNotice(msg)}
        />
      )}

      {/* Matter context — the reasoning trace, inline (comp panel). */}
      {mcOpen && hasTrace && (
        <div className="li-rev-mc">
          <div className="li-rev-mc-head">
            <GemCluster size={17} />
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
              <h3>Alternatives Considered ({alternatives.length})</h3>
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
              <h3>Ambiguities Flagged ({ambiguities.length})</h3>
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

      {/* the document, as a proportional letter page */}
      <DocumentCanvas>
        <DocumentSheet variant="full" watermark={watermark}>
          <div
            className="doc-rendered li-rev-doc"
            dangerouslySetInnerHTML={{ __html: renderDocumentHtml(draft.bodyMarkdown) }}
          />
        </DocumentSheet>
      </DocumentCanvas>

      {/* The tracked-changes editor (li-edtr flagship) — Edit and AI revision are
          one flow; it persists nothing until its own Save (legal.draft.edit). */}
      {editorMode && (
        <TrackedChangesEditor
          draft={{
            documentVersionId: draft.documentVersionId,
            bodyMarkdown: draft.bodyMarkdown,
            documentKind: draft.documentKind,
            matterNumber: draft.matterNumber,
            clientName: draft.clientName,
            versionNumber: draft.versionNumber,
            status: draft.status,
          }}
          title={title}
          statusLine={
            draft.status === 'pending_review'
              ? 'Draft — pending attorney approval'
              : (KIND_LABEL[draft.status] ?? humanizeKind(draft.status))
          }
          aiEnabled={canRevise}
          initialFocus={editorMode}
          onClose={() => setEditorMode(null)}
          onSaved={(newId) => {
            setEditorMode(null)
            if (newId && newId !== versionId) router.push(`/attorney/review/${newId}`)
            else void load()
          }}
        />
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
              <GemCluster size={22} />
              <div className="li-rev-modal-titles">
                <h2>Regenerate Email</h2>
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
