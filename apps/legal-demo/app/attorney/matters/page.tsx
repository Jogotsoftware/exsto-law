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

export default function MattersPage() {
  const [matters, setMatters] = useState<MatterSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    callAttorneyMcp<{ matters: MatterSummary[] }>({ toolName: 'legal.matter.list' })
      .then((r) => setMatters(r.matters))
      .catch((e) => setError(e.message))
  }, [])

  const filtered = useMemo(() => {
    if (!matters) return null
    const q = query.trim().toLowerCase()
    if (!q) return matters
    return matters.filter((m) =>
      [m.matterNumber, m.clientName, m.practiceArea, m.summary, m.status].some((f) =>
        (f ?? '').toLowerCase().includes(q),
      ),
    )
  }, [matters, query])

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
        </div>
        {filtered === null && !error && (
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        )}
        {filtered && filtered.length === 0 && (
          <div className="loading-block text-muted">
            {matters && matters.length === 0 ? 'No matters yet.' : 'No matches.'}
          </div>
        )}
        {filtered && filtered.length > 0 && (
          <table className="client-table">
            <thead>
              <tr>
                <th>Matter</th>
                <th>Client</th>
                <th>Service</th>
                <th>Status</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
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
