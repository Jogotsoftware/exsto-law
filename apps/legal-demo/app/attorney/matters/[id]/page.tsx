'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'
import { ChevronLeftIcon } from '@/components/icons'
import { downloadAsPdf, downloadAsWord, shareUrlFor } from '@/lib/draftExport'

interface MatterDetail {
  matterEntityId: string
  matterNumber: string
  clientName: string
  clientEmail: string | null
  practiceArea: string
  status: string
  summary: string
  createdAt: string
  attributes: Record<string, unknown>
  questionnaireResponses: Record<string, unknown> | null
  transcriptText: string | null
  latestDraftVersionId: string | null
  latestDraftStatus: string | null
}

interface DraftPayload {
  documentVersionId: string
  matterEntityId: string
  matterNumber: string
  documentKind: string
  versionNumber: number
  status: string
  recordedAt: string
  bodyMarkdown: string
}

function humanizeKind(k: string): string {
  return k.replace(/_/g, ' ')
}

function humanizeService(key: string): string {
  if (!key) return '—'
  if (key === 'llc_formation') return 'NC LLC formation'
  if (key === 'oa_amendment') return 'OA amendment'
  if (key === 'business_formation') return 'NC LLC formation'
  if (key === 'other') return 'Custom'
  return key.replace(/_/g, ' ')
}

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ')
}

function statusBadgeClass(status: string): string {
  if (['consultation_scheduled', 'consultation_completed'].includes(status)) return 'badge info'
  if (['drafting', 'review_pending'].includes(status)) return 'badge warn'
  if (['engagement_signed', 'matter_active'].includes(status)) return 'badge ok'
  return 'badge'
}

function humanizeKey(key: string): string {
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function humanizeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(value + 'T00:00:00').toLocaleDateString()
    }
    return value.replace(/_/g, ' ')
  }
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

interface SendDraftLinkResult {
  messageId: string
  from: string
  to: string
}

interface MatterActionEntry {
  actionId: string
  kindName: string
  intentKind: string
  autonomyTier: string
  actorName: string
  actorType: string
  hasReasoningTrace: boolean
  recordedAt: string
}

interface MatterEventEntry {
  eventId: string
  kindName: string
  data: Record<string, unknown>
  occurredAt: string
}

interface MatterHistory {
  actions: MatterActionEntry[]
  events: MatterEventEntry[]
}

export default function MatterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [matter, setMatter] = useState<MatterDetail | null>(null)
  const [latestDraft, setLatestDraft] = useState<DraftPayload | null>(null)
  const [history, setHistory] = useState<MatterHistory | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [emailStatus, setEmailStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await callAttorneyMcp<{ matter: MatterDetail | null }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId: id },
      })
      setMatter(res.matter)
      if (res.matter?.latestDraftVersionId) {
        const draftRes = await callAttorneyMcp<{ draft: DraftPayload | null }>({
          toolName: 'legal.draft.get',
          input: { documentVersionId: res.matter.latestDraftVersionId },
        })
        setLatestDraft(draftRes.draft)
      } else {
        setLatestDraft(null)
      }
      const hist = await callAttorneyMcp<MatterHistory>({
        toolName: 'legal.matter.history',
        input: { matterEntityId: id },
      })
      setHistory(hist)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    load()
  }, [id])

  async function action(label: string, toolName: string, input: Record<string, unknown>) {
    setBusy(label)
    setError(null)
    try {
      await callAttorneyMcp({ toolName, input })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function emailDraftLink() {
    if (!latestDraft || !matter) return
    const defaultTo = matter.clientEmail ?? ''
    const to =
      defaultTo ||
      (typeof window !== 'undefined'
        ? (
            window.prompt('No client email on file. Send draft link to which email?', '') ?? ''
          ).trim()
        : '')
    if (!to) {
      setEmailStatus({
        kind: 'err',
        msg: 'No recipient. Add a client email to the contact or enter one when prompted.',
      })
      return
    }
    if (typeof window !== 'undefined' && !window.confirm(`Send draft link to ${to}?`)) return
    setBusy('email')
    setEmailStatus(null)
    try {
      const result = await callAttorneyMcp<SendDraftLinkResult>({
        toolName: 'legal.email.send_draft_link',
        input: {
          matterEntityId: id,
          documentVersionId: latestDraft.documentVersionId,
          shareUrl: shareUrlFor(latestDraft.documentVersionId),
          to,
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

  if (!matter && !error) {
    return (
      <main>
        <div className="loading-block">
          <span className="spinner" /> Loading matter…
        </div>
      </main>
    )
  }
  if (error && !matter) {
    return (
      <main>
        <Link href="/attorney/matters" className="back-link">
          <ChevronLeftIcon size={14} /> All matters
        </Link>
        <div className="alert alert-error">{error}</div>
      </main>
    )
  }
  if (!matter) {
    return (
      <main>
        <Link href="/attorney/matters" className="back-link">
          <ChevronLeftIcon size={14} /> All matters
        </Link>
        <p className="text-muted">Matter not found.</p>
      </main>
    )
  }

  const hasQuestionnaire = matter.questionnaireResponses !== null
  const hasTranscript = matter.transcriptText !== null

  return (
    <main>
      <Link href="/attorney/matters" className="back-link">
        <ChevronLeftIcon size={14} /> All matters
      </Link>
      <PageHead title={matter.matterNumber} description={matter.summary || undefined} />

      <section>
        <h2>Overview</h2>
        <div className="kv-grid">
          <div>
            <div className="kv-label">Client</div>
            <div className="kv-value">{matter.clientName || '—'}</div>
          </div>
          <div>
            <div className="kv-label">Practice area</div>
            <div className="kv-value">{humanizeService(matter.practiceArea)}</div>
          </div>
          <div>
            <div className="kv-label">Status</div>
            <div className="kv-value">
              <span className={statusBadgeClass(matter.status)}>
                {humanizeStatus(matter.status)}
              </span>
            </div>
          </div>
          <div>
            <div className="kv-label">Opened</div>
            <div className="kv-value">{new Date(matter.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
      </section>

      <section>
        <h2>Workflow</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <button
            disabled={!hasQuestionnaire || busy !== null}
            onClick={() => action('simulate-call', 'legal.call.simulate', { matterEntityId: id })}
          >
            {busy === 'simulate-call' && <span className="spinner" />}
            {busy === 'simulate-call' ? 'Running…' : 'Simulate consultation call'}
          </button>
          <button
            className="primary"
            disabled={!hasQuestionnaire || !hasTranscript || busy !== null}
            onClick={() =>
              action('generate-draft', 'legal.draft.generate', {
                matterEntityId: id,
                documentKind: 'operating_agreement',
              })
            }
          >
            {busy === 'generate-draft' && <span className="spinner" />}
            {busy === 'generate-draft' ? 'Queueing…' : 'Generate operating agreement (async)'}
          </button>
          <button
            disabled={!hasQuestionnaire || !hasTranscript || busy !== null}
            onClick={() =>
              action('generate-engagement', 'legal.draft.generate', {
                matterEntityId: id,
                documentKind: 'engagement_letter',
              })
            }
          >
            {busy === 'generate-engagement' && <span className="spinner" />}
            {busy === 'generate-engagement' ? 'Queueing…' : 'Generate engagement letter (async)'}
          </button>
        </div>
        {!hasQuestionnaire && (
          <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
            Questionnaire not yet submitted — drafting will unlock once the client completes intake.
          </p>
        )}
        {hasQuestionnaire && !hasTranscript && (
          <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
            Run the consultation simulation (or attach a real Granola transcript) before generating.
          </p>
        )}
      </section>

      {latestDraft && (
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
            }}
          >
            <h2 style={{ margin: 0 }}>Latest draft — {humanizeKind(latestDraft.documentKind)}</h2>
            <span className="text-sm text-muted">
              v{latestDraft.versionNumber} · {humanizeStatus(latestDraft.status)} ·{' '}
              {new Date(latestDraft.recordedAt).toLocaleDateString()}
            </span>
          </div>
          <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <button
              onClick={() =>
                downloadAsPdf(
                  latestDraft.bodyMarkdown,
                  `${humanizeKind(latestDraft.documentKind).replace(/\s+/g, '-').toLowerCase()}-${latestDraft.matterNumber}`,
                )
              }
            >
              Download PDF
            </button>
            <button
              onClick={() =>
                downloadAsWord(
                  latestDraft.bodyMarkdown,
                  `${humanizeKind(latestDraft.documentKind).replace(/\s+/g, '-').toLowerCase()}-${latestDraft.matterNumber}`,
                )
              }
            >
              Download Word
            </button>
            <button
              onClick={emailDraftLink}
              disabled={busy === 'email'}
              title={
                matter.clientEmail
                  ? `Will send to ${matter.clientEmail}`
                  : "No client email on file — you'll be prompted"
              }
            >
              {busy === 'email' && <span className="spinner" />}
              {busy === 'email' ? 'Sending…' : 'Email link to client'}
            </button>
            <Link
              href={`/attorney/review/${latestDraft.documentVersionId}`}
              style={{ marginLeft: 'auto' }}
            >
              <button className="primary">Open full review</button>
            </Link>
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
                      marginTop: 'var(--space-3)',
                    }
                  : { marginTop: 'var(--space-3)' }
              }
            >
              {emailStatus.msg}
            </div>
          )}
        </section>
      )}

      <section>
        <h2>Questionnaire</h2>
        {hasQuestionnaire && matter.questionnaireResponses ? (
          <QuestionnaireView data={matter.questionnaireResponses} />
        ) : (
          <p className="text-muted">Not submitted yet.</p>
        )}
      </section>

      <section>
        <h2>Transcript</h2>
        {hasTranscript && matter.transcriptText ? (
          <TranscriptView text={matter.transcriptText} />
        ) : (
          <p className="text-muted">
            No transcript yet. Run the consultation call (or stub it) first.
          </p>
        )}
      </section>

      <ResearchPanel matterEntityId={id} />

      <section>
        <h2>Action history</h2>
        <p className="text-muted text-sm">
          Every change to this matter is an audited action — actor, intent, autonomy tier, and
          reasoning-trace linkage.
        </p>
        {history && history.actions.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Intent</th>
                  <th>Autonomy</th>
                  <th>Trace</th>
                </tr>
              </thead>
              <tbody>
                {history.actions.map((a) => (
                  <tr key={a.actionId}>
                    <td>{new Date(a.recordedAt).toLocaleString()}</td>
                    <td>
                      <code>{a.kindName}</code>
                    </td>
                    <td>
                      {a.actorName}
                      {a.actorType === 'agent' && <span className="badge info"> AI</span>}
                      {a.actorType === 'system' && <span className="badge"> system</span>}
                    </td>
                    <td>{humanizeKind(a.intentKind)}</td>
                    <td>{humanizeKind(a.autonomyTier)}</td>
                    <td>{a.hasReasoningTrace ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">No actions recorded yet.</p>
        )}
        {history && history.events.length > 0 && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <h3>Lifecycle events</h3>
            <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {history.events.map((e) => (
                <span
                  key={e.eventId}
                  className="badge"
                  title={new Date(e.occurredAt).toLocaleString()}
                >
                  {e.kindName}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

interface ResearchEntry {
  eventId: string
  question: string
  answer: string
  citations: string[]
  model: string
  recordedAt: string
}

function ResearchPanel({ matterEntityId }: { matterEntityId: string }) {
  const [question, setQuestion] = useState('')
  const [entries, setEntries] = useState<ResearchEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ research: ResearchEntry[] }>({
        toolName: 'legal.research.list',
        input: { matterEntityId },
      })
      setEntries(r.research)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [matterEntityId])

  useEffect(() => {
    load()
  }, [load])

  async function ask() {
    if (!question.trim()) return
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp<{ research: ResearchEntry }>({
        toolName: 'legal.research.ask',
        input: { matterEntityId, question: question.trim() },
      })
      setQuestion('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Research</h2>
      <p className="text-muted text-sm">
        Ask Perplexity a research question for this matter. Answers and citations are recorded on
        the timeline with provenance. Uses the firm’s Settings-managed Perplexity key.
      </p>
      <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'flex-start' }}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="e.g. What are NC’s default quorum rules for a member-managed LLC?"
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask()
          }}
        />
        <button className="primary" onClick={ask} disabled={busy || !question.trim()}>
          {busy ? 'Researching…' : 'Ask'}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {entries === null ? (
        <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
          <span className="spinner" /> Loading research…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-muted" style={{ marginTop: 'var(--space-3)' }}>
          No research yet.
        </p>
      ) : (
        <div style={{ marginTop: 'var(--space-3)', display: 'grid', gap: 'var(--space-3)' }}>
          {entries.map((r) => (
            <ResearchCard key={r.eventId} entry={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function ResearchCard({ entry }: { entry: ResearchEntry }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: 'var(--space-3)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>{entry.question}</div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{entry.answer}</div>
      {entry.citations.length > 0 && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <div className="text-muted text-sm">Sources</div>
          <ol style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem' }}>
            {entry.citations.map((c, i) => (
              <li key={i}>
                <a href={c} target="_blank" rel="noreferrer">
                  {c}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="text-muted text-sm" style={{ marginTop: 'var(--space-2)' }}>
        {entry.model} · {new Date(entry.recordedAt).toLocaleString()}
      </div>
    </div>
  )
}

function QuestionnaireView({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  const tabular: Array<[string, Array<Record<string, unknown>>]> = []
  const simple: Array<[string, unknown]> = []
  for (const [k, v] of entries) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
      tabular.push([k, v as Array<Record<string, unknown>>])
    } else {
      simple.push([k, v])
    }
  }

  return (
    <>
      {simple.length > 0 && (
        <div className="kv-grid">
          {simple.map(([k, v]) => (
            <div key={k}>
              <div className="kv-label">{humanizeKey(k)}</div>
              <div className="kv-value">{humanizeValue(v)}</div>
            </div>
          ))}
        </div>
      )}
      {tabular.map(([k, rows]) => (
        <div key={k} style={{ marginTop: 'var(--space-5)' }}>
          <h3>{humanizeKey(k)}</h3>
          <RepeaterTable rows={rows} />
        </div>
      ))}
    </>
  )
}

function RepeaterTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return <p className="text-muted">None.</p>
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{humanizeKey(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{humanizeValue(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TranscriptView({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="transcript">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className="transcript-spacer" />
        if (/^\[.*\]$/.test(trimmed)) {
          return (
            <div key={i} className="transcript-meta">
              {trimmed}
            </div>
          )
        }
        if (/^Summary:/i.test(trimmed)) {
          return (
            <div key={i} className="transcript-summary">
              <strong>Summary</strong>
              <span>{trimmed.slice('Summary:'.length).trim()}</span>
            </div>
          )
        }
        const m = trimmed.match(/^([A-Za-z][A-Za-z ()'.-]{0,40}):\s*(.*)$/)
        if (m) {
          const speaker = m[1]!
          const dialogue = m[2]!
          const isAttorney = /attorney|juan/i.test(speaker)
          return (
            <div key={i} className={`transcript-line ${isAttorney ? 'attorney' : 'client'}`}>
              <div className="transcript-speaker">{speaker}</div>
              <div className="transcript-text">{dialogue}</div>
            </div>
          )
        }
        return (
          <div key={i} className="transcript-continuation">
            {trimmed}
          </div>
        )
      })}
    </div>
  )
}
