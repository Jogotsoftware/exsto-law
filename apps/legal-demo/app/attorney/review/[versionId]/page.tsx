'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { downloadAsPdf, downloadAsWord, shareUrlFor } from '@/lib/draftExport'
import { formatDateTime } from '@/lib/datetime'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { DocumentActionBar } from '@/components/DocumentActionBar'

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

  // Esc closes the reasoning-trace drawer.
  useEffect(() => {
    if (!traceOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTraceOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [traceOpen])

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
          <button type="button" className="review-back" onClick={exitSession}>
            ← Exit review ({sessionPos + 1} of {sessionIds.length})
          </button>
        ) : (
          <Link href="/attorney/review" className="review-back">
            ← Review queue
          </Link>
        )}
        <Link href={`/attorney/matters/${draft.matterEntityId}`} className="review-back">
          Matter {draft.matterNumber}
        </Link>
      </div>

      <header className="review-header">
        <div className="review-header-main">
          <h1>{humanizeKind(draft.documentKind)}</h1>
          <span className="review-version">v{draft.versionNumber}</span>
          <span className={statusBadge(draft.status)}>{draft.status.replace(/_/g, ' ')}</span>
        </div>
        <span className="review-meta">Generated {formatDateTime(draft.recordedAt)}</span>
      </header>

      <div className="review-toolbar">
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
        {hasTrace && (
          <button
            type="button"
            className="review-trace-btn"
            onClick={() => setTraceOpen(true)}
            title="How the AI drafted this — your context, not part of the document."
          >
            ✦ Reasoning trace
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

      {/* The document, as a page. */}
      <div className="review-canvas">
        <article
          className="doc-rendered doc-paper"
          dangerouslySetInnerHTML={{ __html: renderDocumentHtml(draft.bodyMarkdown) }}
        />
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
            style={{ marginTop: '0.35rem' }}
          />
        </label>
        <div className="review-actions">
          <button
            className="ok"
            disabled={busy !== null || draft.status === 'approved'}
            onClick={() => review('legal.draft.approve', 'approve', false)}
          >
            {busy === 'approve' && <span className="spinner" />}
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button
            className="warn"
            disabled={busy !== null}
            onClick={() => review('legal.draft.request_revision', 'revision', true)}
          >
            {busy === 'revision' && <span className="spinner" />}
            {busy === 'revision' ? 'Requesting…' : 'Request revision'}
          </button>
          <button
            className="danger"
            disabled={busy !== null || draft.status === 'rejected'}
            onClick={() => review('legal.draft.reject', 'reject', false)}
          >
            {busy === 'reject' && <span className="spinner" />}
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
          <span style={{ marginLeft: 'auto' }} />
          <button
            disabled={busy !== null}
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
                ×
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
              <h2 style={{ margin: 0 }}>Regenerate draft</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setRegenOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--muted)', marginTop: 0 }}>
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
      <h4>{item.decision_point ?? 'Decision'}</h4>
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
