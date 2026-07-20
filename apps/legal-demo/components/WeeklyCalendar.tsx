'use client'

// Attorney dashboard calendar. Renders the unified calendar feed — app-booked
// consultations PLUS the attorney's real Google events — in a Week / Day / Month
// view. Consultations are color-coded by category and deep-link to their matter;
// external Google events ride along read-only and open in Google. The parent
// fetches `items` (legal.calendar.feed) and owns the live polling refresh.
// Namespaced `.wcal-*` to avoid colliding with the public AvailabilityCalendar.
//
// LI calendar comp-fidelity: Week/Day are now a real hourly grid (HourGrid,
// below) — side-by-side lanes for overlapping events (Google-Calendar style,
// via the shared lib/calendarOverlapLayout), the comp's Edit event / Duplicate
// / Delete pencil menu on every owned chip (Google-sourced chips get the same
// menu with those three items honestly disabled — "Managed in Google
// Calendar" — plus a working Open-in-Google item), and click-and-drag to move
// an event with a confirm-before-persist modal (old time → new time,
// Confirm/Cancel). This is "a reflection of the main calendar"
// (app/attorney/calendar/page.tsx), which already shipped the equivalent
// interactions for its own hourly grid in WP-H — the two pages don't share
// literal grid code (different data shapes: this feed has no personal/contact
// meetings, only consultation + external), but share the same pure overlap
// algorithm and the same interaction model. Month view and the narrow-screen
// list fallback are unchanged.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, EditIcon } from '@/components/icons'
import { ActionsMenu, type ActionItem } from '@/components/ActionsMenu'
import { Modal } from '@/components/Modal'
import { useConfirm, type ConfirmOptions } from '@/components/ConfirmModal'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { launchCompose } from '@/lib/contractD'
import { layoutOverlappingEvents, overlapResultToPct } from '@/lib/calendarOverlapLayout'
import { serviceLabel, useServiceDisplayNames } from '@/lib/serviceLabel'

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

// One modal at a time: the comp's "Edit event" form (title/date/time/duration/
// category — title read-only, same "don't fake a dead control" call the main
// calendar makes: no rename capability exists), or the pre-existing "Add
// guests" flow (kept, real, not in the comp — superset rule).
type ActiveModal =
  | { type: 'edit'; item: CalendarItem }
  | { type: 'attendees'; item: CalendarItem }
  | null

const GOOGLE_MANAGED_TOOLTIP = 'Managed in Google Calendar'

type View = 'week' | 'day' | 'month'

const DAY_MS = 24 * 3600 * 1000

const CATEGORY_LABELS: Record<BookingCategory, string> = {
  new_consultation: 'New Consultation',
  new_matter: 'New Matter',
  existing_project: 'Existing Project',
}
const CATEGORY_ORDER: BookingCategory[] = ['new_consultation', 'new_matter', 'existing_project']

// Muted styling for external (non-app) Google events — inline so it doesn't
// depend on a new global CSS class. Reused by the mobile list and Month view.
const EXTERNAL_STYLE: React.CSSProperties = {
  background: 'var(--surface-2)',
  color: 'var(--muted)',
  borderLeft: '3px solid #94a3b8',
}
const EXTERNAL_BAR_COLOR = '#94a3b8'

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
function toLocalDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function toLocalTimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
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
  const { confirm, confirmElement } = useConfirm()
  const serviceNames = useServiceDisplayNames()

  const palette = useMemo(() => {
    const m = new Map<string, CalendarCategory>()
    for (const c of categories) m.set(c.key, c)
    return m
  }, [categories])

  // Run a calendar write, then refetch via onChanged. Closes whatever modal is
  // open on success (a no-op when called outside one, e.g. drag/duplicate).
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

  // Duplicate = create a copy via the existing create action, same time
  // (mirrors the main calendar's Duplicate — same underlying capability, no
  // new one). The attorney can then drag the copy to a new slot.
  async function duplicateItem(item: CalendarItem) {
    if (!item.matterEntityId) return
    await act('legal.booking.create_for_matter', {
      matterEntityId: item.matterEntityId,
      startIso: item.startIso,
      endIso: item.endIso ?? item.startIso,
    })
  }

  async function rescheduleItem(item: CalendarItem, startIso: string, endIso: string) {
    if (!item.matterEntityId) return
    await act('legal.booking.reschedule', { matterEntityId: item.matterEntityId, startIso, endIso })
  }

  // Delete = the existing cancel action (comp: red "Delete"), confirmed first.
  async function deleteItem(item: CalendarItem) {
    if (!item.matterEntityId) return
    const ok = await confirm({
      title: 'Delete this event?',
      body: `Cancels the consultation for ${item.title} and removes it from the calendar.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      danger: true,
    })
    if (!ok) return
    await act('legal.booking.cancel', { matterEntityId: item.matterEntityId })
  }

  // Save the unified Edit event modal: reschedules if the time moved and/or
  // re-categorizes if the category changed — both existing actions, run in
  // sequence so the modal stays open (and shows a shared error) until both
  // finish, rather than reusing `act()` twice (which would close the modal
  // after the first call).
  async function saveEdit(
    item: CalendarItem,
    input: { date: string; time: string; durationMin: number; categoryKey: string },
  ) {
    if (!item.matterEntityId || !input.date || !input.time) return
    const start = new Date(`${input.date}T${input.time}`)
    if (Number.isNaN(start.getTime())) return
    const startIso = start.toISOString()
    const endIso = new Date(start.getTime() + input.durationMin * 60_000).toISOString()
    setBusy(true)
    setError(null)
    try {
      if (startIso !== item.startIso || endIso !== (item.endIso ?? '')) {
        await callAttorneyMcp({
          toolName: 'legal.booking.reschedule',
          input: { matterEntityId: item.matterEntityId, startIso, endIso },
        })
      }
      if (input.categoryKey !== (item.categoryKey ?? '')) {
        await callAttorneyMcp({
          toolName: 'legal.booking.categorize',
          input: { matterEntityId: item.matterEntityId, categoryKey: input.categoryKey },
        })
      }
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

  // Non-positioned block — used ONLY by the narrow-screen mobile list (the
  // hourly grid below handles week/day at normal widths). Same actions as the
  // grid's pencil menu, just stacked instead of absolutely positioned.
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
    const menuItems: ActionItem[] = [
      { label: 'Edit Event', onClick: () => setModal({ type: 'edit', item: it }) },
      { label: 'Duplicate', onClick: () => duplicateItem(it) },
      {
        label: 'Email Client',
        onClick: () => {
          if (it.matterEntityId) launchCompose({ matterId: it.matterEntityId })
        },
      },
      { label: 'Add Guests', onClick: () => setModal({ type: 'attendees', item: it }) },
      {
        label: 'View Matter',
        href: it.matterEntityId ? `/attorney/matters/${it.matterEntityId}` : undefined,
      },
      { label: 'Delete', danger: true, onClick: () => deleteItem(it) },
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
            <span className="wcal-block-service">{serviceLabel(it.serviceKey, serviceNames)}</span>
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

  const weekDays = useMemo(() => {
    const ws = startOfWeek(anchor)
    return Array.from({ length: 7 }, (_, i) => new Date(ws.getTime() + i * DAY_MS))
  }, [anchor])

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
            <span className="wcal-swatch" style={{ background: EXTERNAL_BAR_COLOR }} /> Google event
          </span>
        </span>
      </div>

      {error && <div className="alert alert-error wcal-error">{error}</div>}

      {view === 'week' && (
        <>
          <div className="wcal-hg-desktop">
            <HourGrid
              days={weekDays}
              itemsOn={itemsOn}
              today={today}
              palette={palette}
              onEdit={(it) => setModal({ type: 'edit', item: it })}
              onAttendees={(it) => setModal({ type: 'attendees', item: it })}
              onDuplicate={duplicateItem}
              onDelete={deleteItem}
              onReschedule={rescheduleItem}
              goToMatter={goToMatter}
              confirm={confirm}
            />
          </div>
          <div className="wcal-mobile-list">
            {weekDays.map((day) => {
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
      )}
      {view === 'day' && (
        <HourGrid
          days={[startOfDay(anchor)]}
          itemsOn={itemsOn}
          today={today}
          palette={palette}
          onEdit={(it) => setModal({ type: 'edit', item: it })}
          onAttendees={(it) => setModal({ type: 'attendees', item: it })}
          onDuplicate={duplicateItem}
          onDelete={deleteItem}
          onReschedule={rescheduleItem}
          goToMatter={goToMatter}
          confirm={confirm}
        />
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

      {modal?.type === 'edit' && (
        <CalendarEditModal
          item={modal.item}
          categories={categories}
          busy={busy}
          error={error}
          onClose={() => {
            setModal(null)
            setError(null)
          }}
          onSave={(input) => saveEdit(modal.item, input)}
          onDelete={() => deleteItem(modal.item)}
        />
      )}
      {modal?.type === 'attendees' && (
        <AttendeesModal
          item={modal.item}
          busy={busy}
          error={error}
          onClose={() => {
            setModal(null)
            setError(null)
          }}
          onSubmit={(emails) =>
            act('legal.booking.add_attendees', {
              matterEntityId: modal.item.matterEntityId,
              attendeeEmails: emails,
            })
          }
        />
      )}
      {confirmElement}
    </div>
  )
}

// ── Add-guests modal (pre-existing capability, kept — not in the comp) ─────
function AttendeesModal({
  item,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  item: CalendarItem
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (emails: string[]) => void
}) {
  const [attendeesInput, setAttendeesInput] = useState('')
  return (
    <Modal
      title="Add Guests"
      onClose={onClose}
      footer={
        <>
          {error && <span className="li-modal-foot-error">{error}</span>}
          <button type="button" className="li-modal-btn-ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            className="li-modal-btn-primary"
            disabled={busy}
            onClick={() => {
              const emails = attendeesInput.split(/[\s,;]+/).filter((s) => s.includes('@'))
              if (emails.length) onSubmit(emails)
            }}
          >
            {busy ? 'Working…' : 'Send invites'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{item.title}</p>
      <label className="li-modal-field">
        <span>Guest emails (comma or space separated) — they’ll get a Google invite</span>
        <textarea
          value={attendeesInput}
          onChange={(e) => setAttendeesInput(e.target.value)}
          rows={3}
          placeholder="alex@example.com, sam@example.com"
        />
      </label>
    </Modal>
  )
}

// ── Edit event modal (comp: CALENDAR EVENT MODAL) ───────────────────────────
const PRESET_DURATIONS_MIN = [15, 30, 45, 60, 90, 120]
function formatDurationLabel(min: number): string {
  if (min < 60) return `${min} min`
  const hrs = min / 60
  return Number.isInteger(hrs) ? `${hrs} hr` : `${hrs.toFixed(1)} hr`
}
const MIN_DUR_MIN = 15

function CalendarEditModal({
  item,
  categories,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  item: CalendarItem
  categories: CalendarCategory[]
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (input: { date: string; time: string; durationMin: number; categoryKey: string }) => void
  onDelete: () => void
}) {
  const start = new Date(item.startIso)
  const end = item.endIso ? new Date(item.endIso) : null
  const initialDuration = end
    ? Math.max(MIN_DUR_MIN, Math.round((end.getTime() - start.getTime()) / 60_000))
    : 30
  const [date, setDate] = useState(() => toLocalDateStr(start))
  const [time, setTime] = useState(() => toLocalTimeStr(start))
  const [durationMin, setDurationMin] = useState(initialDuration)
  const [categoryKey, setCategoryKey] = useState(item.categoryKey ?? '')

  const durationOptions = PRESET_DURATIONS_MIN.includes(initialDuration)
    ? PRESET_DURATIONS_MIN
    : [...PRESET_DURATIONS_MIN, initialDuration].sort((a, b) => a - b)

  return (
    <Modal
      title="Event Details"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="li-modal-btn-danger-text"
            onClick={onDelete}
            disabled={busy}
          >
            Delete
          </button>
          <span className="li-modal-foot-spacer" />
          {error && <span className="li-modal-foot-error">{error}</span>}
          <button type="button" className="li-modal-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="li-modal-btn-primary"
            disabled={busy || !date || !time}
            onClick={() => onSave({ date, time, durationMin, categoryKey })}
          >
            {busy ? 'Saving…' : 'Save event'}
          </button>
        </>
      }
    >
      <label className="li-modal-field">
        <span>Title</span>
        <input type="text" value={item.title} readOnly disabled className="li-cal-field-readonly" />
      </label>
      <div className="li-modal-field-row">
        <label className="li-modal-field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="li-modal-field">
          <span>Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <label className="li-modal-field">
        <span>Duration</span>
        <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
          {durationOptions.map((m) => (
            <option key={m} value={m}>
              {formatDurationLabel(m)}
            </option>
          ))}
        </select>
      </label>
      {categories.length > 0 && (
        <div className="li-modal-field">
          <span>Category</span>
          <div className="li-cal-chip-row">
            {categories.map((c) => {
              const active = categoryKey === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  className={active ? 'li-cal-chip is-active' : 'li-cal-chip'}
                  style={
                    active
                      ? { background: `${c.color}1a`, color: c.color, borderColor: c.color }
                      : { color: c.color }
                  }
                  onClick={() => setCategoryKey(active ? '' : c.key)}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Hourly grid (week/day): positioned events, side-by-side overlap lanes,
// drag-to-move with a confirm-before-persist modal, and the comp's pencil
// menu. Namespaced `.wcal-hg-*`. Only 'consultation' items are owned/editable;
// 'external' (Google) items get the same menu with Edit/Duplicate/Delete
// honestly disabled (tooltip: "Managed in Google Calendar") plus a working
// "Open in Google" item — no fake controls, matches the founder's ask.
const HOUR_PX = 34
const SNAP_MIN = 15
const snapMin = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN
const clampTopPx = (px: number) => Math.max(0, Math.min(px, 24 * HOUR_PX))
const pxToMin = (px: number) => (px / HOUR_PX) * 60
function dayAtMinutes(day: Date, minutes: number): Date {
  const d = startOfDay(day)
  d.setMinutes(Math.max(0, Math.min(24 * 60, minutes)))
  return d
}
function formatHourLabel(h: number): string {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}
function fmtClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
function fmtRangeLabel(start: Date, end: Date | null): string {
  const day = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${day}, ${fmtClock(start)}${end ? ` – ${fmtClock(end)}` : ''}`
}

type MoveDrag = { item: CalendarItem; day: Date; top: number; grabDy: number; moved: boolean }

function HourGrid({
  days,
  itemsOn,
  today,
  palette,
  onEdit,
  onAttendees,
  onDuplicate,
  onDelete,
  onReschedule,
  goToMatter,
  confirm,
}: {
  days: Date[]
  itemsOn: (d: Date) => CalendarItem[]
  today: Date
  palette: Map<string, CalendarCategory>
  onEdit: (item: CalendarItem) => void
  onAttendees: (item: CalendarItem) => void
  onDuplicate: (item: CalendarItem) => void
  onDelete: (item: CalendarItem) => void
  onReschedule: (item: CalendarItem, startIso: string, endIso: string) => void
  goToMatter: (matterEntityId: string) => void
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}) {
  const [drag, setDrag] = useState<MoveDrag | null>(null)
  const dragRef = useRef<MoveDrag | null>(null)
  const dragColRef = useRef<HTMLElement | null>(null)
  const movedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Open the scroll near the workday, same convention as the main calendar.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7.5 * HOUR_PX
  }, [])

  function beginMoveDrag(ev: React.MouseEvent, item: CalendarItem, day: Date, top: number) {
    if (item.kind !== 'consultation') return
    ev.stopPropagation()
    ev.preventDefault()
    const col = (ev.currentTarget as HTMLElement).closest('.wcal-hg-col') as HTMLElement | null
    if (!col) return
    const relY = clampTopPx(ev.clientY - col.getBoundingClientRect().top)
    dragColRef.current = col
    movedRef.current = false
    const ds: MoveDrag = { item, day, top, grabDy: relY - top, moved: false }
    dragRef.current = ds
    setDrag(ds)
  }

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    function onMove(ev: MouseEvent) {
      const d = dragRef.current
      const col = dragColRef.current
      if (!d || !col) return
      const relY = clampTopPx(ev.clientY - col.getBoundingClientRect().top)
      const next: MoveDrag = { ...d, top: clampTopPx(relY - d.grabDy), moved: true }
      movedRef.current = true
      dragRef.current = next
      setDrag(next)
    }
    async function onUp() {
      const d = dragRef.current
      dragRef.current = null
      dragColRef.current = null
      setDrag(null)
      if (!d || !d.moved) return
      const startMin = snapMin(pxToMin(d.top))
      const oldStart = new Date(d.item.startIso)
      const oldEnd = d.item.endIso ? new Date(d.item.endIso) : null
      const durMin = oldEnd
        ? Math.max(MIN_DUR_MIN, (oldEnd.getTime() - oldStart.getTime()) / 60_000)
        : 30
      const newStart = dayAtMinutes(d.day, startMin)
      const newEnd = dayAtMinutes(d.day, startMin + durMin)
      const ok = await confirm({
        title: 'Move this event?',
        body: (
          <>
            <strong>{d.item.title}</strong>
            <div className="li-cal-confirm-range">
              <span>{fmtRangeLabel(oldStart, oldEnd)}</span>
              <span aria-hidden="true"> → </span>
              <span>{fmtRangeLabel(newStart, newEnd)}</span>
            </div>
          </>
        ),
        confirmLabel: 'Move Event',
        cancelLabel: 'Cancel',
      })
      if (ok) onReschedule(d.item, newStart.toISOString(), newEnd.toISOString())
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  function menuItemsFor(item: CalendarItem): ActionItem[] {
    if (item.kind === 'external') {
      return [
        { label: 'Edit Event', disabled: true, title: GOOGLE_MANAGED_TOOLTIP },
        { label: 'Duplicate', disabled: true, title: GOOGLE_MANAGED_TOOLTIP },
        {
          label: 'Open In Google',
          onClick: () => {
            if (item.htmlLink) window.open(item.htmlLink, '_blank', 'noopener,noreferrer')
          },
        },
        { label: 'Delete', danger: true, disabled: true, title: GOOGLE_MANAGED_TOOLTIP },
      ]
    }
    return [
      { label: 'Edit Event', onClick: () => onEdit(item) },
      { label: 'Duplicate', onClick: () => onDuplicate(item) },
      {
        label: 'Email Client',
        onClick: () => {
          if (item.matterEntityId) launchCompose({ matterId: item.matterEntityId })
        },
      },
      { label: 'Add Guests', onClick: () => onAttendees(item) },
      {
        label: 'View Matter',
        href: item.matterEntityId ? `/attorney/matters/${item.matterEntityId}` : undefined,
      },
      { label: 'Delete', danger: true, onClick: () => onDelete(item) },
    ]
  }

  function renderHourEvent(
    it: CalendarItem,
    day: Date,
    top: number,
    height: number,
    leftPct: number,
    widthPct: number,
    isThis: boolean,
  ) {
    const owned = it.kind === 'consultation'
    const paletteCat = it.categoryKey ? palette.get(it.categoryKey) : undefined
    const barColor = paletteCat ? paletteCat.color : owned ? 'var(--li-navy)' : EXTERNAL_BAR_COLOR
    const cls = `wcal-hg-event${owned ? ' is-owned' : ''}${isThis ? ' is-dragging' : ''}`
    const style: React.CSSProperties = {
      top,
      height,
      left: `calc(${leftPct}% + 2px)`,
      width: `calc(${widthPct}% - 4px)`,
      zIndex: isThis ? 50 : 2,
      borderLeftColor: barColor,
      background: paletteCat
        ? `${paletteCat.color}1a`
        : owned
          ? 'var(--li-info-bg)'
          : 'var(--li-border-soft)',
      cursor: owned ? (isThis ? 'grabbing' : 'grab') : 'pointer',
    }
    const label = `${it.title} at ${fmtClock(new Date(it.startIso))}${paletteCat ? ` — ${paletteCat.label}` : owned ? '' : ' — Google event'}`
    const inner = (
      <>
        <span className="wcal-hg-event-time">{fmtClock(new Date(it.startIso))}</span>
        <span className="wcal-hg-event-title">{it.title || '(no title)'}</span>
        {/* Stop mousedown AND click here. Mousedown: the chip's own
            onMouseDown starts a drag, and without this the pencil's
            mousedown bubbles up to it first, hijacking the click before
            ActionsMenu ever opens (mirrors the main calendar's pencil, which
            stops propagation the same way). Click: ActionsMenu's menu is
            rendered via createPortal into document.body, but React bubbles
            synthetic events through the COMPONENT tree, not the DOM tree —
            this span is still a React ancestor of the portaled menu, so
            without stopping it here a menu-item click (Edit event/Duplicate/
            Delete/…) continues bubbling to the chip's own onClick and fires
            goToMatter (found live: clicking "Edit event" navigated to the
            matter instead of opening the modal). Positioning lives on THIS
            wrapper, not the trigger button: ActionsMenu's own
            `.att-pop-anchor` is `display:flex` sized to its child, and an
            absolutely-positioned child contributes no size — putting
            position:absolute directly on the button collapses the anchor to
            0×0 and the button's hit-area ends up in the wrong place (found
            live: elementFromPoint at the visible pencil hit an hour gridline
            instead of the button). */}
        <span
          className="wcal-hg-event-edit-wrap"
          onMouseDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => ev.stopPropagation()}
        >
          <ActionsMenu
            align="left"
            triggerContent={<EditIcon size={11} />}
            triggerClassName="wcal-hg-event-edit"
            triggerTitle="Event actions"
            items={menuItemsFor(it)}
          />
        </span>
      </>
    )
    if (owned) {
      return (
        <div
          key={it.id}
          className={cls}
          style={style}
          title={`${label} · drag to reschedule`}
          onMouseDown={(ev) => beginMoveDrag(ev, it, day, top)}
          onClick={() => {
            if (movedRef.current) {
              movedRef.current = false
              return
            }
            if (it.matterEntityId) goToMatter(it.matterEntityId)
          }}
        >
          {inner}
        </div>
      )
    }
    return (
      <a
        key={it.id}
        href={it.htmlLink ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        style={style}
        title={label}
      >
        {inner}
      </a>
    )
  }

  const hours = Array.from({ length: 24 }, (_, h) => h)
  const cols = `40px repeat(${days.length}, minmax(88px, 1fr))`
  const now = new Date()
  const anyAllDay = days.some((d) => itemsOn(d).some((it) => it.allDay))

  return (
    <div className="wcal-hg-card">
      <div className="wcal-hg-daysrow" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((day) => {
          const isToday = sameDay(day, today)
          return (
            <div key={day.toISOString()} className="wcal-hg-daycell">
              <div className="wcal-hg-daycell-dow">
                {days.length === 1
                  ? day.toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    })
                  : day.toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
              {days.length > 1 && (
                <div className={isToday ? 'wcal-hg-daycell-num is-today' : 'wcal-hg-daycell-num'}>
                  {day.getDate()}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {anyAllDay && (
        <div className="wcal-hg-allday" style={{ gridTemplateColumns: cols }}>
          <div className="wcal-hg-allday-label">all-day</div>
          {days.map((day) => (
            <div key={day.toISOString()} className="wcal-hg-allday-col">
              {itemsOn(day)
                .filter((it) => it.allDay)
                .map((it) =>
                  it.matterEntityId ? (
                    <button
                      key={it.id}
                      type="button"
                      className="wcal-hg-allday-chip"
                      title={it.title}
                      onClick={() => goToMatter(it.matterEntityId!)}
                    >
                      {it.title}
                    </button>
                  ) : (
                    <a
                      key={it.id}
                      href={it.htmlLink ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="wcal-hg-allday-chip is-external"
                      title={it.title}
                    >
                      {it.title}
                    </a>
                  ),
                )}
            </div>
          ))}
        </div>
      )}

      <div className="wcal-hg-scroll" ref={scrollRef}>
        <div
          className={`wcal-hg-body${dragging ? ' is-dragging' : ''}`}
          style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}
        >
          <div className="wcal-hg-axis">
            {hours.map((h) => (
              <div key={h} className="wcal-hg-hour" style={{ height: HOUR_PX }}>
                <span>{formatHourLabel(h)}</span>
              </div>
            ))}
          </div>
          {days.map((day) => {
            const isToday = sameDay(day, today)
            const nowTop = isToday
              ? ((now.getTime() - startOfDay(now).getTime()) / 3600_000) * HOUR_PX
              : null
            const day0 = startOfDay(day).getTime()
            const timed = itemsOn(day)
              .filter((it) => !it.allDay)
              .map((it) => {
                const s = new Date(it.startIso).getTime()
                const en = it.endIso ? new Date(it.endIso).getTime() : s + 30 * 60_000
                const startMin = (s - day0) / 60_000
                const endMin = Math.max((en - day0) / 60_000, startMin + 10)
                return { it, startMin, endMin }
              })
            const layout = layoutOverlappingEvents(
              timed.map((t) => ({ id: t.it.id, startMin: t.startMin, endMin: t.endMin })),
            )
            const layoutById = new Map(layout.map((l) => [l.id, l]))
            return (
              <div key={day.toISOString()} className="wcal-hg-col">
                {hours.map((h) => (
                  <div key={h} className="wcal-hg-hline" style={{ height: HOUR_PX }} />
                ))}
                {nowTop !== null && <div className="wcal-hg-now" style={{ top: nowTop }} />}
                {timed.map(({ it, startMin, endMin }) => {
                  const { leftPct, widthPct } = overlapResultToPct(layoutById.get(it.id)!)
                  const isThis = drag?.item.id === it.id
                  const top = isThis ? drag.top : Math.max(0, (startMin / 60) * HOUR_PX)
                  const height = Math.max(18, ((endMin - startMin) / 60) * HOUR_PX)
                  return renderHourEvent(it, day, top, height, leftPct, widthPct, isThis)
                })}
              </div>
            )
          })}
        </div>
      </div>
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
