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
import { BackButton } from '@/components/BackButton'
import { EsignComposer } from '@/components/esign/EsignComposer'
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
    <div className="li-mat-taskstep-row">
      {STEPS.map((label, i) => (
        <span
          key={label}
          className={
            i < current
              ? 'li-mat-taskstep is-done'
              : i === current
                ? 'li-mat-taskstep is-current'
                : 'li-mat-taskstep is-pending'
          }
        >
          {i + 1}. {label}
        </span>
      ))}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
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
    async (envelopeId: string) => {
      try {
        await callAttorneyMcp({
          toolName: 'legal.task.link_envelope',
          input: { taskId, envelopeId },
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

  // HYBRID status model (WP-B): the tasks LIST is a fast done/undone checkbox;
  // the full 4-state status lives here, on the detail page.
  async function setStatus(status: string) {
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({ toolName: 'legal.task.update', input: { taskId, status } })
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
        {error} <BackButton fallback={`/attorney/matters/${id}/tasks`} className="li-mat-back" />
      </div>
    )
  if (!task)
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )

  const backButton = (
    <BackButton
      fallback={`/attorney/matters/${id}/tasks`}
      className="li-mat-back"
      style={{ gap: 6, paddingLeft: 10, marginBottom: 16 }}
    />
  )

  // ── Plain task ──────────────────────────────────────────────────────────────
  if (task.kind !== 'signature' || !task.documentVersionId) {
    return (
      <section className="li-mat-card">
        {backButton}
        <h2 className="li-mat-card-title">{task.title}</h2>
        {task.dueDate && (
          <p className="text-muted text-sm" style={{ marginTop: 0 }}>
            Due {formatDate(task.dueDate)}
          </p>
        )}
        <label className="li-mat-field" style={{ maxWidth: 220 }}>
          <span>Status</span>
          <select value={task.status} disabled={busy} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <p className="text-sm text-muted" style={{ marginTop: 'var(--space-3)' }}>
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
    <section className="li-mat-card">
      {backButton}
      <h2 className="li-mat-card-title">{task.title}</h2>
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
          {/* ESIGN-UNIFY-1 (ES-5b, §11) — the deleted PrepareSignature is
              retargeted to the ONE unified composer in document mode; onSent
              still links the envelope to this task so tracking/review advance. */}
          <EsignComposer
            source={{
              kind: 'document',
              documentVersionId: task.documentVersionId,
              matterEntityId: id,
              title: task.title,
            }}
            onSent={onSent}
          />
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
