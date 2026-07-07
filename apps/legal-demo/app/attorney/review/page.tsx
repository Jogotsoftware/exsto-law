'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { formatDateTime } from '@/lib/datetime'
import { PageHead } from '@/components/PageHead'

// Shared with the detail page: a step-through review session is the ordered list of
// selected draft ids + where we are in it, kept in sessionStorage (per tab) and
// flagged on the URL with ?review=session.
export const REVIEW_SESSION_KEY = 'reviewSession'

interface PendingDraft {
  documentVersionId: string
  documentEntityId: string
  matterEntityId: string
  matterNumber: string
  documentKind: string
  versionNumber: number
  status: string
  recordedAt: string
}

// Batch actions map 1:1 to the per-draft review MCP tools the detail page already
// drives. request_revision requires notes (same rule as the detail page).
type BatchAction = 'approve' | 'request_revision' | 'reject'
const BATCH_TOOL: Record<BatchAction, string> = {
  approve: 'legal.draft.approve',
  request_revision: 'legal.draft.request_revision',
  reject: 'legal.draft.reject',
}
const BATCH_LABEL: Record<BatchAction, string> = {
  approve: 'Approve',
  request_revision: 'Request revision',
  reject: 'Reject',
}

type SortKey = 'recordedAt' | 'matterNumber' | 'documentKind'
type ItemState = 'queued' | 'running' | 'ok' | 'error'
interface ItemResult {
  state: ItemState
  message?: string
}

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, ' ')
}

// A clickable column header that sorts the queue by `sortKey`. Clicking the
// active column flips direction; an arrow shows the current state (▲/▼), and a
// faint ↕ marks the other sortable columns. aria-sort keeps it accessible.
function SortHeader({
  label,
  columnKey,
  activeKey,
  asc,
  onSort,
}: {
  label: string
  columnKey: SortKey
  activeKey: SortKey
  asc: boolean
  onSort: (k: SortKey) => void
}) {
  const active = activeKey === columnKey
  return (
    <th
      className="sortable-th"
      role="button"
      tabIndex={0}
      aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
      title={`Sort by ${label}`}
      onClick={() => onSort(columnKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSort(columnKey)
        }
      }}
    >
      {label} <span className="sort-arrow">{active ? (asc ? '▲' : '▼') : '↕'}</span>
    </th>
  )
}

export default function ReviewQueue() {
  const router = useRouter()
  const [drafts, setDrafts] = useState<PendingDraft[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Selection + filter/sort state. No shared "saved-views" component exists in the
  // app yet (only the savedViews data layer), so the queue ships a self-contained
  // filter/sort here rather than rebuilding one elsewhere.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('recordedAt')
  const [sortAsc, setSortAsc] = useState(false)

  // Batch-execute state.
  const [batchAction, setBatchAction] = useState<BatchAction>('approve')
  const [batchNotes, setBatchNotes] = useState('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Map<string, ItemResult>>(new Map())

  async function load() {
    try {
      const res = await callAttorneyMcp<{ drafts: PendingDraft[] }>({
        toolName: 'legal.draft.list_pending',
      })
      setDrafts(res.drafts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    load()
  }, [])

  const kinds = useMemo(
    () => Array.from(new Set((drafts ?? []).map((d) => d.documentKind))).sort(),
    [drafts],
  )

  const visible = useMemo(() => {
    let list = drafts ?? []
    if (kindFilter !== 'all') list = list.filter((d) => d.documentKind === kindFilter)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (d) =>
          d.matterNumber.toLowerCase().includes(q) ||
          humanizeKind(d.documentKind).toLowerCase().includes(q),
      )
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'recordedAt') cmp = a.recordedAt.localeCompare(b.recordedAt)
      else if (sortKey === 'matterNumber') cmp = a.matterNumber.localeCompare(b.matterNumber)
      else cmp = a.documentKind.localeCompare(b.documentKind)
      return sortAsc ? cmp : -cmp
    })
    return sorted
  }, [drafts, kindFilter, query, sortKey, sortAsc])

  // Selection is scoped to what's visible: clear any selection that filtered out so
  // a batch never runs on a hidden row.
  const visibleIds = useMemo(() => new Set(visible.map((d) => d.documentVersionId)), [visible])
  const selectedVisible = useMemo(
    () => [...selected].filter((id) => visibleIds.has(id)),
    [selected, visibleIds],
  )
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length

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
      if (allVisibleSelected) visible.forEach((d) => next.delete(d.documentVersionId))
      else visible.forEach((d) => next.add(d.documentVersionId))
      return next
    })
  }

  // Click a column header to sort by it; clicking the active column flips
  // direction. Date defaults to newest-first; text columns to A→Z.
  function sortBy(key: SortKey) {
    if (key === sortKey) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(key !== 'recordedAt')
    }
  }

  const notesRequired = batchAction === 'request_revision'
  const canRun =
    !running && selectedVisible.length > 0 && (!notesRequired || batchNotes.trim().length > 0)

  // Sequential batch-execute: run the chosen action on each selected draft one at a
  // time, recording a per-item result. A single failure is captured and the batch
  // keeps going (one bad draft must not sink the rest).
  async function runBatch() {
    if (!canRun) return
    const ids = visible.map((d) => d.documentVersionId).filter((id) => selected.has(id)) // preserve the on-screen (sorted) order
    setRunning(true)
    setError(null)
    setResults(new Map(ids.map((id) => [id, { state: 'queued' as ItemState }])))

    const toolName = BATCH_TOOL[batchAction]
    const notes = batchNotes.trim() || undefined
    for (const id of ids) {
      setResults((prev) => new Map(prev).set(id, { state: 'running' }))
      try {
        await callAttorneyMcp({ toolName, input: { documentVersionId: id, reviewNotes: notes } })
        setResults((prev) =>
          new Map(prev).set(id, { state: 'ok', message: BATCH_LABEL[batchAction] }),
        )
      } catch (err) {
        setResults((prev) =>
          new Map(prev).set(id, {
            state: 'error',
            message: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    }

    setRunning(false)
    // Reload so completed drafts (no longer pending_review) drop off, but keep the
    // results map so the attorney sees what each item did even after it leaves.
    setSelected(new Set())
    setBatchNotes('')
    await load()
  }

  // Step-through review: open each selected draft in order and auto-advance after
  // each disposition (the detail page drives the advance). Records the ordered id
  // list in sessionStorage and opens the first. This is the "review one by one"
  // path, distinct from the batch-apply above.
  function beginReview() {
    const ids = visible.map((d) => d.documentVersionId).filter((id) => selected.has(id))
    if (ids.length === 0) return
    sessionStorage.setItem(REVIEW_SESSION_KEY, JSON.stringify({ ids, index: 0 }))
    router.push(`/attorney/review/${ids[0]}?review=session`)
  }

  const okCount = [...results.values()].filter((r) => r.state === 'ok').length
  const errCount = [...results.values()].filter((r) => r.state === 'error').length

  return (
    <main>
      <PageHead title="Review queue" />

      {error && <div className="alert alert-error">{error}</div>}

      {drafts === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}

      {drafts && drafts.length === 0 && (
        <section>
          <p>No drafts pending review.</p>
        </section>
      )}

      {drafts && drafts.length > 0 && (
        <>
          {/* Filter toolbar. Sorting lives on the clickable column headers below. */}
          <div className="row" style={{ marginBottom: 'var(--space-3)' }}>
            <input
              type="text"
              placeholder="Search matter or document kind…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 'auto', flex: '1 1 14rem', minWidth: '12rem' }}
            />
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              style={{ width: 'auto' }}
              aria-label="Filter by document kind"
            >
              <option value="all">All document kinds</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {humanizeKind(k)}
                </option>
              ))}
            </select>
            <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginLeft: 'auto' }}>
              {visible.length} of {drafts.length} shown
            </span>
          </div>

          {/* Batch action bar — appears once at least one visible draft is selected. */}
          {selectedVisible.length > 0 && (
            <section
              style={{
                marginBottom: 'var(--space-4)',
                background: 'var(--navy-50)',
                border: '1px solid var(--navy-100)',
              }}
            >
              <div className="row">
                <strong>{selectedVisible.length} selected</strong>
                <button className="primary" onClick={beginReview} disabled={running}>
                  Begin review →
                </button>
                <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
                  or apply to all:
                </span>
                <select
                  value={batchAction}
                  onChange={(e) => setBatchAction(e.target.value as BatchAction)}
                  style={{ width: 'auto' }}
                  disabled={running}
                  aria-label="Batch action"
                >
                  <option value="approve">Approve</option>
                  <option value="request_revision">Request revision</option>
                  <option value="reject">Reject</option>
                </select>
                <button
                  className={
                    batchAction === 'reject' ? 'danger' : batchAction === 'approve' ? 'ok' : 'warn'
                  }
                  disabled={!canRun}
                  onClick={runBatch}
                >
                  {running && <span className="spinner" />}
                  {running
                    ? `Running ${okCount + errCount}/${selectedVisible.length}…`
                    : `${BATCH_LABEL[batchAction]} ${selectedVisible.length} draft${selectedVisible.length === 1 ? '' : 's'}`}
                </button>
                <button onClick={() => setSelected(new Set())} disabled={running}>
                  Clear
                </button>
              </div>
              {notesRequired && (
                <label style={{ display: 'block', marginTop: 'var(--space-3)' }}>
                  Revision notes (required, applied to each selected draft)
                  <textarea
                    rows={2}
                    value={batchNotes}
                    onChange={(e) => setBatchNotes(e.target.value)}
                    placeholder="What needs to change across these drafts?"
                    style={{ marginTop: 'var(--space-1)' }}
                    disabled={running}
                  />
                </label>
              )}
            </section>
          )}

          {/* Batch result summary — persists after the list reloads. */}
          {results.size > 0 && (
            <div
              className={errCount > 0 ? 'alert alert-error' : 'badge ok'}
              style={{ display: 'block', marginBottom: 'var(--space-3)' }}
            >
              Batch complete: {okCount} succeeded
              {errCount > 0 ? `, ${errCount} failed` : ''}.
            </div>
          )}

          <section style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '2.5rem' }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                      style={{ width: 'auto' }}
                    />
                  </th>
                  <SortHeader
                    label="Matter"
                    columnKey="matterNumber"
                    activeKey={sortKey}
                    asc={sortAsc}
                    onSort={sortBy}
                  />
                  <SortHeader
                    label="Document kind"
                    columnKey="documentKind"
                    activeKey={sortKey}
                    asc={sortAsc}
                    onSort={sortBy}
                  />
                  <th>Version</th>
                  <SortHeader
                    label="Generated"
                    columnKey="recordedAt"
                    activeKey={sortKey}
                    asc={sortAsc}
                    onSort={sortBy}
                  />
                  <th>Result</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => {
                  const r = results.get(d.documentVersionId)
                  return (
                    <tr key={d.documentVersionId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(d.documentVersionId)}
                          onChange={() => toggle(d.documentVersionId)}
                          disabled={running}
                          aria-label={`Select ${d.matterNumber}`}
                          style={{ width: 'auto' }}
                        />
                      </td>
                      <td>{d.matterNumber}</td>
                      <td>{humanizeKind(d.documentKind)}</td>
                      <td>v{d.versionNumber}</td>
                      <td>{formatDateTime(d.recordedAt)}</td>
                      <td>
                        {r?.state === 'running' && <span className="spinner" />}
                        {r?.state === 'queued' && (
                          <span style={{ color: 'var(--muted)' }}>queued</span>
                        )}
                        {r?.state === 'ok' && <span className="badge ok">{r.message}</span>}
                        {r?.state === 'error' && (
                          <span className="badge danger" title={r.message}>
                            failed
                          </span>
                        )}
                      </td>
                      <td>
                        <Link href={`/attorney/review/${d.documentVersionId}`}>Review</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  )
}
