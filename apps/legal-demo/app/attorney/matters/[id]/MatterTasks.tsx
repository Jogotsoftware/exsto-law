'use client'

// Matter Tasks card (migration 0084). Ad-hoc to-dos on a matter, optionally costed
// (hours or a fixed fee). A done + costed task that isn't invoiced yet shows on the
// matter's Unbilled total; moving it back out of Done removes it again, and putting
// it on an invoice locks it. CRUD goes through legal.task.* (the action layer).
import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done'
type BillingMode = 'none' | 'hours' | 'fixed'

interface Task {
  taskId: string
  title: string
  status: TaskStatus
  dueDate: string | null
  assigneeActorId: string | null
  billingMode: BillingMode
  hours: string | null
  feeAmount: string | null
  invoiceId: string | null
}

const STATUS_ORDER: TaskStatus[] = ['open', 'in_progress', 'blocked', 'done']
const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
}
const STATUS_BADGE: Record<TaskStatus, string> = {
  open: 'info',
  in_progress: 'warn',
  blocked: 'danger',
  done: 'ok',
}

interface FormState {
  title: string
  status: TaskStatus
  billingMode: BillingMode
  hours: string
  feeAmount: string
  dueDate: string
  assignee: string
}
const EMPTY_FORM: FormState = {
  title: '',
  status: 'open',
  billingMode: 'none',
  hours: '',
  feeAmount: '',
  dueDate: '',
  assignee: '',
}
const formFromTask = (t: Task): FormState => ({
  title: t.title,
  status: t.status,
  billingMode: t.billingMode,
  hours: t.hours ?? '',
  feeAmount: t.feeAmount ?? '',
  dueDate: t.dueDate ?? '',
  assignee: t.assigneeActorId ?? '',
})

function costLabel(t: Task): string | null {
  if (t.billingMode === 'hours' && t.hours) return `${t.hours}h`
  if (t.billingMode === 'fixed' && t.feeAmount) return `$${t.feeAmount}`
  return null
}

export function MatterTasks({ matterEntityId }: { matterEntityId: string }) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ tasks: Task[] }>({
        toolName: 'legal.task.list',
        input: { matterEntityId },
      })
      setTasks(r.tasks)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [matterEntityId])
  useEffect(() => {
    load()
  }, [load])

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }))

  // The cost field travels with the mode: hours-only / fee-only / neither, so a
  // task never carries a stale cost from a prior mode.
  function buildInput(f: FormState) {
    return {
      title: f.title.trim(),
      status: f.status,
      dueDate: f.dueDate || null,
      assigneeActorId: f.assignee.trim() || null,
      billingMode: f.billingMode,
      hours: f.billingMode === 'hours' ? f.hours.trim() || null : null,
      feeAmount: f.billingMode === 'fixed' ? f.feeAmount.trim() || null : null,
    }
  }

  function startAdd() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setAdding(true)
  }
  function startEdit(t: Task) {
    setForm(formFromTask(t))
    setAdding(false)
    setEditId(t.taskId)
  }
  function cancel() {
    setAdding(false)
    setEditId(null)
    setForm(EMPTY_FORM)
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!form.title.trim()) {
      setError('A task needs a title.')
      return
    }
    if (form.billingMode === 'hours' && !form.hours.trim()) {
      setError('Enter the billable hours.')
      return
    }
    if (form.billingMode === 'fixed' && !form.feeAmount.trim()) {
      setError('Enter the fixed fee.')
      return
    }
    await run(async () => {
      if (editId) {
        await callAttorneyMcp({
          toolName: 'legal.task.update',
          input: { taskId: editId, ...buildInput(form) },
        })
      } else {
        await callAttorneyMcp({
          toolName: 'legal.task.create',
          input: { matterEntityId, ...buildInput(form) },
        })
      }
      cancel()
    })
  }

  const quickStatus = (t: Task, status: TaskStatus) =>
    run(() =>
      callAttorneyMcp({ toolName: 'legal.task.update', input: { taskId: t.taskId, status } }),
    )

  const archive = (t: Task) => {
    if (!window.confirm(`Archive task "${t.title}"?`)) return
    run(() => callAttorneyMcp({ toolName: 'legal.task.archive', input: { taskId: t.taskId } }))
  }

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <h2 style={{ margin: 0 }}>Tasks</h2>
        {!adding && !editId && (
          <button type="button" style={{ marginLeft: 'auto' }} onClick={startAdd}>
            + Add task
          </button>
        )}
      </div>
      <p className="text-muted text-sm" style={{ marginTop: 'var(--space-2)' }}>
        Costed tasks marked <strong>Done</strong> appear on this matter&apos;s Unbilled total until
        invoiced.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {(adding || editId) && (
        <div className="task-form">
          <label className="task-field" style={{ flex: '2 1 16rem' }}>
            <span>Title</span>
            <input
              value={form.title}
              onChange={(e) => patch({ title: e.target.value })}
              autoFocus
            />
          </label>
          <label className="task-field">
            <span>Status</span>
            <select
              value={form.status}
              onChange={(e) => patch({ status: e.target.value as TaskStatus })}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="task-field">
            <span>Due</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => patch({ dueDate: e.target.value })}
            />
          </label>
          <label className="task-field">
            <span>Assignee</span>
            <input
              value={form.assignee}
              onChange={(e) => patch({ assignee: e.target.value })}
              placeholder="Name"
            />
          </label>
          <label className="task-field">
            <span>Billing</span>
            <select
              value={form.billingMode}
              onChange={(e) => patch({ billingMode: e.target.value as BillingMode })}
            >
              <option value="none">No charge</option>
              <option value="hours">Hours</option>
              <option value="fixed">Fixed fee</option>
            </select>
          </label>
          {form.billingMode === 'hours' && (
            <label className="task-field" style={{ flex: '0 1 7rem' }}>
              <span>Hours</span>
              <input
                value={form.hours}
                onChange={(e) => patch({ hours: e.target.value })}
                placeholder="2.5"
              />
            </label>
          )}
          {form.billingMode === 'fixed' && (
            <label className="task-field" style={{ flex: '0 1 8rem' }}>
              <span>Fee ($)</span>
              <input
                value={form.feeAmount}
                onChange={(e) => patch({ feeAmount: e.target.value })}
                placeholder="350"
              />
            </label>
          )}
          <div className="task-form-actions">
            <button className="primary" disabled={busy} onClick={submit}>
              {editId ? 'Save' : 'Add task'}
            </button>
            <button type="button" disabled={busy} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {tasks === null ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : tasks.length === 0 ? (
        !adding && <p className="text-muted">No tasks yet.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((t) => {
            const cost = costLabel(t)
            const billed = Boolean(t.invoiceId)
            return (
              <li key={t.taskId} className="task-row">
                <select
                  className="task-status-select"
                  value={t.status}
                  disabled={busy || billed}
                  onChange={(e) => quickStatus(t, e.target.value as TaskStatus)}
                  aria-label="Status"
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <span className={`badge ${STATUS_BADGE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                <span className="task-title" style={{ flex: 1 }}>
                  {t.title}
                </span>
                {cost && <span className="badge info">{cost}</span>}
                {t.dueDate && <span className="text-muted text-sm">due {t.dueDate}</span>}
                {t.assigneeActorId && (
                  <span className="text-muted text-sm">· {t.assigneeActorId}</span>
                )}
                {billed ? (
                  <span className="badge ok" title="On an invoice — locked">
                    Billed
                  </span>
                ) : (
                  <button type="button" disabled={busy} onClick={() => startEdit(t)}>
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="task-archive"
                  disabled={busy}
                  onClick={() => archive(t)}
                  aria-label="Archive task"
                  title="Archive"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
