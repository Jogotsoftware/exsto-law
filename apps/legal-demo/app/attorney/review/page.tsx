'use client'

// TASK-QUEUE-1 — the attorney Task Queue: one sortable/filterable table
// aggregating every task on the attorney across four sources (document review,
// e-sign, billing, client requests) — legal.attorney.task_queue
// (verticals/legal/src/queries/attorneyTasks.ts). Route stays /attorney/review
// (deep links from the old Review Queue rely on it); the nav label moved to
// "Tasks" in AttorneyRail.tsx.
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  FileSearch,
  PenLine,
  Eye,
  Receipt,
  HelpCircle,
  Mail,
  Workflow,
  ListTodo,
  ArrowRight,
} from 'lucide-react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { formatDateTime } from '@/lib/datetime'
import { BriefButton } from '@/components/BriefButton'
import { EmailComposeModal } from '@/components/EmailComposeModal'
import {
  hrefFor,
  writeTaskSession,
  type TaskSessionItem,
  type WalkableTaskType,
} from '@/lib/taskSession'

type AttorneyTaskType =
  | 'document_review'
  | 'esign'
  | 'billing'
  | 'client_request'
  | 'workflow_step'
  | 'todo'

// The task types a queue-started session can walk one after another — see
// lib/taskSession.ts. Any other type only ever opens via its own row action.
// Typed against the wider AttorneyTaskType (not WalkableTaskType) so `.includes`
// accepts every row's type; callers narrow with an explicit cast when building
// session items.
const WALKABLE_TYPES: readonly AttorneyTaskType[] = ['document_review', 'esign']

// Mirrors verticals/legal/src/queries/attorneyTasks.ts's AttorneyTask — a
// client component can't import the server-side vertical package directly, so
// the shape rides over MCP (legal.attorney.task_queue) like every other
// client-facing read.
interface AttorneyTask {
  id: string
  type: AttorneyTaskType
  typeLabel: string
  subtype?: string
  title: string
  clientName: string | null
  matterNumber: string | null
  matterEntityId: string | null
  contactEntityId: string | null
  date: string | null
  dateLabel: string
  status: string | null
  workHref: string
  viewHref?: string | null
}

type SortKey = 'date' | 'type' | 'client' | 'matter'
type TypeFilter = 'all' | AttorneyTaskType

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All Tasks' },
  { value: 'document_review', label: 'Document Review' },
  { value: 'esign', label: 'E-Sign' },
  { value: 'billing', label: 'Billing' },
  { value: 'client_request', label: 'Client Request' },
  { value: 'workflow_step', label: 'Workflow Step' },
  { value: 'todo', label: 'To-Do' },
]

// Types that render their own primary row action below; any type NOT here falls
// back to a generic "Open" so a new/unknown server type never renders actionless.
const PRIMARY_ACTION_TYPES: AttorneyTaskType[] = [
  'document_review',
  'esign',
  'billing',
  'client_request',
  'workflow_step',
  'todo',
]

// Comp caret indicators: ⇅ idle, ▴ asc, ▾ desc — colored gold when active.
function SortCaret({
  columnKey,
  activeKey,
  asc,
}: {
  columnKey: SortKey
  activeKey: SortKey
  asc: boolean
}) {
  const active = activeKey === columnKey
  return (
    <span className={`li-rev-caret${active ? ' is-active' : ''}`} aria-hidden>
      {active ? (asc ? '▴' : '▾') : '⇅'}
    </span>
  )
}

export default function TaskQueue() {
  const router = useRouter()
  const [tasks, setTasks] = useState<AttorneyTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The row whose "Email" modal is open — one at a time.
  const [emailFor, setEmailFor] = useState<AttorneyTask | null>(null)

  // Batch-session selection covers the walkable types (document_review +
  // esign — see WALKABLE_TYPES); tracked by task id.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortAsc, setSortAsc] = useState(false)

  async function load() {
    try {
      const res = await callAttorneyMcp<{ tasks: AttorneyTask[] }>({
        toolName: 'legal.attorney.task_queue',
      })
      setTasks(res.tasks)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    load()
  }, [])

  const counts = useMemo(() => {
    const c: Record<AttorneyTaskType, number> = {
      document_review: 0,
      esign: 0,
      billing: 0,
      client_request: 0,
      workflow_step: 0,
      todo: 0,
    }
    for (const t of tasks ?? []) c[t.type]++
    return c
  }, [tasks])

  const visible = useMemo(() => {
    let list = tasks ?? []
    if (typeFilter !== 'all') list = list.filter((t) => t.type === typeFilter)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (t) =>
          (t.clientName ?? '').toLowerCase().includes(q) ||
          (t.matterNumber ?? '').toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          t.typeLabel.toLowerCase().includes(q),
      )
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date') cmp = (a.date ?? '').localeCompare(b.date ?? '')
      else if (sortKey === 'type') cmp = a.typeLabel.localeCompare(b.typeLabel)
      else if (sortKey === 'client') cmp = (a.clientName ?? '').localeCompare(b.clientName ?? '')
      else cmp = (a.matterNumber ?? '').localeCompare(b.matterNumber ?? '')
      return sortAsc ? cmp : -cmp
    })
    return sorted
  }, [tasks, typeFilter, query, sortKey, sortAsc])

  // Selection (and "select all") is scoped to the walkable rows currently
  // visible (document_review + esign) — the checkbox only ever appears on
  // those types, and a session must never open a hidden row.
  const visibleWalkableIds = useMemo(
    () => new Set(visible.filter((t) => WALKABLE_TYPES.includes(t.type)).map((t) => t.id)),
    [visible],
  )
  const selectedVisible = useMemo(
    () => [...selected].filter((id) => visibleWalkableIds.has(id)),
    [selected, visibleWalkableIds],
  )
  const allVisibleSelected =
    visibleWalkableIds.size > 0 && selectedVisible.length === visibleWalkableIds.size

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visibleWalkableIds.forEach((id) => next.delete(id))
      else visibleWalkableIds.forEach((id) => next.add(id))
      return next
    })
  }

  // Click a header to sort; clicking the active column flips direction. Date
  // defaults newest-first; text columns A→Z.
  function sortBy(key: SortKey) {
    if (key === sortKey) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(key !== 'date')
    }
  }

  // Start Tasks: walk the selected document_review + esign rows in order —
  // each surface auto-advances to the next task in the session after its own
  // disposition (approve/reject, or sign/decline).
  function startTasks() {
    const items: TaskSessionItem[] = visible
      .filter((t) => WALKABLE_TYPES.includes(t.type) && selected.has(t.id))
      .map((t) => ({ id: t.id, type: t.type as WalkableTaskType }))
    if (items.length === 0) return
    writeTaskSession({ items, index: 0 })
    router.push(hrefFor(items[0]!))
  }

  return (
    <main className="li-rev">
      <h1 className="li-rev-title">Task Queue</h1>
      <p className="li-rev-sub">
        Everything waiting on you — drafts to review, documents to sign, invoices, and client
        requests.
      </p>

      {error && <div className="alert alert-error li-rev-alert">{error}</div>}

      {tasks === null && !error && (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      )}

      {tasks && tasks.length === 0 && (
        <div className="li-rev-table">
          <div className="li-rev-empty">
            You&rsquo;re all caught up — nothing needs you right now.
          </div>
        </div>
      )}

      {tasks && tasks.length > 0 && (
        <>
          <div className="li-rev-filters">
            <div className="li-rev-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <line
                  x1="21"
                  y1="21"
                  x2="16.5"
                  y2="16.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="text"
                placeholder="Search client, matter, or task…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search the task queue"
              />
            </div>
            <select
              className="li-rev-kind"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              aria-label="Filter by task type"
            >
              {TYPE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({f.value === 'all' ? tasks.length : counts[f.value]})
                </option>
              ))}
            </select>
            <span className="li-rev-count">
              {visible.length} of {tasks.length} shown
            </span>
          </div>

          {/* Selection bar — Start Tasks walks the selected walkable rows. */}
          {selectedVisible.length > 0 && (
            <div className="li-rev-selbar">
              <span className="li-rev-selcount">{selectedVisible.length} selected</span>
              <button type="button" className="li-rev-clear" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <button type="button" className="li-rev-begin" onClick={startTasks}>
                Start Tasks
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <line
                    x1="5"
                    y1="12"
                    x2="19"
                    y2="12"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <polyline
                    points="12 5 19 12 12 19"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </button>
            </div>
          )}

          <div className="li-rev-table">
            <div className="li-rev-thead">
              <label className="li-rev-check">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  aria-label="Select all reviewable and signable tasks"
                />
              </label>
              <button type="button" className="li-rev-th" onClick={() => sortBy('type')}>
                TYPE <SortCaret columnKey="type" activeKey={sortKey} asc={sortAsc} />
              </button>
              <button type="button" className="li-rev-th" onClick={() => sortBy('client')}>
                CLIENT <SortCaret columnKey="client" activeKey={sortKey} asc={sortAsc} />
              </button>
              <button type="button" className="li-rev-th" onClick={() => sortBy('matter')}>
                MATTER <SortCaret columnKey="matter" activeKey={sortKey} asc={sortAsc} />
              </button>
              <span className="li-rev-th li-rev-th--static">TASK</span>
              <button type="button" className="li-rev-th" onClick={() => sortBy('date')}>
                DATE <SortCaret columnKey="date" activeKey={sortKey} asc={sortAsc} />
              </button>
              <span className="li-rev-th li-rev-th--static li-rev-th--result">ACTIONS</span>
            </div>

            {visible.map((t) => (
              <div key={`${t.type}:${t.id}`} className="li-rev-row">
                {WALKABLE_TYPES.includes(t.type) ? (
                  <label className="li-rev-check">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggle(t.id)}
                      aria-label={`Select ${t.title}`}
                    />
                  </label>
                ) : (
                  <span className="li-rev-check" aria-hidden />
                )}
                <span className="li-rev-type">
                  <span className={`li-rev-badge li-rev-badge--${t.type}`}>{t.typeLabel}</span>
                </span>
                <span className="li-rev-client">{t.clientName || '—'}</span>
                <span className="li-rev-matter">{t.matterNumber || '—'}</span>
                <span className="li-rev-task">{t.title}</span>
                <span className="li-rev-when">
                  {t.dateLabel} {formatDateTime(t.date)}
                </span>
                <span className="li-rev-await-actions">
                  {t.type === 'esign' && t.viewHref && (
                    <button
                      type="button"
                      className="li-rev-await-act"
                      onClick={() => router.push(t.viewHref!)}
                      title="View the document"
                    >
                      <Eye size={15} aria-hidden />
                      View
                    </button>
                  )}
                  {t.matterEntityId && (
                    <BriefButton
                      lazy
                      scope={{ kind: 'matter', matterEntityId: t.matterEntityId }}
                      className="li-rev-await-act"
                      label="Brief"
                    />
                  )}
                  {t.matterEntityId && (
                    <button
                      type="button"
                      className="li-rev-await-act"
                      onClick={() => setEmailFor(t)}
                      title="Send an email on this matter"
                    >
                      <Mail size={15} aria-hidden />
                      Email
                    </button>
                  )}
                  {t.type === 'document_review' && (
                    <button
                      type="button"
                      className="li-rev-await-sign"
                      onClick={() => router.push(t.workHref)}
                    >
                      <FileSearch size={15} aria-hidden />
                      Review
                    </button>
                  )}
                  {t.type === 'esign' && (
                    <button
                      type="button"
                      className="li-rev-await-sign"
                      onClick={() => router.push(t.workHref)}
                    >
                      <PenLine size={15} aria-hidden />
                      Sign
                    </button>
                  )}
                  {t.type === 'billing' && (
                    <button
                      type="button"
                      className="li-rev-await-sign"
                      onClick={() => router.push(t.workHref)}
                    >
                      <Receipt size={15} aria-hidden />
                      Open
                    </button>
                  )}
                  {t.type === 'client_request' && (
                    <button
                      type="button"
                      className="li-rev-await-sign"
                      onClick={() => router.push(t.workHref)}
                    >
                      <HelpCircle size={15} aria-hidden />
                      Open
                    </button>
                  )}
                  {t.type === 'workflow_step' && (
                    <button
                      type="button"
                      className="li-rev-await-sign"
                      onClick={() => router.push(t.workHref)}
                      title="Open the matter workspace"
                    >
                      <Workflow size={15} aria-hidden />
                      Open
                    </button>
                  )}
                  {t.type === 'todo' && (
                    <button
                      type="button"
                      className="li-rev-await-sign"
                      onClick={() => router.push(t.workHref)}
                      title="Open the to-do"
                    >
                      <ListTodo size={15} aria-hidden />
                      Open
                    </button>
                  )}
                  {!PRIMARY_ACTION_TYPES.includes(t.type) && (
                    <button
                      type="button"
                      className="li-rev-await-sign"
                      onClick={() => router.push(t.workHref)}
                    >
                      <ArrowRight size={15} aria-hidden />
                      Open
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {emailFor && (
        <EmailComposeModal
          matterEntityId={emailFor.matterEntityId ?? undefined}
          contactEntityId={emailFor.contactEntityId ?? undefined}
          initialSubject=""
          initialBodyMarkdown=""
          pendingDocs={[]}
          onSent={() => setEmailFor(null)}
          onClose={() => setEmailFor(null)}
        />
      )}
    </main>
  )
}
