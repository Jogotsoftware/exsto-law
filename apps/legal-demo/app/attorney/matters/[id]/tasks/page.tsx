'use client'

// Matter › TASKS tab. Ad-hoc to-dos on the matter (migration 0084) AND signature
// tasks (migration 0113): a task can carry a document, and opening it walks the
// DocuSign-style flow (prepare → track → review) in the task window. This page is
// the list + quick-create (comp TASK MODAL); the per-task window lives at ./[taskId].
//
// HYBRID status model (founder decision, WP-B): the list's CHECKBOX toggles
// done/undone for plain tasks (comp). The full 4-state status (open/in_progress/
// blocked/done) stays editable on the task DETAIL page — this list is a fast
// done-toggle, not the only way to set status.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { DateField } from '@/components/DateField'
import { formatDate } from '@/lib/datetime'
import { BriefcaseIcon, CheckIcon, SignatureIcon, UsersIcon, XIcon } from '@/components/icons'
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

// What a signature task is waiting on, derived from its stored fields (the live
// envelope state shows inside the task window).
function signatureState(t: Task): string {
  if (t.status === 'done' || t.reviewedAt) return 'Completed'
  if (t.esignEnvelopeId) return 'Out for signature'
  return 'Not sent'
}
function billingChip(t: Task): string | null {
  if (t.billingMode === 'hours' && t.hours) return `${t.hours}h`
  if (t.billingMode === 'fixed' && t.feeAmount) return `$${t.feeAmount}`
  return null
}
function isOverdue(t: Task): boolean {
  if (!t.dueDate || t.status === 'done') return false
  return new Date(t.dueDate + 'T23:59:59').getTime() < Date.now()
}

export default function MatterTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [tasks, setTasks] = useState<Task[]>([])
  const [docs, setDocs] = useState<DraftDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

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

  // The header Actions menu's "New task" lands here with ?new=1.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('new') === '1') setShowModal(true)
  }, [])

  async function toggleDone(t: Task) {
    setBusy(t.taskId)
    try {
      await callAttorneyMcp({
        toolName: 'legal.task.update',
        input: { taskId: t.taskId, status: t.status === 'done' ? 'open' : 'done' },
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (loading)
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )

  return (
    <>
      <div className="li-mat-card li-mat-doccard">
        <div className="li-mat-doccard-head">
          <h2 className="li-mat-card-title">Tasks</h2>
          <button type="button" className="li-mat-upload-btn" onClick={() => setShowModal(true)}>
            New task
          </button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {tasks.length === 0 ? (
          <p className="text-muted" style={{ padding: '8px 4px 16px' }}>
            No tasks yet.
          </p>
        ) : (
          <div className="li-mat-tasklist">
            {tasks.map((t) => {
              const isSig = t.kind === 'signature'
              const done = t.status === 'done'
              const bill = billingChip(t)
              return (
                <div key={t.taskId} className="li-mat-task-row">
                  <span
                    className={
                      done
                        ? 'li-mat-task-check is-done'
                        : isSig
                          ? 'li-mat-task-check is-disabled'
                          : 'li-mat-task-check'
                    }
                    role={isSig ? undefined : 'checkbox'}
                    aria-checked={done}
                    aria-disabled={isSig || busy === t.taskId}
                    title={isSig ? 'Signature tasks complete via the review step' : 'Toggle done'}
                    onClick={(e) => {
                      e.preventDefault()
                      if (isSig || busy === t.taskId) return
                      void toggleDone(t)
                    }}
                  >
                    {done && <CheckIcon size={13} />}
                  </span>
                  <Link
                    href={`/attorney/matters/${id}/tasks/${t.taskId}`}
                    className="li-mat-task-main"
                  >
                    <span
                      className={isSig ? 'li-mat-task-role is-shared' : 'li-mat-task-role'}
                      title={isSig ? 'Requires signature' : 'Attorney task'}
                    >
                      {isSig ? <UsersIcon size={14} /> : <BriefcaseIcon size={14} />}
                    </span>
                    <span className={done ? 'li-mat-task-title is-done' : 'li-mat-task-title'}>
                      {t.title}
                    </span>
                    <span className="li-mat-task-chips">
                      {t.dueDate && (
                        <span
                          className={
                            isOverdue(t) ? 'li-mat-chip li-mat-chip-danger' : 'li-mat-chip'
                          }
                        >
                          {formatDate(t.dueDate)}
                        </span>
                      )}
                      {bill && <span className="li-mat-chip li-mat-chip-info">{bill}</span>}
                      {isSig && (
                        <span className="li-mat-chip li-mat-chip-purple">
                          <SignatureIcon size={12} />
                          {signatureState(t)}
                        </span>
                      )}
                    </span>
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showModal && (
        <NewTaskModal
          matterEntityId={id}
          docs={docs}
          onClose={() => setShowModal(false)}
          onCreated={async () => {
            setShowModal(false)
            await load()
          }}
        />
      )}
    </>
  )
}

function NewTaskModal({
  matterEntityId,
  docs,
  onClose,
  onCreated,
}: {
  matterEntityId: string
  docs: DraftDoc[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [billingMode, setBillingMode] = useState('none')
  const [cost, setCost] = useState('')
  const [attachSig, setAttachSig] = useState(false)
  const [signDoc, setSignDoc] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!title.trim()) {
      setError('A task needs a title.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.task.create',
        input: {
          matterEntityId,
          title: title.trim(),
          dueDate: dueDate || undefined,
          billingMode,
          hours: billingMode === 'hours' ? cost || undefined : undefined,
          feeAmount: billingMode === 'fixed' ? cost || undefined : undefined,
          documentVersionId: attachSig ? signDoc || undefined : undefined,
        },
      })
      await onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="li-mat-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="li-mat-task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="li-mat-upload-head">
          <h2>New task</h2>
          <button
            type="button"
            className="li-mat-modal-x"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <XIcon size={16} />
          </button>
        </div>
        <div className="li-mat-task-modal-body">
          <label className="li-mat-field">
            <span>What needs doing</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Draft the notice of representation"
              autoFocus
            />
          </label>
          <label className="li-mat-field">
            <span>Due date</span>
            <DateField value={dueDate} onValueChange={setDueDate} />
          </label>
          <div className="li-mat-field">
            <span>Billing</span>
            <div className="li-mat-segrow">
              {(['none', 'hours', 'fixed'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={billingMode === m ? 'li-mat-seg is-active' : 'li-mat-seg'}
                  onClick={() => setBillingMode(m)}
                >
                  {m === 'none' ? 'No charge' : m === 'hours' ? 'Hours' : 'Fixed fee'}
                </button>
              ))}
            </div>
            {billingMode !== 'none' && (
              <input
                className="li-mat-cost-input"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder={billingMode === 'hours' ? 'Hours' : 'Amount'}
              />
            )}
          </div>
          <label className="li-mat-checkrow">
            <span
              className={attachSig ? 'li-mat-task-check is-done' : 'li-mat-task-check'}
              onClick={() => setAttachSig((v) => !v)}
            >
              {attachSig && <CheckIcon size={13} />}
            </span>
            Attach a document for signature
          </label>
          {attachSig && (
            <label className="li-mat-field">
              <span>Document</span>
              <select value={signDoc} onChange={(e) => setSignDoc(e.target.value)}>
                <option value="">— None (plain task) —</option>
                {docs.map((d) => (
                  <option key={d.documentVersionId} value={d.documentVersionId}>
                    {humanizeKind(d.documentKind)} (v{d.versionNumber})
                  </option>
                ))}
              </select>
              {docs.length === 0 && (
                <span className="text-sm text-muted">
                  No generated documents on this matter yet.
                </span>
              )}
            </label>
          )}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
        <div className="li-mat-upload-actions">
          <button type="button" className="li-mat-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="li-mat-btn-primary"
            onClick={() => void create()}
            disabled={busy || !title.trim()}
          >
            {busy ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  )
}
