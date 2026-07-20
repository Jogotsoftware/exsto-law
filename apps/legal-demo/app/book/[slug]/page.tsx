'use client'

// BOOKING-FRONTDOOR-1 WP4/WP5, on-brand pass (A1.1) — the standalone public booking
// page. A prospect opens the firm's link (/book/{slug}), sees the firm's REAL
// available slots, picks a meeting length + time, enters contact info + a reason,
// and books. Service-agnostic: no intake questionnaire, no matter — just "grab
// time." A returning client can sign into their portal instead (the shared
// two-path chooser, same as the wizard's front door). Reads/writes go through the
// public /api/public/book/{slug} routes (rate-limited, run as the firm's public-
// intake actor).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { AvailabilityCalendar, type CalendarSlot } from '@/components/AvailabilityCalendar'
import { BookTopbar } from '@/components/BookTopbar'
import { BookingChooser } from '@/components/BookingChooser'
import { ArrowRightIcon, CheckIcon, ChevronLeftIcon } from '@/components/icons'

interface Slot {
  startIso: string
  endIso: string
  label: string
}
interface Availability {
  firmName: string
  timezone: string
  meetingLengthsMinutes: number[]
  durationMinutes: number
  // Clickable open times only (the true intersection). Drives the list view + the
  // confirm no-double-book re-check.
  slots: Slot[]
  // The FULL candidate grid with an `available` flag per cell — open (clickable) vs
  // unavailable (anonymous blocked). Feeds the calendar view. Carries NO event detail
  // (only times + busy/free), so the public calendar exposes busy/free and nothing else.
  gridSlots: CalendarSlot[]
  configured: boolean
}

// Whether a returning-visitor session already exists — mirrors the wizard's
// portalMe check so both booking surfaces share the same chooser gate.
type PortalMe = { email: string } | null | undefined

function groupByDay(slots: Slot[]): { day: string; slots: Slot[] }[] {
  const map = new Map<string, Slot[]>()
  for (const s of slots) {
    const d = new Date(s.startIso)
    const key = d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
    ;(map.get(key) ?? map.set(key, []).get(key)!).push(s)
  }
  return [...map.entries()].map(([day, ss]) => ({ day, slots: ss }))
}

export default function PublicBookingPage(): React.JSX.Element {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug ?? ''

  const [avail, setAvail] = useState<Availability | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [view, setView] = useState<'calendar' | 'list'>('calendar') // calendar is default
  const [selected, setSelected] = useState<Slot | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<{ startIso: string } | null>(null)

  // A1.1: same two-path chooser as the wizard. undefined = still checking;
  // null = anonymous (chooser shows); truthy = already signed in (skip it,
  // same as /book — no need to ask a known client which path they want).
  const [portalMe, setPortalMe] = useState<PortalMe>(undefined)
  const [chooserDismissed, setChooserDismissed] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch('/api/client/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (cancelled) return
        setPortalMe(me && typeof me.email === 'string' && me.matchesFirm !== false ? me : null)
      })
      .catch(() => {
        if (!cancelled) setPortalMe(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(
    async (dur?: number) => {
      setLoading(true)
      setError(null)
      try {
        const qs = dur ? `?duration=${dur}` : ''
        const res = await fetch(`/api/public/book/${encodeURIComponent(slug)}/availability${qs}`)
        if (res.status === 404) {
          setNotFound(true)
          return
        }
        const data = (await res.json()) as Availability & { error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Could not load availability.')
        setAvail(data)
        setDuration((prev) => prev ?? data.durationMinutes)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load availability.')
      } finally {
        setLoading(false)
      }
    },
    [slug],
  )

  useEffect(() => {
    void load()
  }, [load])

  const days = useMemo(() => groupByDay(avail?.slots ?? []), [avail])

  async function confirm(): Promise<void> {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/book/${encodeURIComponent(slug)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: name,
          clientEmail: email,
          clientPhone: phone || null,
          reason: reason || null,
          startIso: selected.startIso,
          endIso: selected.endIso,
          durationMinutes: duration ?? undefined,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Could not confirm your booking.')
      setConfirmed({ startIso: selected.startIso })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm your booking.')
      // A taken slot / stale availability — refresh so they can re-pick.
      void load(duration ?? undefined)
      setSelected(null)
    } finally {
      setSubmitting(false)
    }
  }

  if (notFound) {
    return (
      <main className="bk-shell">
        <div className="bk-aurora" aria-hidden />
        <div className="bk-frame">
          <BookTopbar firmName={null} showLanguageToggle={false} />
          <section className="bk-card">
            <div className="bk-stage-head">
              <h1 className="bk-h1">Booking link not found</h1>
              <p className="bk-sub">
                This booking link isn’t valid. Check the address and try again.
              </p>
            </div>
          </section>
        </div>
      </main>
    )
  }

  if (confirmed) {
    const when = new Date(confirmed.startIso).toLocaleString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    return (
      <main className="bk-shell">
        <div className="bk-aurora" aria-hidden />
        <div className="bk-frame">
          <BookTopbar firmName={avail?.firmName ?? null} showLanguageToggle={false} />
          <section className="bk-card bk-confirm">
            <div className="bk-success">
              <span className="bk-success-ring" aria-hidden />
              <span className="bk-success-check">
                <CheckIcon size={40} />
              </span>
            </div>
            <h1 className="bk-h1">You’re booked</h1>
            <p className="bk-confirm-line">
              Your consultation with <strong>{avail?.firmName}</strong> is set for{' '}
              <strong>{when}</strong>.
            </p>
            <p className="bk-sub">A calendar invitation is on its way to {email}.</p>
          </section>
        </div>
      </main>
    )
  }

  // portalMe undefined = still checking — hold the same brief loading beat
  // the wizard does, so the chooser never flashes in over rendered content.
  if (portalMe === undefined) {
    return (
      <main className="bk-shell">
        <div className="bk-aurora" aria-hidden />
        <div className="bk-frame">
          <BookTopbar firmName={null} showLanguageToggle={false} />
          <section className="bk-card">
            <div className="bk-loading">
              <span className="bk-spinner" />
              Loading…
            </div>
          </section>
        </div>
      </main>
    )
  }

  if (portalMe === null && !chooserDismissed) {
    return (
      <BookingChooser
        firmName={avail?.firmName ?? null}
        onContinueAsNewClient={() => setChooserDismissed(true)}
      />
    )
  }

  return (
    <main className="bk-shell">
      <div className="bk-aurora" aria-hidden />
      <div className="bk-frame">
        <BookTopbar firmName={avail?.firmName ?? null} showLanguageToggle={false} />
        <section className="bk-card">
          <div className="bk-stage">
            <div className="bk-stage-head">
              <h1 className="bk-h1">Book a consultation</h1>
              <p className="bk-sub">Grab a time that works for you.</p>
            </div>

            {error && (
              <div className="bk-alert" role="alert">
                {error}
              </div>
            )}

            {loading && (
              <div className="bk-loading">
                <span className="bk-spinner" />
                Loading availability…
              </div>
            )}

            {!loading && avail && !avail.configured && (
              <div className="bk-notice" role="note">
                {avail.firmName} hasn’t connected a calendar yet, so there are no times to show
                right now. Please check back soon.
              </div>
            )}

            {!loading && avail?.configured && (
              <>
                {avail.meetingLengthsMinutes.length > 1 && (
                  <div className="bk-field">
                    <span className="bk-label">Meeting length</span>
                    <div className="bk-pills">
                      {avail.meetingLengthsMinutes.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`bk-pill ${duration === m ? 'bk-pill-on' : ''}`}
                          onClick={() => {
                            setDuration(m)
                            setSelected(null)
                            void load(m)
                          }}
                        >
                          {m} min
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!selected && (
                  <>
                    {/* Calendar | List toggle — calendar is the default. */}
                    <div className="bk-view-toggle" role="tablist" aria-label="View">
                      {(['calendar', 'list'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          role="tab"
                          aria-selected={view === v}
                          className={`bk-view-toggle-btn ${view === v ? 'active' : ''}`}
                          onClick={() => setView(v)}
                        >
                          {v === 'calendar' ? 'Calendar' : 'List'}
                        </button>
                      ))}
                    </div>

                    {avail.slots.length === 0 && (
                      <p className="bk-empty">No open times in the next few weeks.</p>
                    )}

                    {/* Calendar view — reuses the public AvailabilityCalendar (weekly grid +
                      mobile accordion). It renders ONLY open (clickable) vs unavailable
                      (anonymous greyed "taken") cells; it never receives event detail, so
                      the public calendar exposes busy/free and nothing about "what". */}
                    {view === 'calendar' ? (
                      <AvailabilityCalendar
                        slots={avail.gridSlots}
                        selectedStartIso={selected ? (selected as Slot).startIso : null}
                        onSelect={(s) => {
                          setSelected({ startIso: s.startIso, endIso: s.endIso, label: s.label })
                          setError(null)
                        }}
                      />
                    ) : (
                      days.map(({ day, slots }) => (
                        <div key={day} className="bk-section">
                          <h3 className="bk-section-title">{day}</h3>
                          <div className="bk-pills">
                            {slots.map((s) => (
                              <button
                                key={s.startIso}
                                type="button"
                                className="bk-pill"
                                onClick={() => {
                                  setSelected(s)
                                  setError(null)
                                }}
                              >
                                {new Date(s.startIso).toLocaleTimeString(undefined, {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}

                {selected && (
                  <>
                    <button
                      type="button"
                      className="bk-btn bk-btn-ghost"
                      onClick={() => setSelected(null)}
                    >
                      <ChevronLeftIcon size={18} />
                      Pick another time
                    </button>
                    <div className="bk-selected" aria-live="polite">
                      <span className="bk-selected-text">
                        <span className="bk-selected-label">Selected time</span>
                        <span className="bk-selected-value">
                          {new Date(selected.startIso).toLocaleString(undefined, {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </span>
                    </div>
                    <div className="bk-fields">
                      <div className="bk-field">
                        <label className="bk-label" htmlFor="bk-slug-name">
                          Your name
                        </label>
                        <input
                          id="bk-slug-name"
                          className="bk-input"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>
                      <div className="bk-field">
                        <label className="bk-label" htmlFor="bk-slug-email">
                          Email
                        </label>
                        <input
                          id="bk-slug-email"
                          className="bk-input"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                      <div className="bk-field">
                        <label className="bk-label" htmlFor="bk-slug-phone">
                          Phone (optional)
                        </label>
                        <input
                          id="bk-slug-phone"
                          className="bk-input"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                      </div>
                      <div className="bk-field">
                        <label className="bk-label" htmlFor="bk-slug-reason">
                          What would you like to discuss?
                        </label>
                        <textarea
                          id="bk-slug-reason"
                          className="bk-input bk-textarea"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          rows={3}
                        />
                      </div>
                    </div>
                    <div className="bk-actions">
                      <button
                        type="button"
                        className="bk-btn bk-btn-primary bk-btn-wide"
                        onClick={() => void confirm()}
                        disabled={submitting || !name.trim() || !email.includes('@')}
                      >
                        {submitting && <span className="bk-spinner bk-spinner-sm" />}
                        {submitting ? 'Booking…' : 'Confirm booking'}
                        {!submitting && <ArrowRightIcon size={18} />}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
