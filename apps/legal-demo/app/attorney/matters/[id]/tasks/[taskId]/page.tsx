'use client'

// The task window. A plain task shows a small detail card. A SIGNATURE task (one
// with a document attached, migration 0113) opens the DocuSign-style experience and
// walks three steps — Prepare & send → Track signatures/countersignatures → Review
// the executed copy — and cannot complete until every party has signed AND the
// attorney has reviewed it (the review gate, enforced server-side in reviewTask).
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { formatDate } from '@/lib/datetime'
import { PrepareSignature, type SendResult } from '@/components/PrepareSignature'
import { EnvelopeStatusView, type EnvelopeStatus } from '@/components/EnvelopeStatusView'

interface Task {
  taskId: string
  matterId: string | null
  title: string
  status: string
  dueDate: string | null
  kind: string
  documentVersionId: string | null
  esignEnvelopeId: string | null
  reviewedAt: string | null
}

const STEPS = ['Prepare & send', 'Signatures', 'Review & complete']

function Stepper({ current }: { current: number }) {
  return (
    <div
      className="row"
      style={{ gap: 'var(--space-2)', flexWrap: 'wrap', margin: 'var(--space-3) 0' }}
    >
      {STEPS.map((label, i) => (
        <span
          key={label}
          className={`badge ${i < current ? 'ok' : i === current ? 'warn' : 'muted'}`}
        >
          {i + 1}. {label}
        </span>
      ))}
    </div>
  )
}

export default function TaskWindowPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string }>
}) {
  const { id, taskId } = use(params)
  const [task, setTask] = useState<Task | null>(null)
  const [env, setEnv] = useState<EnvelopeStatus | null>(null)
  const [executedMarkdown, setExecutedMarkdown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resend, setResend] = useState(false)

  const loadTask = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ task: Task | null }>({
        toolName: 'legal.task.get',
        input: { taskId },
      })
      if (!r.task) setError('Task not found.')
      setTask(r.task)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [taskId])

  useEffect(() => {
    loadTask()
  }, [loadTask])

  // After sending, record the envelope on the task and advance to tracking.
  const onSent = useCallback(
    async (result: SendResult) => {
      try {
        await callAttorneyMcp({
          toolName: 'legal.task.link_envelope',
          input: { taskId, envelopeId: result.envelopeId },
        })
        setResend(false)
        await loadTask()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [taskId, loadTask],
  )

  // When the envelope reads `completed`, pull the executed copy for review.
  const onEnvLoaded = useCallback((e: EnvelopeStatus) => {
    setEnv(e)
    if (e.status === 'completed' && e.executedDocumentVersionId) {
      callAttorneyMcp<{ draft: { bodyMarkdown: string } | null }>({
        toolName: 'legal.draft.get',
        input: { documentVersionId: e.executedDocumentVersionId },
      })
        .then((r) => setExecutedMarkdown(r.draft?.bodyMarkdown ?? null))
        .catch(() => setExecutedMarkdown(null))
    }
  }, [])

  async function review() {
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({ toolName: 'legal.task.review', input: { taskId } })
      await loadTask()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (error && !task)
    return (
      <div className="alert alert-error">
        {error} <Link href={`/attorney/matters/${id}/tasks`}>Back to tasks</Link>
      </div>
    )
  if (!task)
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )

  const backLink = (
    <Link href={`/attorney/matters/${id}/tasks`} className="text-sm">
      ← Back to tasks
    </Link>
  )

  // ── Plain task ──────────────────────────────────────────────────────────────
  if (task.kind !== 'signature' || !task.documentVersionId) {
    return (
      <section>
        {backLink}
        <h2 style={{ marginTop: 'var(--space-2)' }}>{task.title}</h2>
        <p className="text-muted">
          {task.dueDate ? `Due ${formatDate(task.dueDate)} · ` : ''}Status: {task.status}
        </p>
        <p className="text-sm text-muted">
          This is a plain task. Attach a document from the Tasks list to send it for signature.
        </p>
      </section>
    )
  }

  // ── Signature task ──────────────────────────────────────────────────────────
  const completed = task.status === 'done' || task.reviewedAt !== null
  const declined = env?.status === 'declined'
  const envCompleted = env?.status === 'completed'
  // Step index: 0 prepare, 1 signatures, 2 review.
  const current = completed ? 2 : !task.esignEnvelopeId || resend ? 0 : envCompleted ? 2 : 1
  const showPrepare = !completed && (!task.esignEnvelopeId || resend)

  return (
    <section>
      {backLink}
      <h2 style={{ marginTop: 'var(--space-2)' }}>{task.title}</h2>
      <Stepper current={current} />
      {error && <div className="alert alert-error">{error}</div>}

      {/* Step 1 — prepare & send (also the re-send path after a decline) */}
      {showPrepare && (
        <>
          {resend && (
            <div className="alert" style={{ marginBottom: 'var(--space-3)' }}>
              Preparing a new envelope. The previous one was declined.
            </div>
          )}
          <PrepareSignature documentVersionId={task.documentVersionId} onSent={onSent} />
        </>
      )}

      {/* Steps 2 & 3 — tracking + review (envelope exists, not re-sending) */}
      {!showPrepare && task.esignEnvelopeId && (
        <>
          <EnvelopeStatusView envelopeId={task.esignEnvelopeId} onLoaded={onEnvLoaded} />

          {declined && !completed && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <div className="alert alert-error">
                A signer declined. You can prepare and re-send the document.
              </div>
              <button className="primary" onClick={() => setResend(true)}>
                Prepare &amp; re-send
              </button>
            </div>
          )}

          {envCompleted && !completed && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <h3>Review the executed copy</h3>
              <p className="text-sm text-muted">
                Every party has signed. Review the executed document, then complete the task.
              </p>
              {executedMarkdown ? (
                <div
                  className="doc-rendered"
                  style={{
                    maxHeight: 420,
                    overflow: 'auto',
                    border: '1px solid var(--border, #ddd)',
                    padding: 'var(--space-3)',
                  }}
                  dangerouslySetInnerHTML={{ __html: renderDocumentHtml(executedMarkdown) }}
                />
              ) : (
                <div className="loading-block" role="status">
                  <span className="spinner" /> Loading executed copy…
                </div>
              )}
              <div style={{ marginTop: 'var(--space-3)' }}>
                <button className="primary" onClick={review} disabled={busy}>
                  {busy && <span className="spinner" />}
                  Mark reviewed &amp; complete task
                </button>
              </div>
            </div>
          )}

          {completed && (
            <div className="alert alert-success" style={{ marginTop: 'var(--space-3)' }}>
              Completed — all parties signed and the executed copy was reviewed
              {task.reviewedAt ? ` on ${new Date(task.reviewedAt).toLocaleString()}` : ''}.
              {env?.executedDocumentVersionId && (
                <>
                  {' '}
                  <Link href={`/d/${env.executedDocumentVersionId}`}>View executed document →</Link>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
