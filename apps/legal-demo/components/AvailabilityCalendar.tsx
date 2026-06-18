'use client'

import { useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon } from '@/components/icons'

export interface CalendarSlot {
  startIso: string
  endIso: string
  label: string
  available: boolean
}

interface Props {
  slots: CalendarSlot[]
  selectedStartIso?: string | null
  onSelect: (slot: CalendarSlot) => void
  lastUpdated?: Date | null
  onRefresh?: () => void
  refreshing?: boolean
  // Called when the user navigates to weeks past the currently loaded
  // horizon. The parent should fetch additional weeks and re-render.
  onLoadMoreWeeks?: () => void
  loadingMoreWeeks?: boolean
  // Whether these slots come from the firm's real connected calendar. When
  // false (the stub fallback), we must NOT show the "Live availability" badge
  // over sample data — that would be a live claim over non-live times.
  live?: boolean
}

interface DayBucket {
  dayStart: Date
  iso: string
  slots: CalendarSlot[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfLocalDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function startOfWeek(d: Date): Date {
  const day = startOfLocalDay(d)
  const dow = day.getDay()
  day.setDate(day.getDate() - dow)
  return day
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
}

function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b)
}

// Weekly calendar view. Slot times are interpreted in the viewer's local
// timezone (so a NY-issued 10am slot shows as 7am for a CA viewer). The
// stepper navigates by week and is bounded to weeks that contain at least
// one available slot.
export function AvailabilityCalendar({
  slots,
  selectedStartIso,
  onSelect,
  lastUpdated,
  onRefresh,
  refreshing,
  onLoadMoreWeeks,
  loadingMoreWeeks,
  live = true,
}: Props) {
  const { t, lang } = useI18n()
  const dateLocale = lang === 'es' ? 'es-US' : undefined
  const localTz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time',
    [],
  )
  const today = useMemo(() => new Date(), [])

  // Group slots by local day.
  const dayMap = useMemo(() => {
    const m = new Map<string, CalendarSlot[]>()
    for (const s of slots) {
      const d = startOfLocalDay(new Date(s.startIso))
      const k = dayKey(d)
      const arr = m.get(k) ?? []
      arr.push(s)
      m.set(k, arr)
    }
    return m
  }, [slots])

  // Earliest & latest week-of-slot to bound the navigation.
  const { firstWeek, lastWeek } = useMemo(() => {
    if (slots.length === 0) {
      const now = startOfWeek(new Date())
      return { firstWeek: now, lastWeek: now }
    }
    let min = new Date(slots[0]!.startIso).getTime()
    let max = min
    for (const s of slots) {
      const t = new Date(s.startIso).getTime()
      if (t < min) min = t
      if (t > max) max = t
    }
    return { firstWeek: startOfWeek(new Date(min)), lastWeek: startOfWeek(new Date(max)) }
  }, [slots])

  const [weekStart, setWeekStart] = useState<Date>(() => {
    if (slots.length === 0) return startOfWeek(new Date())
    return startOfWeek(new Date(slots[0]!.startIso))
  })

  const days: DayBucket[] = useMemo(() => {
    const out: DayBucket[] = []
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(weekStart.getTime() + i * DAY_MS)
      const k = dayKey(d)
      out.push({ dayStart: d, iso: k, slots: dayMap.get(k) ?? [] })
    }
    return out
  }, [weekStart, dayMap])

  const [openDayIso, setOpenDayIso] = useState<string | null>(() => {
    const firstDayWithSlots = days.find((d) => d.slots.length > 0)
    return firstDayWithSlots?.iso ?? null
  })

  const thisWeekStart = useMemo(() => startOfWeek(new Date()), [])
  const canPrev = weekStart.getTime() > Math.max(firstWeek.getTime(), thisWeekStart.getTime())
  // Forward nav is unbounded so clients can book further out; the parent
  // can lazy-load additional weeks via onLoadMoreWeeks.
  const canNext = true
  const isPastLoadedHorizon = weekStart.getTime() > lastWeek.getTime()

  const weekRangeLabel = (() => {
    const end = new Date(weekStart.getTime() + 6 * DAY_MS)
    return `${weekStart.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })}`
  })()

  return (
    <div className="bk-cal">
      <div className="bk-cal-nav">
        <button
          type="button"
          className="bk-cal-arrow"
          disabled={!canPrev}
          onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY_MS))}
          aria-label={t('cal.prev_week')}
        >
          <ChevronLeftIcon size={18} />
        </button>
        <div className="bk-cal-range">{weekRangeLabel}</div>
        <button
          type="button"
          className="bk-cal-arrow"
          disabled={!canNext}
          onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY_MS))}
          aria-label={t('cal.next_week')}
        >
          <ChevronRightIcon size={18} />
        </button>
      </div>

      <div className="bk-cal-meta">
        <div className="bk-cal-tz">{t('cal.local_time', { tz: localTz })}</div>
        <div className={live ? 'bk-cal-live' : 'bk-cal-sample'}>
          {live ? (
            <>
              <span className="bk-cal-live-dot" aria-hidden /> {t('cal.live')}
            </>
          ) : (
            t('cal.sample')
          )}
          {lastUpdated && (
            <span className="bk-cal-updated">
              ·{' '}
              {t('cal.updated', {
                time: lastUpdated.toLocaleTimeString(dateLocale, {
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              })}
            </span>
          )}
          {onRefresh && (
            <button
              type="button"
              className={`bk-cal-refresh ${refreshing ? 'spinning' : ''}`}
              onClick={onRefresh}
              disabled={refreshing}
              aria-label={t('cal.refresh')}
            >
              <RefreshIcon size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Desktop: 7-column grid */}
      <div className="bk-cal-grid">
        {days.map((d) => {
          const isToday = isSameDay(d.dayStart, today)
          return (
            <div key={d.iso} className={`bk-cal-col ${isToday ? 'today' : ''}`}>
              <div className="bk-cal-col-head">
                <div className="bk-cal-dow">
                  {d.dayStart.toLocaleDateString(dateLocale, { weekday: 'short' })}
                </div>
                <div className="bk-cal-date">{d.dayStart.getDate()}</div>
              </div>
              <div className="bk-cal-col-slots">
                {d.slots.length === 0 ? (
                  <div className="bk-cal-empty">—</div>
                ) : (
                  d.slots.map((s) => (
                    <button
                      key={s.startIso}
                      type="button"
                      className={`bk-slot ${selectedStartIso === s.startIso ? 'selected' : ''} ${s.available ? '' : 'taken'}`}
                      onClick={() => s.available && onSelect(s)}
                      disabled={!s.available}
                      aria-label={s.available ? undefined : t('cal.taken')}
                      title={s.available ? undefined : t('cal.taken')}
                    >
                      {new Date(s.startIso).toLocaleTimeString(dateLocale, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </button>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {isPastLoadedHorizon && onLoadMoreWeeks && (
        <div className="bk-cal-more">
          <button
            type="button"
            className="bk-btn bk-btn-soft"
            onClick={onLoadMoreWeeks}
            disabled={loadingMoreWeeks}
          >
            {loadingMoreWeeks ? t('cal.loading') : t('cal.load_more')}
          </button>
        </div>
      )}

      {/* Mobile: accordion */}
      <div className="bk-cal-mobile">
        {days.map((d) => {
          const open = openDayIso === d.iso
          const hasSlots = d.slots.length > 0
          const openCount = d.slots.filter((s) => s.available).length
          const summary = !hasSlots
            ? t('cal.no_times')
            : openCount === 0
              ? t('cal.all_taken')
              : t(openCount === 1 ? 'cal.times_open_one' : 'cal.times_open_many', { n: openCount })
          return (
            <div
              key={d.iso}
              className={`bk-cal-day ${open ? 'open' : ''} ${hasSlots ? '' : 'empty'}`}
            >
              <button
                type="button"
                className="bk-cal-day-head"
                onClick={() => setOpenDayIso(open ? null : d.iso)}
                disabled={!hasSlots}
              >
                <span className="bk-cal-day-label">
                  {d.dayStart.toLocaleDateString(dateLocale, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <span className={`bk-cal-day-count ${hasSlots && openCount > 0 ? 'has' : ''}`}>
                  {summary}
                </span>
              </button>
              {open && hasSlots && (
                <div className="bk-cal-day-slots">
                  {d.slots.map((s) => (
                    <button
                      key={s.startIso}
                      type="button"
                      className={`bk-slot ${selectedStartIso === s.startIso ? 'selected' : ''} ${s.available ? '' : 'taken'}`}
                      onClick={() => s.available && onSelect(s)}
                      disabled={!s.available}
                    >
                      {new Date(s.startIso).toLocaleTimeString(dateLocale, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
