'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'
import { Tabs, type TabSpec } from '@/components/Tabs'
import { CalendarIcon, ChevronRightIcon, ClockIcon, Share2Icon } from '@/components/icons'

interface UpcomingBooking {
  matterEntityId: string
  matterNumber: string
  clientName: string
  serviceKey: string
  scheduledAt: string
  scheduledEnd: string | null
  status: string
}

interface RecentBooking {
  matterEntityId: string
  matterNumber: string
  clientName: string
  serviceKey: string
  scheduledAt: string | null
  status: string
  bookedAt: string
}

interface MatterSummary {
  matterEntityId: string
  matterNumber: string
  clientName: string
  practiceArea: string
  status: string
  summary: string
  createdAt: string
}

const STATUS_COLUMNS: Array<{ key: string; label: string; matches: (s: string) => boolean }> = [
  {
    key: 'inquiry',
    label: 'New inquiries',
    matches: (s) =>
      s === 'inquiry' || s === 'questionnaire_pending' || s === 'questionnaire_submitted',
  },
  {
    key: 'scheduled',
    label: 'Consultation booked',
    matches: (s) => s === 'consultation_scheduled' || s === 'consultation_completed',
  },
  {
    key: 'drafting',
    label: 'Drafting / review',
    matches: (s) => s === 'drafting' || s === 'review_pending',
  },
  {
    key: 'active',
    label: 'Active / signed',
    matches: (s) => s === 'engagement_signed' || s === 'matter_active',
  },
  { key: 'closed', label: 'Closed', matches: (s) => s === 'matter_closed' },
]

function humanizeService(key: string): string {
  if (key === 'llc_formation') return 'NC LLC formation'
  if (key === 'oa_amendment') return 'OA amendment'
  if (key === 'business_formation') return 'NC LLC formation'
  if (key === 'other') return 'Custom'
  return key.replace(/_/g, ' ')
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
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
  return `${d}d ago`
}

export default function AttorneyHome() {
  const [upcoming, setUpcoming] = useState<UpcomingBooking[] | null>(null)
  const [recent, setRecent] = useState<RecentBooking[] | null>(null)
  const [matters, setMatters] = useState<MatterSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      callAttorneyMcp<{ upcoming: UpcomingBooking[] }>({
        toolName: 'legal.calendar.upcoming',
        input: { limit: 50 },
      }),
      callAttorneyMcp<{ recent: RecentBooking[] }>({
        toolName: 'legal.calendar.recent_bookings',
        input: { limit: 10 },
      }),
      callAttorneyMcp<{ matters: MatterSummary[] }>({ toolName: 'legal.matter.list' }),
    ])
      .then(([u, r, m]) => {
        setUpcoming(u.upcoming)
        setRecent(r.recent)
        setMatters(m.matters)
      })
      .catch((e) => setError(e.message))
  }, [])

  const upcomingByDay = useMemo(() => {
    if (!upcoming) return new Map<string, UpcomingBooking[]>()
    const map = new Map<string, UpcomingBooking[]>()
    for (const b of upcoming) {
      const key = dayKey(b.scheduledAt)
      const list = map.get(key) ?? []
      list.push(b)
      map.set(key, list)
    }
    return map
  }, [upcoming])

  const matterGroups = useMemo(() => {
    const buckets: Record<string, MatterSummary[]> = {}
    for (const col of STATUS_COLUMNS) buckets[col.key] = []
    for (const m of matters ?? []) {
      const col = STATUS_COLUMNS.find((c) => c.matches(m.status)) ?? STATUS_COLUMNS[0]!
      buckets[col.key]!.push(m)
    }
    return buckets
  }, [matters])

  const matterTabs: TabSpec[] = STATUS_COLUMNS.map((col) => {
    const group = matterGroups[col.key] ?? []
    return {
      key: col.key,
      label: col.label,
      count: group.length,
      content:
        group.length === 0 ? (
          <p className="text-muted">Nothing here yet.</p>
        ) : (
          <div className="matter-list">
            {group.map((m) => (
              <Link
                key={m.matterEntityId}
                href={`/attorney/matters/${m.matterEntityId}`}
                className="matter-row"
              >
                <div>
                  <div className="matter-row-title">{m.clientName || m.matterNumber}</div>
                  <div className="matter-row-sub">
                    {humanizeService(m.practiceArea)}
                    {m.summary && ` · ${m.summary}`}
                  </div>
                </div>
                <ChevronRightIcon size={16} className="matter-row-chevron" />
              </Link>
            ))}
          </div>
        ),
    }
  })

  return (
    <main>
      <PageHead
        title="Hi, Juan Carlos"
        actions={
          <Link href="/attorney/share">
            <button className="icon-inline">
              <Share2Icon size={14} />
              Share booking link
            </button>
          </Link>
        }
      />

      {error && <div className="alert alert-error">{error}</div>}

      <div className="home-grid">
        <section>
          <h2>Upcoming consultations</h2>
          {upcoming === null && !error && (
            <div className="loading-block">
              <span className="spinner" /> Loading…
            </div>
          )}
          {upcoming && upcoming.length === 0 && (
            <p className="text-muted">
              No upcoming consultations. <Link href="/attorney/share">Share a booking link.</Link>
            </p>
          )}
          {upcoming && upcoming.length > 0 && (
            <div className="day-list">
              {Array.from(upcomingByDay.entries()).map(([day, bookings]) => (
                <div key={day} className="day-group">
                  <div className="day-label">
                    <CalendarIcon size={12} />
                    {day}
                  </div>
                  {bookings.map((b) => (
                    <Link
                      key={b.matterEntityId}
                      href={`/attorney/matters/${b.matterEntityId}`}
                      className="cal-card"
                    >
                      <div className="cal-time">{timeOnly(b.scheduledAt)}</div>
                      <div>
                        <div className="cal-client">{b.clientName || b.matterNumber}</div>
                        <div className="cal-service">{humanizeService(b.serviceKey)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2>Recently booked</h2>
          {recent === null && !error && (
            <div className="loading-block">
              <span className="spinner" /> Loading…
            </div>
          )}
          {recent && recent.length === 0 && <p className="text-muted">No bookings yet.</p>}
          {recent && recent.length > 0 && (
            <div className="recent-list">
              {recent.map((r) => (
                <Link
                  key={r.matterEntityId}
                  href={`/attorney/matters/${r.matterEntityId}`}
                  className="recent-row"
                >
                  <div>
                    <div className="recent-client">{r.clientName || r.matterNumber}</div>
                    <div className="recent-meta">{humanizeService(r.serviceKey)}</div>
                  </div>
                  <div className="recent-time">
                    <ClockIcon size={12} />
                    {timeAgo(r.bookedAt)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section>
        <h2>Matters</h2>
        {matters === null && !error && (
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        )}
        {matters && <Tabs tabs={matterTabs} />}
      </section>
    </main>
  )
}
