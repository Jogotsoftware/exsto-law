'use client'

// Matter › TASKS tab. Ad-hoc to-dos on the matter (migration 0084) AND signature
// tasks (migration 0113): a task can carry a document, and opening it walks the
// DocuSign-style flow (prepare → track → review) in the task window. This page is
// the list + quick-create; the per-task window lives at ./[taskId].
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { formatDate } from '@/lib/datetime'
import { humanizeKind } from '../shared'

interface Task {
  taskId: string
  title: string
  status: string
  dueDate: string | null
  billingMode: string
  hours: string | null
  feeAmount: string | null
  kind: string
  documentVersionId: string | null
  esignEnvelopeId: string | null
  reviewedAt: string | null
  createdAt: string
}
interface DraftDoc {
  documentVersionId: string
  documentKind: string
  versionNumber: number
  status: string
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
}
function statusBadge(s: string): string {
  if (s === 'done') return 'badge ok'
  if (s === 'blocked') return 'badge danger'
  if (s === 'in_progress') return 'badge warn'
  return 'badge muted'
}
// What a signature task is waiting on, derived from its stored fields (the live
// envelope state shows inside the task window).
function signatureState(t: Task): string {
  if (t.status === 'done' || t.reviewedAt) return 'Completed'
  if (t.esignEnvelopeId) return 'Out for signature'
  return 'Not sent'
}

export default function MatterTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [tasks, setTasks] = useState<Task[]>([])
  const [docs, setDocs] = useState<DraftDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // New-task form.
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [billingMode, setBillingMode] = useState('none')
  const [cost, setCost] = useState('')
  const [signDoc, setSignDoc] = useState('') // documentVersionId, '' = plain task

  const load = useCallback(async () => {
    setError(null)
    try {
      const [taskRes, docRes] = await Promise.all([
        callAttorneyMcp<{ tasks: Task[] }>({
          toolName: 'legal.task.list',
          input: { matterEntityId: id },
        }),
        callAttorneyMcp<{ drafts: DraftDoc[] }>({
          toolName: 'legal.draft.list_for_matter',
          input: { matterEntityId: id },
        }).catch(() => ({ drafts: [] as DraftDoc[] })),
      ])
      setTasks(taskRes.tasks)
      setDocs(docRes.drafts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function createTask() {
    if (!title.trim()) {
      setError('A task needs a title.')
      return
    }
    setBusy('create')
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.task.create',
        input: {
          matterEntityId: id,
          title: title.trim(),
          dueDate: dueDate || undefined,
          billingMode,
          hours: billingMode === 'hours' ? cost || undefined : undefined,
          feeAmount: billingMode === 'fixed' ? cost || undefined : undefined,
          documentVersionId: signDoc || undefined,
        },
      })
      setTitle('')
      setDueDate('')
      setBillingMode('none')
      setCost('')
      setSignDoc('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function setStatus(taskId: string, status: string) {
    setBusy(taskId)
    try {
      await callAttorneyMcp({ toolName: 'legal.task.update', input: { taskId, status } })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (loading)
    return (
      <div className="loading-block">
        <span className="spinner" /> Loading…
      </div>
    )

  return (
    <>
      <section>
        <h2>Tasks</h2>
        {error && <div className="alert alert-error">{error}</div>}
        {tasks.length === 0 ? (
          <p className="text-muted">No tasks yet. Add one below.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 'var(--space-2)' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const isSig = t.kind === 'signature'
                  return (
                    <tr key={t.taskId}>
                      <td>
                        <Link href={`/attorney/matters/${id}/tasks/${t.taskId}`}>{t.title}</Link>
                        {isSig && (
                          <span className="badge" style={{ marginLeft: 'var(--space-2)' }}>
                            ✍ Signature
                          </span>
                        )}
                      </td>
                      <td className="text-sm text-muted">
                        {t.dueDate ? formatDate(t.dueDate) : '—'}
                      </td>
                      <td>
                        {isSig ? (
                          <span className={statusBadge(t.status)}>{signatureState(t)}</span>
                        ) : (
                          <select
                            value={t.status}
                            disabled={busy === t.taskId}
                            onChange={(e) => setStatus(t.taskId, e.target.value)}
                          >
                            {Object.entries(STATUS_LABEL).map(([v, label]) => (
                              <option key={v} value={v}>
                                {label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        <Link href={`/attorney/matters/${id}/tasks/${t.taskId}`}>
                          {isSig ? 'Open →' : 'View →'}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ marginTop: 'var(--space-5)' }}>
        <h3>New task</h3>
        <div
          className="row"
          style={{ gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}
        >
          <input
            style={{ minWidth: 240, flex: 1 }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            title="Due date (optional)"
          />
          <select
            value={billingMode}
            onChange={(e) => setBillingMode(e.target.value)}
            title="Billing"
          >
            <option value="none">No charge</option>
            <option value="hours">Hours</option>
            <option value="fixed">Fixed fee</option>
          </select>
          {billingMode !== 'none' && (
            <input
              style={{ width: 90 }}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder={billingMode === 'hours' ? 'Hours' : 'Amount'}
            />
          )}
        </div>
        <div
          className="row"
          style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)', alignItems: 'center' }}
        >
          <label className="text-sm">Attach document for signature:</label>
          <select value={signDoc} onChange={(e) => setSignDoc(e.target.value)}>
            <option value="">— None (plain task) —</option>
            {docs.map((d) => (
              <option key={d.documentVersionId} value={d.documentVersionId}>
                {humanizeKind(d.documentKind)} (v{d.versionNumber})
              </option>
            ))}
          </select>
          {docs.length === 0 && (
            <span className="text-sm text-muted">No generated documents on this matter yet.</span>
          )}
        </div>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <button className="primary" onClick={createTask} disabled={busy === 'create'}>
            {busy === 'create' && <span className="spinner" />}
            {signDoc ? 'Create signature task' : 'Add task'}
          </button>
        </div>
      </section>
    </>
  )
}
