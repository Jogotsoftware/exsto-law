'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { buildFirmBookingUrl, useFirmPublicSlug } from '@/lib/firmBookingLink'
import {
  WeeklyCalendar,
  type CalendarItem,
  type CalendarCategory,
} from '@/components/WeeklyCalendar'
import { ChevronDownIcon, ClockIcon, Share2Icon } from '@/components/icons'
import { parseTimestamp } from '@/lib/datetime'
import { serviceLabel, useServiceDisplayNames } from '@/lib/serviceLabel'

// Copies the public booking-page link to the clipboard. Replaces the old
// "/attorney/share" link, which 404'd (no such route) — the link prospects use
// to book is the public /book page. MULTI-TENANT-1: the link carries THIS firm's
// slug (?firm=…) so a prospect lands on the attorney's own firm, not the default.
function ShareBookingButton() {
  const [copied, setCopied] = useState(false)
  const slug = useFirmPublicSlug()
  async function copy() {
    try {
      await navigator.clipboard.writeText(buildFirmBookingUrl(window.location.origin, slug))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button type="button" onClick={copy} className="li-dash-share">
      <Share2Icon size={14} />
      {copied ? 'Link copied!' : 'Share a booking link'}
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

// FB-H — one pressing item from the attention engine (legal.attention.feed).
interface AttentionItem {
  kind: string
  title: string
  why: string
  deepLink: string
  rank: number
  occurredAt: string
  entityId?: string
}

// Short chip label + status-token colors per kind, so the card reads at a glance
// which KIND of pressing thing each row is. Colors reuse the shared li- status
// pairs (same tokens the matters table uses). Unknown kinds fall back to neutral.
const ATTENTION_KIND_META: Record<string, { label: string; fg: string; bg: string }> = {
  overdue_task: { label: 'Overdue', fg: 'var(--li-danger)', bg: 'var(--li-danger-bg)' },
  awaiting_reply: { label: 'Reply', fg: 'var(--li-warn)', bg: 'var(--li-warn-bg)' },
  draft_pending_review: { label: 'Review', fg: 'var(--li-warn)', bg: 'var(--li-warn-bg)' },
  envelope_unsigned: { label: 'Unsigned', fg: 'var(--li-info)', bg: 'var(--li-info-bg)' },
  invoice_unpaid: { label: 'Unpaid', fg: 'var(--li-info)', bg: 'var(--li-info-bg)' },
  workflow_parked: { label: 'Stuck', fg: 'var(--li-neutral)', bg: 'var(--li-neutral-bg)' },
  stale_matter: { label: 'No activity', fg: 'var(--li-muted)', bg: 'var(--li-border-soft)' },
  due_soon_task: { label: 'Due soon', fg: 'var(--li-neutral)', bg: 'var(--li-neutral-bg)' },
}

function attentionKindMeta(kind: string): { label: string; fg: string; bg: string } {
  return (
    ATTENTION_KIND_META[kind] ?? {
      label: 'Attention',
      fg: 'var(--li-muted)',
      bg: 'var(--li-border-soft)',
    }
  )
}

// The matters TABLE's status filter groups + chip styling (li-dash-mstatus). Same
// bucketing the old status-tab panel used, so the filter still covers every status
// the app produces. Colors reuse the shared li- status-pair tokens (ADAPT — comp
// hardcodes per-row demo colors; we derive them from real status instead).
const STATUS_GROUPS: Array<{
  key: string
  label: string
  chipLabel: string
  matches: (s: string) => boolean
  fg: string
  bg: string
}> = [
  {
    key: 'inquiry',
    label: 'New inquiries',
    chipLabel: 'New inquiry',
    matches: (s) =>
      s === 'inquiry' || s === 'questionnaire_pending' || s === 'questionnaire_submitted',
    // Neutral gray per the comp's matters table (stBadge); matches the matters
    // list chip (attorney/matters/page.tsx) so the status reads the same everywhere.
    fg: 'var(--li-neutral)',
    bg: 'var(--li-neutral-bg)',
  },
  {
    key: 'scheduled',
    label: 'Consultation booked',
    chipLabel: 'Consultation booked',
    matches: (s) => s === 'consultation_scheduled' || s === 'consultation_completed',
    fg: 'var(--li-info)',
    bg: 'var(--li-info-bg)',
  },
  {
    key: 'drafting',
    label: 'Drafting / review',
    chipLabel: 'Drafting',
    matches: (s) => s === 'drafting' || s === 'review_pending',
    fg: 'var(--li-warn)',
    bg: 'var(--li-warn-bg)',
  },
  {
    key: 'active',
    label: 'Active / signed',
    chipLabel: 'Active',
    matches: (s) => s === 'engagement_signed' || s === 'matter_active',
    fg: 'var(--li-ok)',
    bg: 'var(--li-ok-bg)',
  },
  {
    key: 'closed',
    label: 'Closed',
    chipLabel: 'Closed',
    matches: (s) => s === 'matter_closed',
    fg: 'var(--li-muted)',
    bg: 'var(--li-border-soft)',
  },
]

function matterStatusGroup(status: string): (typeof STATUS_GROUPS)[number] {
  return STATUS_GROUPS.find((g) => g.matches(status)) ?? STATUS_GROUPS[0]!
}

function timeAgo(iso: string): string {
  const t = parseTimestamp(iso)?.getTime() ?? NaN
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

// Gmail-style short date for the matters table's DATE column: "Jan 12", or with a
// year once it's not the current one. Same convention as the mail inbox.
function formatDateShort(iso: string): string {
  const d = parseTimestamp(iso)
  if (!d) return '—'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  )
}

export default function AttorneyHome() {
  const [upcoming, setUpcoming] = useState<CalendarItem[] | null>(null)
  const [categories, setCategories] = useState<CalendarCategory[]>([])
  const [recent, setRecent] = useState<RecentBooking[] | null>(null)
  const [matters, setMatters] = useState<MatterSummary[] | null>(null)
  const [attention, setAttention] = useState<AttentionItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const [dashStatusFilter, setDashStatusFilter] = useState('')
  const [dashSortDir, setDashSortDir] = useState<'asc' | 'desc'>('desc')
  const serviceNames = useServiceDisplayNames()

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
      // FB-H — the attention feed for the "Attention" card (top pressing items).
      // Non-fatal: a feed hiccup must not blank the whole dashboard.
      callAttorneyMcp<{ items: AttentionItem[] }>({
        toolName: 'legal.attention.feed',
        input: { limit: 6 },
      })
        .then((r) => setAttention(r.items))
        .catch(() => setAttention([])),
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

  const dashMatters = useMemo(() => {
    const rows = (matters ?? []).filter(
      (m) => !dashStatusFilter || matterStatusGroup(m.status).key === dashStatusFilter,
    )
    const dir = dashSortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const ta = parseTimestamp(a.createdAt)?.getTime() ?? 0
      const tb = parseTimestamp(b.createdAt)?.getTime() ?? 0
      return (ta - tb) * dir
    })
  }, [matters, dashStatusFilter, dashSortDir])

  function toggleDashSort() {
    setDashSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  return (
    <main>
      {/* Beta feedback: drop the "Hi, Juan Carlos" greeting and the share-booking
          button from this row. A neutral title keeps the page's h1 for
          structure/a11y; the booking link is still shareable from the "This week"
          row below. */}
      <h1 className="li-dash-title">Home</h1>

      {error && <div className="alert alert-error">{error}</div>}

      {/* FB-H — the ATTENTION card: the attorney's most pressing items, ranked by
          the deterministic attention engine, each a click straight to where to
          act. Rendered above the grid so it's the first thing the attorney sees.
          Hidden entirely when nothing is pressing (an empty feed is good news). */}
      {attention === null && !error && (
        <section className="li-dash-card li-attn-card">
          <h2 className="li-dash-card-title">Attention</h2>
          <div className="loading-block" role="status">
            <span className="spinner" /> Loading…
          </div>
        </section>
      )}
      {attention && attention.length > 0 && (
        <section className="li-dash-card li-attn-card">
          <h2 className="li-dash-card-title">Attention</h2>
          <p className="li-attn-sub">Your most pressing items, most pressing first.</p>
          <div className="li-attn-list">
            {attention.map((it) => {
              const meta = attentionKindMeta(it.kind)
              return (
                <Link
                  key={`${it.kind}:${it.deepLink}:${it.entityId ?? it.rank}`}
                  href={it.deepLink}
                  className="li-attn-row"
                >
                  <span className="li-attn-kind" style={{ background: meta.bg, color: meta.fg }}>
                    <span className="li-attn-dot" style={{ background: meta.fg }} />
                    {meta.label}
                  </span>
                  <span className="li-attn-why">{it.why}</span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <div className="li-dash-grid">
        <section className="li-dash-card">
          <h2 className="li-dash-card-title">Matters</h2>
          <div className="li-dash-mheader">
            <span className="li-dash-mheader-label">Matter</span>
            <button
              type="button"
              className="li-dash-sort"
              onClick={toggleDashSort}
              title="Sort by date"
              aria-label={`Sort matters by date, currently ${dashSortDir === 'desc' ? 'newest first' : 'oldest first'}`}
            >
              Date
              <ChevronDownIcon
                size={12}
                style={{ transform: dashSortDir === 'asc' ? 'rotate(180deg)' : 'none' }}
              />
            </button>
            <span className="li-dash-statusfilter">
              <select
                value={dashStatusFilter}
                onChange={(e) => setDashStatusFilter(e.target.value)}
                aria-label="Filter matters by status"
              >
                <option value="">All statuses</option>
                {STATUS_GROUPS.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon size={12} />
            </span>
          </div>
          {matters === null && !error && (
            <div className="loading-block" role="status">
              <span className="spinner" /> Loading…
            </div>
          )}
          {matters && dashMatters.length === 0 && (
            <p className="li-dash-empty">No matters match this filter.</p>
          )}
          {matters && dashMatters.length > 0 && (
            <div className="li-dash-mbody">
              {dashMatters.map((m) => {
                const group = matterStatusGroup(m.status)
                return (
                  <Link
                    key={m.matterEntityId}
                    href={`/attorney/matters/${m.matterEntityId}`}
                    className="li-dash-mrow"
                  >
                    <span className="li-dash-mclient">
                      <span className="li-dash-dot" style={{ background: group.fg }} />
                      <span className="li-dash-mclient-text">
                        <span className="li-dash-mname">{m.clientName || m.matterNumber}</span>
                        <span className="li-dash-mnum">{m.matterNumber}</span>
                      </span>
                    </span>
                    <span className="li-dash-mdate">{formatDateShort(m.createdAt)}</span>
                    <span
                      className="li-dash-mstatus"
                      style={{ background: group.bg, color: group.fg }}
                    >
                      <span className="li-dash-mstatus-dot" style={{ background: group.fg }} />
                      {group.chipLabel}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        <section className="li-dash-card">
          <h2 className="li-dash-card-title">Recently booked</h2>
          {recent === null && !error && (
            <div className="loading-block" role="status">
              <span className="spinner" /> Loading…
            </div>
          )}
          {recent && recent.length === 0 && <p className="li-dash-empty">No bookings yet.</p>}
          {recent && recent.length > 0 && (
            <div className="li-dash-rbody">
              {recent.map((r) => (
                <Link
                  key={r.matterEntityId}
                  href={`/attorney/matters/${r.matterEntityId}`}
                  className="li-dash-rrow"
                >
                  <span>
                    <span className="li-dash-rclient">{r.clientName || r.matterNumber}</span>
                    <span className="li-dash-rservice">
                      {serviceLabel(r.serviceKey, serviceNames)}
                    </span>
                  </span>
                  <span className="li-dash-rtime">
                    <ClockIcon size={12} />
                    {timeAgo(r.bookedAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="li-dash-week">
        <div className="li-dash-week-head">
          <h2 className="li-dash-card-title li-dash-week-title">This week</h2>
          <ShareBookingButton />
        </div>
        {calendarError && (
          <div className="li-dash-week-pad">
            <div className="alert alert-error">
              <strong>Google connected, but the live calendar read failed.</strong> {calendarError}{' '}
              <span className="text-muted">
                (If you just enabled the Calendar API in Google Cloud, wait a few minutes and
                reload.)
              </span>
            </div>
          </div>
        )}
        {upcoming === null && !error ? (
          <div className="li-dash-week-pad">
            <div className="loading-block" role="status">
              <span className="spinner" /> Loading…
            </div>
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
    </main>
  )
}
