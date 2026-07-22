'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { formatDateTime } from '@/lib/datetime'
import { BriefButton } from '@/components/BriefButton'

// Shared with the detail page: a step-through review session is the ordered list of
// selected draft ids + where we are in it, kept in sessionStorage (per tab) and
// flagged on the URL with ?review=session.
export const REVIEW_SESSION_KEY = 'reviewSession'

interface PendingDraft {
  documentVersionId: string
  documentEntityId: string
  matterEntityId: string
  matterNumber: string
  clientName: string
  documentKind: string
  versionNumber: number
  status: string
  recordedAt: string
  channel: 'document' | 'communication'
  emailSubject: string | null
  emailToRole: string | null
  voiceViolations: { rule: string; where: string; offending: string }[] | null
}

// Sortable columns. WP-C adds `clientName` (the built CLIENT column).
type SortKey = 'recordedAt' | 'matterNumber' | 'clientName' | 'documentKind'

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, ' ')
}

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

export default function ReviewQueue() {
  const router = useRouter()
  const [drafts, setDrafts] = useState<PendingDraft[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('recordedAt')
  const [sortAsc, setSortAsc] = useState(false)

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
          d.clientName.toLowerCase().includes(q) ||
          humanizeKind(d.documentKind).toLowerCase().includes(q) ||
          (d.emailSubject ?? '').toLowerCase().includes(q),
      )
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'recordedAt') cmp = a.recordedAt.localeCompare(b.recordedAt)
      else if (sortKey === 'matterNumber') cmp = a.matterNumber.localeCompare(b.matterNumber)
      else if (sortKey === 'clientName') cmp = a.clientName.localeCompare(b.clientName)
      else cmp = a.documentKind.localeCompare(b.documentKind)
      return sortAsc ? cmp : -cmp
    })
    return sorted
  }, [drafts, kindFilter, query, sortKey, sortAsc])

  // Selection is scoped to what's visible so a review never opens a hidden row.
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

  // Click a header to sort; clicking the active column flips direction. Date
  // defaults newest-first; text columns A→Z.
  function sortBy(key: SortKey) {
    if (key === sortKey) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(key !== 'recordedAt')
    }
  }

  // Begin review (the ONLY thing selection feeds — the batch disposition bar was
  // cut, FOUNDER DECISION 2026-07-17): walk the selected drafts in order; the
  // reader auto-advances after each disposition. Ordered ids in sessionStorage.
  function beginReview() {
    const ids = visible.map((d) => d.documentVersionId).filter((id) => selected.has(id))
    if (ids.length === 0) return
    sessionStorage.setItem(REVIEW_SESSION_KEY, JSON.stringify({ ids, index: 0 }))
    router.push(`/attorney/review/${ids[0]}?review=session`)
  }

  function openReview(id: string) {
    router.push(`/attorney/review/${id}`)
  }

  return (
    <main className="li-rev">
      <h1 className="li-rev-title">Review Queue</h1>
      <p className="li-rev-sub">
        Drafts the AI produced, waiting for your review before they reach the client.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {drafts === null && !error && (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      )}

      {drafts && drafts.length === 0 && (
        <div className="li-rev-table">
          <div className="li-rev-thead">
            <label className="li-rev-check">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAll}
                aria-label="Select all"
              />
            </label>
            <button type="button" className="li-rev-th" onClick={() => sortBy('matterNumber')}>
              MATTER <SortCaret columnKey="matterNumber" activeKey={sortKey} asc={sortAsc} />
            </button>
            <button type="button" className="li-rev-th" onClick={() => sortBy('clientName')}>
              CLIENT <SortCaret columnKey="clientName" activeKey={sortKey} asc={sortAsc} />
            </button>
            <button type="button" className="li-rev-th" onClick={() => sortBy('documentKind')}>
              DOCUMENT KIND <SortCaret columnKey="documentKind" activeKey={sortKey} asc={sortAsc} />
            </button>
            <span className="li-rev-th li-rev-th--static">VERSION</span>
            <button type="button" className="li-rev-th" onClick={() => sortBy('recordedAt')}>
              GENERATED <SortCaret columnKey="recordedAt" activeKey={sortKey} asc={sortAsc} />
            </button>
            <span className="li-rev-th li-rev-th--static li-rev-th--result">RESULT</span>
          </div>
          <div className="li-rev-empty">You are all up to date, nothing to review.</div>
        </div>
      )}

      {drafts && drafts.length > 0 && (
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
                placeholder="Search matter, client, or document kind…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search the review queue"
              />
            </div>
            <select
              className="li-rev-kind"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              aria-label="Filter by document kind"
            >
              <option value="all">All document kinds</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {humanizeKind(k)}
                </option>
              ))}
            </select>
            <span className="li-rev-count">
              {visible.length} of {drafts.length} shown
            </span>
          </div>

          {/* Selection bar — Begin review only (batch disposition cut to comp). */}
          {selectedVisible.length > 0 && (
            <div className="li-rev-selbar">
              <span className="li-rev-selcount">{selectedVisible.length} selected</span>
              <button type="button" className="li-rev-clear" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <button type="button" className="li-rev-begin" onClick={beginReview}>
                Begin Review
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
                  aria-label="Select all"
                />
              </label>
              <button type="button" className="li-rev-th" onClick={() => sortBy('matterNumber')}>
                MATTER <SortCaret columnKey="matterNumber" activeKey={sortKey} asc={sortAsc} />
              </button>
              <button type="button" className="li-rev-th" onClick={() => sortBy('clientName')}>
                CLIENT <SortCaret columnKey="clientName" activeKey={sortKey} asc={sortAsc} />
              </button>
              <button type="button" className="li-rev-th" onClick={() => sortBy('documentKind')}>
                DOCUMENT KIND{' '}
                <SortCaret columnKey="documentKind" activeKey={sortKey} asc={sortAsc} />
              </button>
              <span className="li-rev-th li-rev-th--static">VERSION</span>
              <button type="button" className="li-rev-th" onClick={() => sortBy('recordedAt')}>
                GENERATED <SortCaret columnKey="recordedAt" activeKey={sortKey} asc={sortAsc} />
              </button>
              <span className="li-rev-th li-rev-th--static li-rev-th--result">RESULT</span>
            </div>

            {visible.map((d) => (
              <div key={d.documentVersionId} className="li-rev-row">
                <label className="li-rev-check">
                  <input
                    type="checkbox"
                    checked={selected.has(d.documentVersionId)}
                    onChange={() => toggle(d.documentVersionId)}
                    aria-label={`Select ${d.matterNumber}`}
                  />
                </label>
                <span className="li-rev-matter">{d.matterNumber}</span>
                <span className="li-rev-client">{d.clientName || '—'}</span>
                <span className="li-rev-kindcell">
                  {d.channel === 'communication' ? (
                    <>
                      <span
                        className="li-rev-emailtag"
                        title="An email draft — approving sends it."
                      >
                        Email
                      </span>
                      {d.emailSubject || humanizeKind(d.documentKind)}
                      {(d.voiceViolations?.length ?? 0) > 0 && (
                        <span
                          className="li-rev-voicetag"
                          title={d.voiceViolations!.map((v) => v.offending).join('\n')}
                        >
                          Voice check: {d.voiceViolations!.length}
                        </span>
                      )}
                    </>
                  ) : (
                    humanizeKind(d.documentKind)
                  )}
                </span>
                <span className="li-rev-ver">v{d.versionNumber}</span>
                <span className="li-rev-when">{formatDateTime(d.recordedAt)}</span>
                <span className="li-rev-rowactions">
                  {/* lazy: one button per row must not fire N brief reads on load */}
                  <BriefButton
                    lazy
                    scope={{ kind: 'matter', matterEntityId: d.matterEntityId }}
                    className="li-rev-rowbrief"
                    label="Brief"
                  />
                  <button
                    type="button"
                    className="li-rev-result"
                    onClick={() => openReview(d.documentVersionId)}
                  >
                    Review
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
