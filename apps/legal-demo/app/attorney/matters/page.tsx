'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'
import { ClockIcon } from '@/components/icons'

interface MatterSummary {
  matterEntityId: string
  matterNumber: string
  clientName: string
  practiceArea: string
  status: string
  summary: string
  createdAt: string
}

function humanizeService(key: string): string {
  if (!key) return '—'
  if (key === 'llc_formation') return 'NC LLC formation'
  if (key === 'oa_amendment') return 'OA amendment'
  if (key === 'business_formation') return 'NC LLC formation'
  if (key === 'other') return 'Custom'
  return key.replace(/_/g, ' ')
}

function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

function statusBadgeClass(status: string): string {
  if (['consultation_scheduled', 'consultation_completed'].includes(status)) return 'badge info'
  if (['drafting', 'review_pending'].includes(status)) return 'badge warn'
  if (['engagement_signed', 'matter_active'].includes(status)) return 'badge ok'
  return 'badge'
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const ms = Date.now() - t
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}

type SortKey = 'matterNumber' | 'clientName' | 'practiceArea' | 'status' | 'createdAt'

export default function MattersPage() {
  const [matters, setMatters] = useState<MatterSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [serviceFilter, setServiceFilter] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    callAttorneyMcp<{ matters: MatterSummary[] }>({ toolName: 'legal.matter.list' })
      .then((r) => setMatters(r.matters))
      .catch((e) => setError(e.message))
  }, [])

  // Distinct filter options, derived from the loaded matters.
  const statusOptions = useMemo(
    () => Array.from(new Set((matters ?? []).map((m) => m.status).filter(Boolean))).sort(),
    [matters],
  )
  const serviceOptions = useMemo(
    () => Array.from(new Set((matters ?? []).map((m) => m.practiceArea).filter(Boolean))).sort(),
    [matters],
  )
  const clientOptions = useMemo(
    () => Array.from(new Set((matters ?? []).map((m) => m.clientName).filter(Boolean))).sort(),
    [matters],
  )

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Dates default newest-first; text columns default A→Z.
      setSortDir(key === 'createdAt' ? 'desc' : 'asc')
    }
  }

  const view = useMemo(() => {
    if (!matters) return null
    const q = query.trim().toLowerCase()
    const rows = matters.filter((m) => {
      if (
        q &&
        ![m.matterNumber, m.clientName, m.practiceArea, m.summary, m.status].some((f) =>
          (f ?? '').toLowerCase().includes(q),
        )
      )
        return false
      if (statusFilter && m.status !== statusFilter) return false
      if (serviceFilter && m.practiceArea !== serviceFilter) return false
      if (clientFilter && m.clientName !== clientFilter) return false
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sortKey === 'createdAt') {
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
      }
      return (
        (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '', undefined, { sensitivity: 'base' }) * dir
      )
    })
  }, [matters, query, statusFilter, serviceFilter, clientFilter, sortKey, sortDir])

  function SortHeader({ label, sortKey: key }: { label: string; sortKey: SortKey }) {
    const active = sortKey === key
    return (
      <th
        className="sortable-th"
        onClick={() => toggleSort(key)}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <span className="sort-arrow">{active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </th>
    )
  }

  const hasFilters = Boolean(query || statusFilter || serviceFilter || clientFilter)

  return (
    <main>
      <PageHead title="Matters" description="All legal matters — open, in progress, and closed." />

      {error && <div className="alert alert-error">{error}</div>}

      <section style={{ padding: 0, overflow: 'hidden' }}>
        <div className="client-search-row">
          <input
            type="search"
            placeholder="Search by matter #, client, service, or summary…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {humanizeStatus(s)}
              </option>
            ))}
          </select>
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            aria-label="Filter by service"
          >
            <option value="">All services</option>
            {serviceOptions.map((s) => (
              <option key={s} value={s}>
                {humanizeService(s)}
              </option>
            ))}
          </select>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            aria-label="Filter by client"
          >
            <option value="">All clients</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setStatusFilter('')
                setServiceFilter('')
                setClientFilter('')
              }}
            >
              Clear
            </button>
          )}
        </div>
        {view === null && !error && (
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        )}
        {view && view.length === 0 && (
          <div className="loading-block text-muted">
            {matters && matters.length === 0 ? 'No matters yet.' : 'No matches.'}
          </div>
        )}
        {view && view.length > 0 && (
          <table className="client-table">
            <thead>
              <tr>
                <SortHeader label="Matter" sortKey="matterNumber" />
                <SortHeader label="Client" sortKey="clientName" />
                <SortHeader label="Service" sortKey="practiceArea" />
                <SortHeader label="Status" sortKey="status" />
                <SortHeader label="Opened" sortKey="createdAt" />
              </tr>
            </thead>
            <tbody>
              {view.map((m) => (
                <tr key={m.matterEntityId}>
                  <td>
                    <Link
                      href={`/attorney/matters/${m.matterEntityId}`}
                      className="client-name-link"
                    >
                      {m.matterNumber}
                    </Link>
                    {m.summary && (
                      <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                        {m.summary}
                      </div>
                    )}
                  </td>
                  <td>{m.clientName || '—'}</td>
                  <td className="text-muted">{humanizeService(m.practiceArea)}</td>
                  <td>
                    <span className={statusBadgeClass(m.status)}>{humanizeStatus(m.status)}</span>
                  </td>
                  <td className="text-muted">
                    <span className="icon-inline">
                      <ClockIcon size={12} />
                      {timeAgo(m.createdAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
