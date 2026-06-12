'use client'

// Attorney dashboard weekly calendar. Renders upcoming consultations/meetings in
// a 7-day (Sun–Sat) grid, color-coded by category, each block deep-linking to its
// matter. Pure presentation: the parent fetches `meetings` and owns the live
// polling refresh, passing freshly-fetched data down. Namespaced `.wcal-*` to
// avoid colliding with the client-facing AvailabilityCalendar's `.cal-*` styles.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '@/components/icons'

export type BookingCategory = 'new_consultation' | 'new_matter' | 'existing_project'

export interface CalendarMeeting {
  matterEntityId: string
  matterNumber: string
  clientName: string
  serviceKey: string
  scheduledAt: string
  scheduledEnd: string | null
  status: string
  category: BookingCategory
}

const DAY_MS = 24 * 3600 * 1000

const CATEGORY_LABELS: Record<BookingCategory, string> = {
  new_consultation: 'New consultation',
  new_matter: 'New matter',
  existing_project: 'Existing project',
}

// Order controls the legend; keeps a stable, readable sequence.
const CATEGORY_ORDER: BookingCategory[] = ['new_consultation', 'new_matter', 'existing_project']

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay()) // Sunday
  return x
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function humanizeService(key: string): string {
  if (!key) return ''
  if (key === 'llc_formation' || key === 'business_formation') return 'NC LLC formation'
  if (key === 'oa_amendment') return 'OA amendment'
  if (key === 'other') return 'Custom'
  return key.replace(/_/g, ' ')
}

interface WeeklyCalendarProps {
  meetings: CalendarMeeting[]
  /** True once the first fetch has completed (so we can show an empty state). */
  loaded: boolean
  /** ISO of the most recent successful refresh, for the "live" indicator. */
  lastRefreshedAt: number | null
}

export function WeeklyCalendar({ meetings, loaded, lastRefreshedAt }: WeeklyCalendarProps) {
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))

  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * DAY_MS), [weekStart])
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS)),
    [weekStart],
  )

  // Valid (parseable, future-or-this-week) meetings sorted by time.
  const sorted = useMemo(
    () =>
      meetings
        .filter((m) => Number.isFinite(new Date(m.scheduledAt).getTime()))
        .slice()
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()),
    [meetings],
  )

  const inWeek = useMemo(
    () =>
      sorted.filter((m) => {
        const t = new Date(m.scheduledAt).getTime()
        return t >= weekStart.getTime() && t < weekEnd.getTime()
      }),
    [sorted, weekStart, weekEnd],
  )

  // The next upcoming meeting overall, used to nudge the attorney when the
  // current week is empty but meetings exist further out.
  const nextMeeting = useMemo(() => {
    const now = Date.now()
    return sorted.find((m) => new Date(m.scheduledAt).getTime() >= now) ?? null
  }, [sorted])

  const meetingsByDay = (day: Date) => inWeek.filter((m) => sameDay(new Date(m.scheduledAt), day))

  const today = new Date()
  const isCurrentWeek = sameDay(weekStart, startOfWeek(today))

  const weekLabel = `${weekStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} – ${new Date(weekEnd.getTime() - DAY_MS).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`

  function goToMatter(matterEntityId: string) {
    router.push(`/attorney/matters/${matterEntityId}`)
  }

  function renderBlock(m: CalendarMeeting) {
    const label = `${m.clientName || m.matterNumber} at ${timeOnly(m.scheduledAt)} — ${
      CATEGORY_LABELS[m.category]
    }`
    return (
      <button
        key={`${m.matterEntityId}-${m.scheduledAt}`}
        type="button"
        className={`wcal-block wcal-${m.category}`}
        onClick={() => goToMatter(m.matterEntityId)}
        title={label}
        aria-label={label}
      >
        <span className="wcal-block-time">{timeOnly(m.scheduledAt)}</span>
        <span className="wcal-block-client">{m.clientName || m.matterNumber}</span>
        {m.serviceKey && (
          <span className="wcal-block-service">{humanizeService(m.serviceKey)}</span>
        )}
      </button>
    )
  }

  return (
    <div className="wcal-wrap">
      <div className="wcal-nav">
        <button
          type="button"
          className="wcal-nav-btn"
          aria-label="Previous week"
          onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY_MS))}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <div className="wcal-week-label">
          <CalendarIcon size={14} /> {weekLabel}
          {isCurrentWeek && <span className="wcal-this-week"> · this week</span>}
        </div>
        <div className="wcal-nav-right">
          {!isCurrentWeek && (
            <button
              type="button"
              className="wcal-today-btn"
              onClick={() => setWeekStart(startOfWeek(new Date()))}
            >
              Today
            </button>
          )}
          <button
            type="button"
            className="wcal-nav-btn"
            aria-label="Next week"
            onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY_MS))}
          >
            <ChevronRightIcon size={16} />
          </button>
        </div>
      </div>

      <div className="wcal-meta">
        <span className="wcal-live" title="Auto-refreshes so newly-booked meetings appear">
          <span className="wcal-live-dot" /> Live
          {lastRefreshedAt && (
            <span className="wcal-live-time">
              {' '}
              · updated{' '}
              {new Date(lastRefreshedAt).toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          )}
        </span>
        <span className="wcal-legend">
          {CATEGORY_ORDER.map((c) => (
            <span key={c} className="wcal-legend-item">
              <span className={`wcal-swatch wcal-${c}`} /> {CATEGORY_LABELS[c]}
            </span>
          ))}
        </span>
      </div>

      {loaded && inWeek.length === 0 && (
        <div className="wcal-empty">
          No meetings this week.
          {nextMeeting && (
            <>
              {' '}
              Next meeting:{' '}
              <button
                type="button"
                className="wcal-jump"
                onClick={() => setWeekStart(startOfWeek(new Date(nextMeeting.scheduledAt)))}
              >
                {new Date(nextMeeting.scheduledAt).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}{' '}
                — jump to that week
              </button>
            </>
          )}
        </div>
      )}

      <div className="wcal-week-grid" role="grid" aria-label="Weekly meeting calendar">
        {days.map((day) => {
          const dayMeetings = meetingsByDay(day)
          const isToday = sameDay(day, today)
          return (
            <div
              key={day.toISOString()}
              className={`wcal-day-col${isToday ? ' wcal-today-col' : ''}`}
              role="gridcell"
            >
              <div className="wcal-day-head">
                <div className="wcal-day-dow">
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </div>
                <div className="wcal-day-num">{day.getDate()}</div>
              </div>
              <div className="wcal-day-slots">
                {dayMeetings.length === 0 ? (
                  <span className="wcal-day-empty">—</span>
                ) : (
                  dayMeetings.map(renderBlock)
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Mobile: a stacked per-day list (the 7-col grid is too narrow on phones). */}
      <div className="wcal-mobile-list">
        {days.map((day) => {
          const dayMeetings = meetingsByDay(day)
          if (dayMeetings.length === 0) return null
          return (
            <div key={day.toISOString()} className="wcal-mobile-day">
              <div className="wcal-mobile-day-head">
                {day.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
              <div className="wcal-mobile-day-slots">{dayMeetings.map(renderBlock)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
