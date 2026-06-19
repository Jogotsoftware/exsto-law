'use client'

// Matter › OVERVIEW tab. The case at a glance + the work: client/practice/opened,
// the workflow actions (record call, generate documents), and the captured intake
// (questionnaire + transcript). Status, title, Email/Schedule and Back live in the
// layout header. Activity, Documents and Billing are their own tabs.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { humanizeService, QuestionnaireView, TranscriptView, type MatterDetail } from './shared'

export default function MatterOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [matter, setMatter] = useState<MatterDetail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [callTranscript, setCallTranscript] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await callAttorneyMcp<{ matter: MatterDetail | null }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId: id },
      })
      setMatter(res.matter)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

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

  if (!matter && !error) {
    return (
      <div className="loading-block">
        <span className="spinner" /> Loading matter…
      </div>
    )
  }
  if (!matter) {
    return <div className="alert alert-error">{error}</div>
  }

  const hasQuestionnaire = matter.questionnaireResponses !== null
  const hasTranscript = matter.transcriptText !== null

  return (
    <>
      <section>
        <h2>Overview</h2>
        <div className="kv-grid">
          <div>
            <div className="kv-label">Client</div>
            <div className="kv-value">
              {matter.clientEntityId ? (
                <Link href={`/attorney/crm/${matter.clientEntityId}`}>
                  {matter.clientName || 'View client'}
                </Link>
              ) : (
                matter.clientName || '—'
              )}
            </div>
          </div>
          <div>
            <div className="kv-label">Practice area</div>
            <div className="kv-value">{humanizeService(matter.practiceArea)}</div>
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              flex: '1 1 100%',
            }}
          >
            <textarea
              value={callTranscript}
              onChange={(e) => setCallTranscript(e.target.value)}
              placeholder="Paste the consultation transcript to record the call…"
              rows={4}
              disabled={!hasQuestionnaire || busy !== null}
            />
            <button
              disabled={!hasQuestionnaire || !callTranscript.trim() || busy !== null}
              onClick={async () => {
                await action('record-call', 'legal.call.record_manual', {
                  matterEntityId: id,
                  transcriptText: callTranscript,
                })
                setCallTranscript('')
              }}
            >
              {busy === 'record-call' && <span className="spinner" />}
              {busy === 'record-call' ? 'Recording…' : 'Record consultation call'}
            </button>
          </div>
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
        <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
          Generated documents appear under the <strong>Documents</strong> tab.
        </p>
      </section>

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
    </>
  )
}
