'use client'

// Calendar tab (WP7, REQ-CALMAIL-01): the attorney's real calendar, week view,
// with in-app create/reschedule/cancel that write through the action layer and
// round-trip to Google. Matter-linked events deep-link to their matters;
// events created directly in Google appear here (live read) as read-only.
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

const DAY_MS = 24 * 3600 * 1000

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Monday
  return x
}

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [events, setEvents] = useState<WorkspaceEvent[]>([])
  const [source, setSource] = useState<'google' | 'disconnected' | null>(null)
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

  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * DAY_MS), [weekStart])

  async function load() {
    setError(null)
    try {
      const res = await callAttorneyMcp<{
        events: WorkspaceEvent[]
        source: 'google' | 'disconnected'
      }>({
        toolName: 'legal.calendar.events',
        input: { fromIso: weekStart.toISOString(), toIso: weekEnd.toISOString() },
      })
      setEvents(res.events)
      setSource(res.source)
      const m = await callAttorneyMcp<{ matters: MatterOption[] }>({
        toolName: 'legal.matter.list',
        input: {},
      })
      setMatters(m.matters)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    load()
  }, [weekStart])

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

  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS))
  const eventsByDay = (day: Date) =>
    events
      .filter((e) => e.startIso && new Date(e.startIso).toDateString() === day.toDateString())
      .sort((a, b) => (a.startIso! < b.startIso! ? -1 : 1))

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
      {error && <div className="alert alert-error">{error}</div>}

      <section>
        <div
          className="row"
          style={{ gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <button onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY_MS))}>
            ← Previous
          </button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
          <button onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY_MS))}>
            Next →
          </button>
          <strong style={{ marginLeft: 'var(--space-3)' }}>
            {weekStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} –{' '}
            {new Date(weekEnd.getTime() - DAY_MS).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </strong>
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

      <section>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))',
            gap: 'var(--space-2)',
            overflowX: 'auto',
          }}
        >
          {days.map((day) => {
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
                  {day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
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
                  {eventsByDay(day).map((e) => (
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
                          <Link href={`/attorney/matters/${e.matterEntityId}`}>
                            {e.matterNumber} →
                          </Link>
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
                                if (
                                  window.confirm(`Cancel the consultation for ${e.matterNumber}?`)
                                ) {
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
                          Google event{' '}
                          {e.htmlLink && (
                            <a href={e.htmlLink} target="_blank" rel="noreferrer">
                              open ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
          Consultation events (highlighted) are managed in-app: reschedules and cancellations sync
          to Google and are recorded as audited actions. Other Google events are shown read-only.
        </p>
      </section>
    </main>
  )
}
