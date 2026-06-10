'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { downloadAsPdf, downloadAsWord, renderMarkdown, shareUrlFor } from '@/lib/draftExport'

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

  const [emailStatus, setEmailStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

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

  async function emailDraftLink() {
    if (!draft) return
    if (typeof window !== 'undefined' && !window.confirm('Send draft link to the client on file?'))
      return
    setBusy('email')
    setEmailStatus(null)
    try {
      const result = await callAttorneyMcp<{ messageId: string; from: string; to: string }>({
        toolName: 'legal.email.send_draft_link',
        input: {
          matterEntityId: draft.matterEntityId,
          documentVersionId: draft.documentVersionId,
          shareUrl: shareUrlFor(draft.documentVersionId),
        },
      })
      setEmailStatus({ kind: 'ok', msg: `Sent to ${result.to}` })
      setTimeout(() => setEmailStatus(null), 6000)
    } catch (err) {
      setEmailStatus({
        kind: 'err',
        msg: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    load()
  }, [versionId])

  async function review(toolName: string, label: string, requireNotes: boolean) {
    if (requireNotes && !notes.trim()) {
      setError('Review notes are required for this action.')
      return
    }
    setBusy(label)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName,
        input: { documentVersionId: versionId, reviewNotes: notes.trim() || undefined },
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function regenerate() {
    if (!draft) return
    setBusy('regenerate')
    setError(null)
    try {
      const result = await callAttorneyMcp<{
        actionId: string
        effects: Array<{ documentVersionId: string; versionNumber: number }>
      }>({
        toolName: 'legal.draft.generate',
        input: {
          matterEntityId: draft.matterEntityId,
          documentKind:
            draft.documentKind === 'engagement_letter'
              ? 'engagement_letter'
              : 'operating_agreement',
        },
      })
      const newId = result.effects[0]?.documentVersionId
      if (newId) {
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

  return (
    <main>
      <p style={{ fontSize: '0.88rem' }}>
        <Link href="/attorney/review">← Review queue</Link>
        {' · '}
        <Link href={`/attorney/matters/${draft.matterEntityId}`}>Matter {draft.matterNumber}</Link>
      </p>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.7rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
        }}
      >
        <h1 style={{ margin: 0 }}>
          {humanizeKind(draft.documentKind)} · v{draft.versionNumber}
        </h1>
        <span className={statusBadge(draft.status)}>{draft.status.replace(/_/g, ' ')}</span>
        <span style={{ color: 'var(--muted)', fontSize: '0.88rem', marginLeft: 'auto' }}>
          generated {new Date(draft.recordedAt).toLocaleString()}
        </span>
      </div>

      <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <button
          onClick={() =>
            downloadAsPdf(
              draft.bodyMarkdown,
              `${humanizeKind(draft.documentKind).replace(/\s+/g, '-').toLowerCase()}-${draft.matterNumber}`,
            )
          }
        >
          Download PDF
        </button>
        <button
          onClick={() =>
            downloadAsWord(
              draft.bodyMarkdown,
              `${humanizeKind(draft.documentKind).replace(/\s+/g, '-').toLowerCase()}-${draft.matterNumber}`,
            )
          }
        >
          Download Word
        </button>
        <button onClick={emailDraftLink} disabled={busy === 'email'}>
          {busy === 'email' && <span className="spinner" />}
          {busy === 'email' ? 'Sending…' : 'Email link to client'}
        </button>
        <a
          href={shareUrlFor(draft.documentVersionId)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 'auto' }}
        >
          <button>Open client view ↗</button>
        </a>
      </div>
      {emailStatus && (
        <div
          className={`alert ${emailStatus.kind === 'ok' ? '' : 'alert-error'}`}
          style={
            emailStatus.kind === 'ok'
              ? {
                  background: 'var(--ok-soft)',
                  color: '#166534',
                  border: '1px solid #86efac',
                  marginBottom: 'var(--space-4)',
                }
              : { marginBottom: 'var(--space-4)' }
          }
        >
          {emailStatus.msg}
        </div>
      )}

      <div className="split-review">
        <div
          className="doc-rendered"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.bodyMarkdown) }}
        />

        <div className="trace-rail">
          <div className="trace-summary">
            <h2 style={{ marginTop: 0 }}>Reasoning trace</h2>
            <div className="trace-summary-row">
              <span>
                <strong>Model:</strong> {draft.modelIdentity ?? '(unknown)'}
              </span>
            </div>
            {draft.confidence !== null && (
              <>
                <div className="trace-summary-row">
                  <span>
                    <strong>Overall confidence:</strong> {(draft.confidence * 100).toFixed(0)}%
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
            {draft.conclusion && (
              <p style={{ margin: '0.8rem 0 0', fontSize: '0.88rem', color: '#374151' }}>
                {draft.conclusion}
              </p>
            )}
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
        </div>
      </div>

      <section>
        <h2>Review</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <label>
          Notes (required for revision; optional otherwise)
          <textarea
            rows={4}
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
            onClick={regenerate}
            title="Calls Claude live and creates a new version of this document for the same matter."
          >
            {busy === 'regenerate' && <span className="spinner" />}
            {busy === 'regenerate' ? 'Drafting via live API…' : 'Regenerate draft (live API)'}
          </button>
        </div>
      </section>
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
