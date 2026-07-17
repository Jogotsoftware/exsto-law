'use client'

// Attorney dashboard calendar. Renders the unified calendar feed — app-booked
// consultations PLUS the attorney's real Google events — in a Week / Day / Month
// view. Consultations are color-coded by category and deep-link to their matter;
// external Google events ride along read-only and open in Google. The parent
// fetches `items` (legal.calendar.feed) and owns the live polling refresh.
// Namespaced `.wcal-*` to avoid colliding with the public AvailabilityCalendar.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, EditIcon } from '@/components/icons'
import { ActionsMenu } from '@/components/ActionsMenu'
import { Modal } from '@/components/Modal'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { launchCompose } from '@/lib/contractD'

export type BookingCategory = 'new_consultation' | 'new_matter' | 'existing_project'

export interface CalendarCategory {
  key: string
  label: string
  color: string
}

export interface CalendarItem {
  id: string
  title: string
  startIso: string
  endIso: string | null
  allDay: boolean
  kind: 'consultation' | 'external'
  matterEntityId: string | null
  serviceKey: string | null
  category: BookingCategory | null
  // Attorney-chosen palette key (consultation_category); colors the block.
  categoryKey: string | null
  htmlLink: string | null
}

type ActiveModal = {
  type: 'reschedule' | 'cancel' | 'categorize' | 'attendees'
  item: CalendarItem
} | null

function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToIso(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

type View = 'week' | 'day' | 'month'

const DAY_MS = 24 * 3600 * 1000

const CATEGORY_LABELS: Record<BookingCategory, string> = {
  new_consultation: 'New consultation',
  new_matter: 'New matter',
  existing_project: 'Existing project',
}
const CATEGORY_ORDER: BookingCategory[] = ['new_consultation', 'new_matter', 'existing_project']

// Muted styling for external (non-app) Google events — inline so it doesn't
// depend on a new global CSS class.
const EXTERNAL_STYLE: React.CSSProperties = {
  background: 'var(--surface-2)',
  color: 'var(--muted)',
  borderLeft: '3px solid #94a3b8',
}

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay()) // Sunday
  return x
}
function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
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
  items: CalendarItem[]
  /** True once the first fetch has completed (so we can show an empty state). */
  loaded: boolean
  /** ISO of the most recent successful refresh, for the "live" indicator. */
  lastRefreshedAt: number | null
  /** The firm's category palette (key→label/color) for color-coding + the picker. */
  categories?: CalendarCategory[]
  /** Called after a successful reschedule/cancel/categorize so the parent refetches. */
  onChanged?: () => void
}

export function WeeklyCalendar({
  items,
  loaded,
  lastRefreshedAt,
  categories = [],
  onChanged,
}: WeeklyCalendarProps) {
  const router = useRouter()
  const [view, setView] = useState<View>('week')
  // The anchor date: which week/day/month is shown. Navigation moves it.
  const [anchor, setAnchor] = useState(() => new Date())
  const [modal, setModal] = useState<ActiveModal>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const palette = useMemo(() => {
    const m = new Map<string, CalendarCategory>()
    for (const c of categories) m.set(c.key, c)
    return m
  }, [categories])

  // Run a calendar write (reschedule/cancel/categorize), then refetch via onChanged.
  async function act(toolName: string, input: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({ toolName, input })
      setModal(null)
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const sorted = useMemo(
    () =>
      items
        .filter((i) => Number.isFinite(new Date(i.startIso).getTime()))
        .slice()
        .sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime()),
    [items],
  )

  function goToMatter(matterEntityId: string) {
    router.push(`/attorney/matters/${matterEntityId}`)
  }

  function itemsOn(day: Date): CalendarItem[] {
    return sorted.filter((i) => sameDay(new Date(i.startIso), day))
  }

  function renderBlock(it: CalendarItem) {
    if (it.kind === 'external') {
      const label = `${it.title} ${it.allDay ? '(all day)' : `at ${timeOnly(it.startIso)}`} — Google event`
      return (
        <a
          key={it.id}
          href={it.htmlLink ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="wcal-block"
          style={EXTERNAL_STYLE}
          title={label}
          aria-label={label}
        >
          <span className="wcal-block-time">{it.allDay ? 'all day' : timeOnly(it.startIso)}</span>
          <span className="wcal-block-client">{it.title}</span>
          <span className="wcal-block-service">Google event</span>
        </a>
      )
    }
    const computed = it.category ?? 'new_consultation'
    const paletteCat = it.categoryKey ? palette.get(it.categoryKey) : undefined
    const label = `${it.title} at ${timeOnly(it.startIso)}${paletteCat ? ` — ${paletteCat.label}` : ''}`
    const colorStyle: React.CSSProperties = paletteCat
      ? {
          background: `${paletteCat.color}1a`,
          borderLeft: `3px solid ${paletteCat.color}`,
          color: '#1e293b',
        }
      : {}
    const menuItems = [
      { label: 'Reschedule', onClick: () => setModal({ type: 'reschedule', item: it }) },
      { label: 'Cancel', onClick: () => setModal({ type: 'cancel', item: it }) },
      {
        label: 'Email client',
        onClick: () => {
          if (it.matterEntityId) launchCompose({ matterId: it.matterEntityId })
        },
      },
      { label: 'Categorize', onClick: () => setModal({ type: 'categorize', item: it }) },
      { label: 'Add guests', onClick: () => setModal({ type: 'attendees', item: it }) },
      {
        label: 'View matter',
        href: it.matterEntityId ? `/attorney/matters/${it.matterEntityId}` : undefined,
      },
    ]
    return (
      <div key={it.id} className="wcal-block-wrap">
        <button
          type="button"
          className={`wcal-block ${paletteCat ? '' : `wcal-${computed}`}`}
          style={colorStyle}
          onClick={() => it.matterEntityId && goToMatter(it.matterEntityId)}
          title={label}
          aria-label={label}
        >
          <span className="wcal-block-time">{timeOnly(it.startIso)}</span>
          <span className="wcal-block-client">{it.title}</span>
          {it.serviceKey && (
            <span className="wcal-block-service">{humanizeService(it.serviceKey)}</span>
          )}
        </button>
        <span className="wcal-block-edit">
          <ActionsMenu
            align="left"
            triggerContent={<EditIcon size={13} />}
            triggerClassName="wcal-edit-btn"
            triggerTitle="Event actions"
            items={menuItems}
          />
        </span>
      </div>
    )
  }

  // ── Range + label per view ────────────────────────────────────────────────
  const step = view === 'week' ? 7 * DAY_MS : view === 'day' ? DAY_MS : 0
  function shift(dir: -1 | 1) {
    if (view === 'month') {
      setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1))
    } else {
      setAnchor((a) => new Date(a.getTime() + dir * step))
    }
  }
  function goToday() {
    setAnchor(new Date())
  }

  const today = new Date()
  const rangeLabel =
    view === 'day'
      ? anchor.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : view === 'month'
        ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : (() => {
            const ws = startOfWeek(anchor)
            const we = new Date(ws.getTime() + 6 * DAY_MS)
            return `${ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString(
              undefined,
              { month: 'short', day: 'numeric', year: 'numeric' },
            )}`
          })()

  // ── Empty-state / "next" helper (any view) ────────────────────────────────
  const nextItem = useMemo(() => {
    const now = Date.now()
    return sorted.find((i) => new Date(i.startIso).getTime() >= now) ?? null
  }, [sorted])

  return (
    <div className="wcal-wrap">
      <div className="wcal-nav">
        <button
          type="button"
          className="wcal-nav-btn"
          aria-label="Previous"
          onClick={() => shift(-1)}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <div className="wcal-week-label">
          <CalendarIcon size={14} /> {rangeLabel}
        </div>
        <div className="wcal-nav-right">
          <div className="wcal-viewswitch" role="tablist" aria-label="Calendar view">
            {(['day', 'week', 'month'] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={`wcal-view-btn${view === v ? ' wcal-view-active' : ''}`}
                style={{
                  fontSize: '0.8rem',
                  padding: '0.2rem 0.55rem',
                  borderRadius: '0.35rem',
                  border: '1px solid var(--border)',
                  background: view === v ? 'var(--accent, #2563eb)' : 'transparent',
                  color: view === v ? '#fff' : 'inherit',
                  textTransform: 'capitalize',
                }}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <button type="button" className="wcal-today-btn" onClick={goToday}>
            Today
          </button>
          <button type="button" className="wcal-nav-btn" aria-label="Next" onClick={() => shift(1)}>
            <ChevronRightIcon size={16} />
          </button>
        </div>
      </div>

      <div className="wcal-meta">
        <span
          className="wcal-live"
          aria-live="polite"
          title="Auto-refreshes so newly-booked meetings appear"
        >
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
          {palette.size > 0
            ? categories.map((c) => (
                <span key={c.key} className="wcal-legend-item">
                  <span className="wcal-swatch" style={{ background: c.color }} /> {c.label}
                </span>
              ))
            : CATEGORY_ORDER.map((c) => (
                <span key={c} className="wcal-legend-item">
                  <span className={`wcal-swatch wcal-${c}`} /> {CATEGORY_LABELS[c]}
                </span>
              ))}
          <span className="wcal-legend-item">
            <span className="wcal-swatch" style={{ background: '#94a3b8' }} /> Google event
          </span>
        </span>
      </div>

      {view === 'week' && (
        <WeekGrid anchor={anchor} itemsOn={itemsOn} renderBlock={renderBlock} today={today} />
      )}
      {view === 'day' && (
        <DayColumn day={startOfDay(anchor)} items={itemsOn(anchor)} renderBlock={renderBlock} />
      )}
      {view === 'month' && (
        <MonthGrid
          anchor={anchor}
          itemsOn={itemsOn}
          today={today}
          onPickDay={(d) => {
            setAnchor(d)
            setView('day')
          }}
        />
      )}

      {loaded && sorted.length === 0 && (
        <div className="wcal-empty">
          Nothing on the calendar yet.
          {nextItem && (
            <>
              {' '}
              Next:{' '}
              <button
                type="button"
                className="wcal-jump"
                onClick={() => {
                  setAnchor(new Date(nextItem.startIso))
                  setView('day')
                }}
              >
                {new Date(nextItem.startIso).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}{' '}
                — jump to it
              </button>
            </>
          )}
        </div>
      )}

      {modal && (
        <CalendarActionModal
          modal={modal}
          categories={categories}
          busy={busy}
          error={error}
          onClose={() => {
            setModal(null)
            setError(null)
          }}
          onSubmit={act}
        />
      )}
    </div>
  )
}

// ── Reschedule / Cancel / Categorize modal (one component, three modes) ───────
function CalendarActionModal({
  modal,
  categories,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  modal: NonNullable<ActiveModal>
  categories: CalendarCategory[]
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (toolName: string, input: Record<string, unknown>) => void
}) {
  const { type, item } = modal
  const [startInput, setStartInput] = useState(() => isoToLocalInput(item.startIso))
  const [endInput, setEndInput] = useState(() => isoToLocalInput(item.endIso))
  const [reason, setReason] = useState('')
  const [categoryKey, setCategoryKey] = useState(item.categoryKey ?? categories[0]?.key ?? '')
  const [attendeesInput, setAttendeesInput] = useState('')

  // External Google events carry no matter, so there's nothing to act on.
  if (!item.matterEntityId) {
    return (
      <Modal title="Read-only event" onClose={onClose}>
        <p style={{ margin: 0 }}>
          This is a Google event and can’t be changed from here. Open it in Google Calendar instead.
        </p>
      </Modal>
    )
  }
  const matterEntityId = item.matterEntityId

  const titles: Record<typeof type, string> = {
    reschedule: 'Reschedule consultation',
    cancel: 'Cancel consultation',
    categorize: 'Categorize consultation',
    attendees: 'Add guests',
  }

  function submit() {
    if (type === 'reschedule') {
      const startIso = localInputToIso(startInput)
      if (!startIso) return
      onSubmit('legal.booking.reschedule', {
        matterEntityId,
        startIso,
        endIso: localInputToIso(endInput),
      })
    } else if (type === 'cancel') {
      onSubmit('legal.booking.cancel', { matterEntityId, reason: reason.trim() || undefined })
    } else if (type === 'categorize') {
      if (!categoryKey) return
      onSubmit('legal.booking.categorize', { matterEntityId, categoryKey })
    } else {
      const emails = attendeesInput.split(/[\s,;]+/).filter((s) => s.includes('@'))
      if (!emails.length) return
      onSubmit('legal.booking.add_attendees', { matterEntityId, attendeeEmails: emails })
    }
  }

  return (
    <Modal
      title={titles[type]}
      onClose={onClose}
      footer={
        <>
          {error && <span className="li-modal-foot-error">{error}</span>}
          <button type="button" className="li-modal-btn-ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            className={type === 'cancel' ? 'li-modal-btn-danger' : 'li-modal-btn-primary'}
            onClick={submit}
            disabled={busy}
          >
            {busy
              ? 'Working…'
              : type === 'cancel'
                ? 'Cancel consultation'
                : type === 'attendees'
                  ? 'Send invites'
                  : 'Save'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{item.title}</p>
      {type === 'reschedule' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <label className="li-modal-field">
            <span>Start</span>
            <input
              type="datetime-local"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
            />
          </label>
          <label className="li-modal-field">
            <span>End</span>
            <input
              type="datetime-local"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
            />
          </label>
        </div>
      )}
      {type === 'cancel' && (
        <label className="li-modal-field">
          <span>Reason (optional, shared with the client)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </label>
      )}
      {type === 'categorize' &&
        (categories.length === 0 ? (
          <p style={{ margin: 0 }}>
            No categories defined yet. Add them in Settings → Calendar categories.
          </p>
        ) : (
          <label className="li-modal-field">
            <span>Category</span>
            <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)}>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      {type === 'attendees' && (
        <label className="li-modal-field">
          <span>Guest emails (comma or space separated) — they’ll get a Google invite</span>
          <textarea
            value={attendeesInput}
            onChange={(e) => setAttendeesInput(e.target.value)}
            rows={3}
            placeholder="alex@example.com, sam@example.com"
          />
        </label>
      )}
    </Modal>
  )
}

// ── Week view (the original 7-col grid) ──────────────────────────────────────
function WeekGrid({
  anchor,
  itemsOn,
  renderBlock,
  today,
}: {
  anchor: Date
  itemsOn: (d: Date) => CalendarItem[]
  renderBlock: (it: CalendarItem) => React.ReactNode
  today: Date
}) {
  const ws = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => new Date(ws.getTime() + i * DAY_MS))
  return (
    <>
      <div className="wcal-week-grid" role="grid" aria-label="Weekly calendar">
        {days.map((day) => {
          const dayItems = itemsOn(day)
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
                {dayItems.length === 0 ? (
                  <span className="wcal-day-empty">—</span>
                ) : (
                  dayItems.map(renderBlock)
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="wcal-mobile-list">
        {days.map((day) => {
          const dayItems = itemsOn(day)
          if (dayItems.length === 0) return null
          return (
            <div key={day.toISOString()} className="wcal-mobile-day">
              <div className="wcal-mobile-day-head">
                {day.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
              <div className="wcal-mobile-day-slots">{dayItems.map(renderBlock)}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Day view (a single day, stacked) ─────────────────────────────────────────
function DayColumn({
  items,
  renderBlock,
}: {
  day: Date
  items: CalendarItem[]
  renderBlock: (it: CalendarItem) => React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '0.6rem',
      }}
    >
      {items.length === 0 ? (
        <span className="wcal-day-empty">No events this day.</span>
      ) : (
        items.map(renderBlock)
      )}
    </div>
  )
}

// ── Month view (6×7 grid; click a day → day view) ────────────────────────────
function MonthGrid({
  anchor,
  itemsOn,
  today,
  onPickDay,
}: {
  anchor: Date
  itemsOn: (d: Date) => CalendarItem[]
  today: Date
  onPickDay: (d: Date) => void
}) {
  const first = startOfMonth(anchor)
  const gridStart = startOfWeek(first)
  const cells = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * DAY_MS))
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          fontSize: '0.72rem',
          color: 'var(--muted)',
          marginBottom: '0.25rem',
        }}
      >
        {dow.map((d) => (
          <div key={d} style={{ textAlign: 'center', padding: '0.2rem 0' }}>
            {d}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '1px',
          background: 'var(--border)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          overflow: 'hidden',
        }}
      >
        {cells.map((day) => {
          const dayItems = itemsOn(day)
          const inMonth = day.getMonth() === anchor.getMonth()
          const isToday = sameDay(day, today)
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onPickDay(day)}
              style={{
                minHeight: '5.5rem',
                background: 'var(--surface)',
                opacity: inMonth ? 1 : 0.45,
                border: 'none',
                borderTop: isToday ? '2px solid var(--accent, #2563eb)' : '2px solid transparent',
                textAlign: 'left',
                padding: '0.25rem 0.3rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.15rem',
                cursor: 'pointer',
              }}
              aria-label={`${day.toLocaleDateString()} — ${dayItems.length} event(s)`}
            >
              <span style={{ fontSize: '0.72rem', fontWeight: isToday ? 700 : 500 }}>
                {day.getDate()}
              </span>
              {dayItems.slice(0, 3).map((it) => (
                <span
                  key={it.id}
                  style={{
                    fontSize: '0.66rem',
                    borderRadius: '0.2rem',
                    padding: '0.05rem 0.25rem',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    ...(it.kind === 'external'
                      ? EXTERNAL_STYLE
                      : { background: '#dbeafe', color: 'var(--navy)' }),
                  }}
                  title={it.title}
                >
                  {it.allDay ? '' : `${timeOnly(it.startIso)} `}
                  {it.title}
                </span>
              ))}
              {dayItems.length > 3 && (
                <span style={{ fontSize: '0.64rem', color: 'var(--muted)' }}>
                  +{dayItems.length - 3} more
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
