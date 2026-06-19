'use client'

// Calendar tab (WP7, REQ-CALMAIL-01): the attorney's real calendar in day / week
// / month / list views, with in-app create/reschedule/cancel that write through
// the action layer and round-trip to Google. Matter-linked events deep-link to
// their matters; events created directly in Google appear here (live read) as
// read-only. The fetch window follows the active view, so month pulls the whole
// month grid, day pulls a single day, etc.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'

interface WorkspaceEvent {
  eventId: string
  summary: string
  startIso: string | null
  endIso: string | null
  allDay: boolean
  htmlLink: string | null
  attendeeEmails: string[]
  status: string
  matterEntityId: string | null
  matterNumber: string | null
  managedByApp: boolean
}

interface MatterOption {
  matterEntityId: string
  matterNumber: string
  clientName: string
}

type View = 'day' | 'week' | 'month' | 'list'

const DAY_MS = 24 * 3600 * 1000

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Monday
  return x
}
function startOfMonth(d: Date): Date {
  const x = startOfDay(d)
  x.setDate(1)
  return x
}
function addMonths(d: Date, n: number): Date {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

// The visible window for a view: what to fetch, which day cells to draw, and the
// header label. day → one day; week/list → Mon–Sun; month → a 6-week grid that
// always covers the month regardless of which weekday it starts on.
function periodFor(
  anchor: Date,
  view: View,
): { start: Date; end: Date; days: Date[]; label: string } {
  if (view === 'day') {
    const start = startOfDay(anchor)
    return {
      start,
      end: new Date(start.getTime() + DAY_MS),
      days: [start],
      label: start.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
    }
  }
  if (view === 'month') {
    const monthStart = startOfMonth(anchor)
    const gridStart = startOfWeek(monthStart)
    const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * DAY_MS))
    return {
      start: gridStart,
      end: new Date(gridStart.getTime() + 42 * DAY_MS),
      days,
      label: monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    }
  }
  const start = startOfWeek(anchor)
  const end = new Date(start.getTime() + 7 * DAY_MS)
  return {
    start,
    end,
    days: Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS)),
    label: `${start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} – ${new Date(
      end.getTime() - DAY_MS,
    ).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`,
  }
}

export default function CalendarPage() {
  const [anchor, setAnchor] = useState(() => new Date())
  const [view, setView] = useState<View>('week')
  const [events, setEvents] = useState<WorkspaceEvent[]>([])
  const [source, setSource] = useState<'google' | 'disconnected' | 'error' | null>(null)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [matters, setMatters] = useState<MatterOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Inline panel state for create/reschedule.
  const [panel, setPanel] = useState<{
    kind: 'create' | 'reschedule'
    matterEntityId?: string
    start: string
    end: string
  } | null>(null)
  // Which unlinked Google event is mid-assignment, and the chosen matter.
  const [assignFor, setAssignFor] = useState<{ eventId: string; matterEntityId: string } | null>(
    null,
  )

  const period = useMemo(() => periodFor(anchor, view), [anchor, view])
  const fromIso = period.start.toISOString()
  const toIso = period.end.toISOString()

  async function load() {
    setError(null)
    try {
      const res = await callAttorneyMcp<{
        events: WorkspaceEvent[]
        source: 'google' | 'disconnected' | 'error'
        error?: string
      }>({
        toolName: 'legal.calendar.events',
        input: { fromIso, toIso },
      })
      setEvents(res.events)
      setSource(res.source)
      setGoogleError(res.error ?? null)
      const m = await callAttorneyMcp<{ matters: MatterOption[] }>({
        toolName: 'legal.matter.list',
        input: {},
      })
      setMatters(m.matters)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // Refetch whenever the visible window changes (navigation OR a view switch that
  // changes the range). week↔list share a window, so toggling between them is a
  // pure re-render with no extra fetch.
  useEffect(() => {
    load()
  }, [fromIso, toIso])

  // Contract D — launchScheduler: open the event creator pre-wired from query
  // params (?create=1&matterId=…). Runs once matters are loaded so the matter
  // can be preselected.
  useEffect(() => {
    if (typeof window === 'undefined' || matters.length === 0) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('create') !== '1') return
    const matterId = params.get('matterId') ?? undefined
    setPanel((prev) =>
      prev
        ? prev
        : {
            kind: 'create',
            matterEntityId:
              (matterId && matters.find((m) => m.matterEntityId === matterId)?.matterEntityId) ||
              matters[0]?.matterEntityId,
            start: '',
            end: '',
          },
    )
  }, [matters])

  async function run(toolName: string, input: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({ toolName, input })
      setPanel(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // WP3.2 — assign an unlinked Google event to a matter (legal.meeting.assign).
  // Passes the event fields the capture needs; app-booked consultations are
  // skipped server-side. After assign it reloads and the event shows its matter.
  async function assignToMatter(e: WorkspaceEvent, matterEntityId: string) {
    setAssignFor(null)
    await run('legal.meeting.assign', {
      googleEventId: e.eventId,
      matterEntityId,
      summary: e.summary,
      startedAt: e.startIso,
      endedAt: e.endIso,
      allDay: e.allDay,
      attendeeEmails: e.attendeeEmails,
      htmlLink: e.htmlLink,
      eventStatus: e.status,
    })
  }

  // Navigate by the active unit: day → ±1 day, week/list → ±1 week, month → ±1 month.
  function shift(n: number) {
    setAnchor((a) =>
      view === 'day'
        ? new Date(a.getTime() + n * DAY_MS)
        : view === 'month'
          ? addMonths(a, n)
          : new Date(a.getTime() + n * 7 * DAY_MS),
    )
  }

  const eventsByDay = (day: Date) =>
    events
      .filter((e) => e.startIso && new Date(e.startIso).toDateString() === day.toDateString())
      .sort((a, b) => (a.startIso! < b.startIso! ? -1 : 1))

  // Full event card — used by day and week views (month uses a compact chip).
  // Matter-linked events are color-coded (gold left border) to stand out from the
  // attorney's other Google events (muted border).
  function renderEvent(e: WorkspaceEvent) {
    return (
      <div
        key={e.eventId}
        style={{
          border: '1px solid var(--border)',
          borderLeft: e.managedByApp
            ? '3px solid var(--primary, #1e3a5f)'
            : '3px solid var(--border)',
          borderRadius: 6,
          padding: 'var(--space-2)',
          fontSize: '0.85rem',
        }}
      >
        <div style={{ fontWeight: 600 }}>
          {e.allDay
            ? 'All day'
            : new Date(e.startIso!).toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })}
        </div>
        <div>{e.summary}</div>
        {e.matterEntityId ? (
          <div style={{ marginTop: 4 }}>
            <Link href={`/attorney/matters/${e.matterEntityId}`}>{e.matterNumber} →</Link>
            <div className="row" style={{ gap: 'var(--space-1)', marginTop: 4 }}>
              <button
                style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}
                onClick={() =>
                  setPanel({
                    kind: 'reschedule',
                    matterEntityId: e.matterEntityId!,
                    start: '',
                    end: '',
                  })
                }
              >
                Reschedule
              </button>
              <button
                style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Cancel the consultation for ${e.matterNumber}?`)) {
                    run('legal.booking.cancel', { matterEntityId: e.matterEntityId })
                  }
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="text-muted text-sm" style={{ marginTop: 4 }}>
            <div>
              Google event{' '}
              {e.htmlLink && (
                <a href={e.htmlLink} target="_blank" rel="noreferrer">
                  open ↗
                </a>
              )}
            </div>
            {!e.managedByApp &&
              matters.length > 0 &&
              (assignFor?.eventId === e.eventId ? (
                <div
                  className="row"
                  style={{ gap: 'var(--space-1)', marginTop: 4, flexWrap: 'wrap' }}
                >
                  <select
                    value={assignFor.matterEntityId}
                    style={{ fontSize: '0.75rem' }}
                    onChange={(ev) =>
                      setAssignFor({ eventId: e.eventId, matterEntityId: ev.target.value })
                    }
                  >
                    {matters.map((m) => (
                      <option key={m.matterEntityId} value={m.matterEntityId}>
                        {m.matterNumber}
                      </option>
                    ))}
                  </select>
                  <button
                    style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}
                    disabled={busy || !assignFor.matterEntityId}
                    onClick={() => assignToMatter(e, assignFor.matterEntityId)}
                  >
                    Assign
                  </button>
                  <button
                    style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}
                    onClick={() => setAssignFor(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', marginTop: 4 }}
                  onClick={() =>
                    setAssignFor({ eventId: e.eventId, matterEntityId: matters[0].matterEntityId })
                  }
                >
                  Assign to matter
                </button>
              ))}
          </div>
        )}
      </div>
    )
  }

  // Column of events for one day, used by day and week views.
  function dayColumn(day: Date, opts: { headerWeekday?: boolean } = {}) {
    const isToday = day.toDateString() === new Date().toDateString()
    return (
      <div key={day.toISOString()}>
        <div
          className="kv-label"
          style={{
            padding: 'var(--space-2)',
            borderBottom: '2px solid var(--border)',
            fontWeight: isToday ? 700 : 500,
          }}
        >
          {opts.headerWeekday
            ? day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
            : day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {isToday ? ' · today' : ''}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) 0',
          }}
        >
          {eventsByDay(day).length === 0 && (
            <span className="text-muted text-sm" style={{ padding: 'var(--space-2)' }}>
              —
            </span>
          )}
          {eventsByDay(day).map((e) => renderEvent(e))}
        </div>
      </div>
    )
  }

  const sortedEvents = useMemo(
    () =>
      [...events].filter((e) => e.startIso).sort((a, b) => (a.startIso! < b.startIso! ? -1 : 1)),
    [events],
  )

  return (
    <main>
      <PageHead
        title="Calendar"
        description="Your real calendar — changes here sync to Google and are recorded as actions."
      />
      {source === 'disconnected' && (
        <div className="alert alert-error">
          <strong>Google Calendar is not connected.</strong> The calendar cannot load.{' '}
          <Link href="/attorney/settings">Connect Google in Settings →</Link>
        </div>
      )}
      {source === 'error' && (
        <div className="alert alert-error">
          <strong>Google connected, but the calendar read failed.</strong>{' '}
          {googleError ??
            'The Google Calendar API call errored. If you just enabled the Calendar API in Google Cloud, wait a few minutes and reload.'}
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      <section>
        <div
          className="row"
          style={{ gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <button onClick={() => shift(-1)}>← Previous</button>
          <button onClick={() => setAnchor(new Date())}>Today</button>
          <button onClick={() => shift(1)}>Next →</button>
          <strong style={{ marginLeft: 'var(--space-3)' }}>{period.label}</strong>
          <div className="row" style={{ gap: 0, marginLeft: 'var(--space-3)' }}>
            {(['day', 'week', 'month', 'list'] as const).map((v) => (
              <button key={v} className={view === v ? 'primary' : ''} onClick={() => setView(v)}>
                {v[0]!.toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <button
            className="primary"
            style={{ marginLeft: 'auto' }}
            disabled={source !== 'google' || matters.length === 0}
            onClick={() =>
              setPanel({
                kind: 'create',
                matterEntityId: matters[0]?.matterEntityId,
                start: '',
                end: '',
              })
            }
          >
            New consultation
          </button>
        </div>
      </section>

      {panel && (
        <section>
          <h3>{panel.kind === 'create' ? 'Book a consultation' : 'Reschedule consultation'}</h3>
          <div
            className="row"
            style={{ gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'end' }}
          >
            {panel.kind === 'create' && (
              <label>
                Matter
                <br />
                <select
                  value={panel.matterEntityId}
                  onChange={(e) => setPanel({ ...panel, matterEntityId: e.target.value })}
                >
                  {matters.map((m) => (
                    <option key={m.matterEntityId} value={m.matterEntityId}>
                      {m.matterNumber} — {m.clientName || 'client'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Start
              <br />
              <input
                type="datetime-local"
                value={panel.start}
                onChange={(e) => setPanel({ ...panel, start: e.target.value })}
              />
            </label>
            <label>
              End
              <br />
              <input
                type="datetime-local"
                value={panel.end}
                onChange={(e) => setPanel({ ...panel, end: e.target.value })}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !panel.start || !panel.end}
              onClick={() =>
                run(
                  panel.kind === 'create'
                    ? 'legal.booking.create_for_matter'
                    : 'legal.booking.reschedule',
                  {
                    matterEntityId: panel.matterEntityId,
                    startIso: new Date(panel.start).toISOString(),
                    endIso: new Date(panel.end).toISOString(),
                  },
                )
              }
            >
              {busy ? 'Saving…' : panel.kind === 'create' ? 'Book + sync to Google' : 'Reschedule'}
            </button>
            <button onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </section>
      )}

      {view === 'day' && (
        <section>
          {dayColumn(period.days[0]!)}
          <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
            Consultation events (highlighted) are managed in-app and sync to Google; other Google
            events are shown read-only.
          </p>
        </section>
      )}

      {view === 'week' && (
        <section>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))',
              gap: 'var(--space-2)',
              overflowX: 'auto',
            }}
          >
            {period.days.map((day) => dayColumn(day, { headerWeekday: true }))}
          </div>
          <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
            Consultation events (highlighted) are managed in-app: reschedules and cancellations sync
            to Google and are recorded as audited actions. Other Google events are shown read-only.
          </p>
        </section>
      )}

      {view === 'month' && (
        <section>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(90px, 1fr))',
              gap: 1,
              background: 'var(--border)',
              border: '1px solid var(--border)',
            }}
          >
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div
                key={d}
                className="kv-label"
                style={{ padding: 'var(--space-1) var(--space-2)', background: 'var(--bg, #fff)' }}
              >
                {d}
              </div>
            ))}
            {period.days.map((day) => {
              const inMonth = day.getMonth() === startOfMonth(anchor).getMonth()
              const isToday = day.toDateString() === new Date().toDateString()
              const dayEvents = eventsByDay(day)
              return (
                <div
                  key={day.toISOString()}
                  style={{
                    background: 'var(--bg, #fff)',
                    minHeight: 96,
                    padding: 'var(--space-1)',
                    opacity: inMonth ? 1 : 0.45,
                  }}
                >
                  <button
                    className="text-sm"
                    title="Open this day"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 2,
                      cursor: 'pointer',
                      fontWeight: isToday ? 700 : 500,
                      textDecoration: isToday ? 'underline' : 'none',
                    }}
                    onClick={() => {
                      setAnchor(day)
                      setView('day')
                    }}
                  >
                    {day.getDate()}
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                    {dayEvents.slice(0, 3).map((e) => (
                      <button
                        key={e.eventId}
                        title={e.summary}
                        onClick={() => {
                          setAnchor(day)
                          setView('day')
                        }}
                        style={{
                          textAlign: 'left',
                          border: 'none',
                          borderLeft: e.managedByApp
                            ? '3px solid var(--primary, #1e3a5f)'
                            : '3px solid var(--border)',
                          borderRadius: 3,
                          background: 'var(--surface, #f6f6f6)',
                          padding: '1px 4px',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {!e.allDay &&
                          `${new Date(e.startIso!).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })} `}
                        {e.summary}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                        +{dayEvents.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
            Click a day to open it. Matter-linked consultations are highlighted; click an event to
            jump to its day, where you can reschedule, cancel, or assign.
          </p>
        </section>
      )}

      {view === 'list' && (
        <section>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {sortedEvents.map((e) => (
              <div
                key={e.eventId}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  border: '1px solid var(--border)',
                  borderLeft: e.managedByApp
                    ? '3px solid var(--primary, #1e3a5f)'
                    : '3px solid var(--border)',
                  borderRadius: 6,
                  padding: 'var(--space-2) var(--space-3)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{e.summary}</div>
                  <div className="text-muted text-sm">
                    {new Date(e.startIso!).toLocaleString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                  {e.matterEntityId ? (
                    <Link href={`/attorney/matters/${e.matterEntityId}`}>{e.matterNumber} →</Link>
                  ) : (
                    e.htmlLink && (
                      <a href={e.htmlLink} target="_blank" rel="noreferrer" className="text-sm">
                        Google event ↗
                      </a>
                    )
                  )}
                </div>
              </div>
            ))}
            {sortedEvents.length === 0 && <p className="text-muted">No events in this window.</p>}
          </div>
          <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
            Chronological list of this window&apos;s events. Switch to Day or Week view to book,
            reschedule, or cancel.
          </p>
        </section>
      )}
    </main>
  )
}
