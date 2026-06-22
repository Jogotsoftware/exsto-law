'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'
import { Tabs, type TabSpec } from '@/components/Tabs'
import {
  WeeklyCalendar,
  type CalendarItem,
  type CalendarCategory,
} from '@/components/WeeklyCalendar'
import { ChevronRightIcon, ClockIcon, Share2Icon } from '@/components/icons'

// Copies the public booking-page link to the clipboard. Replaces the old
// "/attorney/share" link, which 404'd (no such route) — the link prospects use
// to book is the public /book page.
function ShareBookingButton({ compact }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/book`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="icon-inline"
      style={compact ? { fontSize: '0.85rem' } : undefined}
    >
      <Share2Icon size={compact ? 13 : 14} />
      {copied ? 'Link copied!' : compact ? 'Share a booking link' : 'Share booking link'}
    </button>
  )
}

// Newly-booked consultations should appear without a manual reload. True Google
// push-sync is out of scope; we poll the existing `legal.calendar.upcoming`
// source on this interval — "live enough" for the dashboard.
const CALENDAR_POLL_MS = 45_000

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
  const [upcoming, setUpcoming] = useState<CalendarItem[] | null>(null)
  const [categories, setCategories] = useState<CalendarCategory[]>([])
  const [recent, setRecent] = useState<RecentBooking[] | null>(null)
  const [matters, setMatters] = useState<MatterSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)

  // Fetch the unified calendar feed (real Google events + app consultations) for a
  // broad window; the calendar navigates within it client-side. Reused by the
  // initial load and the live poll.
  const refreshUpcoming = useCallback(async () => {
    const now = Date.now()
    const fromIso = new Date(now - 7 * 24 * 3600 * 1000).toISOString()
    const toIso = new Date(now + 90 * 24 * 3600 * 1000).toISOString()
    const r = await callAttorneyMcp<{ items: CalendarItem[]; source: string; error?: string }>({
      toolName: 'legal.calendar.feed',
      input: { fromIso, toIso },
    })
    setUpcoming(r.items)
    // Surface a connected-but-failed Google read (e.g. Calendar API not enabled)
    // instead of silently showing only app consultations.
    setCalendarError(r.source === 'error' ? (r.error ?? 'Google calendar read failed.') : null)
    setLastRefreshedAt(Date.now())
  }, [])

  useEffect(() => {
    Promise.all([
      refreshUpcoming(),
      callAttorneyMcp<{ recent: RecentBooking[] }>({
        toolName: 'legal.calendar.recent_bookings',
        input: { limit: 10 },
      }).then((r) => setRecent(r.recent)),
      callAttorneyMcp<{ matters: MatterSummary[] }>({ toolName: 'legal.matter.list' }).then((m) =>
        setMatters(m.matters),
      ),
      callAttorneyMcp<{ categories: CalendarCategory[] }>({
        toolName: 'legal.calendar.categories.get',
      })
        .then((r) => setCategories(r.categories))
        .catch(() => {
          // Non-fatal: fall back to the built-in booking-category colors.
        }),
    ]).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [refreshUpcoming])

  // Live sync: poll the upcoming feed so newly-booked consultations appear
  // without a manual reload. Polling-only (no Google push); clears on unmount.
  useEffect(() => {
    const id = setInterval(() => {
      refreshUpcoming().catch(() => {
        // Transient poll failure: keep the last-good data, retry next tick.
      })
    }, CALENDAR_POLL_MS)
    return () => clearInterval(id)
  }, [refreshUpcoming])

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
      {/* Beta feedback: drop the "Hi, Juan Carlos" greeting and the share-booking
          button from this row. A neutral title keeps the page's h1 for
          structure/a11y; the booking link is still shareable from the "This week"
          row below. */}
      <PageHead title="Dashboard" />

      {error && <div className="alert alert-error">{error}</div>}

      <section>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2>This week</h2>
          <ShareBookingButton compact />
        </div>
        {calendarError && (
          <div className="alert alert-error">
            <strong>Google connected, but the live calendar read failed.</strong> {calendarError}{' '}
            <span className="text-muted">
              (If you just enabled the Calendar API in Google Cloud, wait a few minutes and reload.)
            </span>
          </div>
        )}
        {upcoming === null && !error ? (
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        ) : (
          <WeeklyCalendar
            items={upcoming ?? []}
            loaded={upcoming !== null}
            lastRefreshedAt={lastRefreshedAt}
            categories={categories}
            onChanged={refreshUpcoming}
          />
        )}
      </section>

      <div className="home-grid">
        <section>
          <h2>Matters</h2>
          {matters === null && !error && (
            <div className="loading-block">
              <span className="spinner" /> Loading…
            </div>
          )}
          {matters && <Tabs tabs={matterTabs} />}
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
    </main>
  )
}
