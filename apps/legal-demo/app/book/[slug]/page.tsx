'use client'

// BOOKING-FRONTDOOR-1 WP4/WP5 — the standalone public booking page. A prospect opens
// the firm's link (/book/{slug}), sees the firm's REAL available slots, picks a
// meeting length + time, enters contact info + a reason, and books. Service-agnostic:
// no intake questionnaire, no matter — just "grab time." A subtle firm-login link
// sits in the corner (WP5). Reads/writes go through the public /api/public/book/{slug}
// routes (rate-limited, run as the firm's public-intake actor).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AvailabilityCalendar, type CalendarSlot } from '@/components/AvailabilityCalendar'

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

  const wrap: React.CSSProperties = {
    maxWidth: 640,
    margin: '0 auto',
    padding: '40px 20px 80px',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    color: '#1a1a2e',
  }

  // Subtle firm-login affordance (WP5) — corner link, not a product dashboard.
  const login = (
    <div style={{ position: 'fixed', top: 12, right: 16, fontSize: 13 }}>
      <Link href="/attorney/settings" style={{ color: '#9aa0ab', textDecoration: 'none' }}>
        Firm login →
      </Link>
    </div>
  )

  if (notFound) {
    return (
      <div style={wrap}>
        {login}
        <h1 style={{ fontSize: 22 }}>Booking link not found</h1>
        <p style={{ color: '#6b7280' }}>
          This booking link isn’t valid. Check the address and try again.
        </p>
      </div>
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
      <div style={wrap}>
        {login}
        <h1 style={{ fontSize: 24 }}>You’re booked ✓</h1>
        <p style={{ fontSize: 16 }}>
          Your consultation with <strong>{avail?.firmName}</strong> is set for{' '}
          <strong>{when}</strong>.
        </p>
        <p style={{ color: '#6b7280' }}>A calendar invitation is on its way to {email}.</p>
      </div>
    )
  }

  return (
    <div style={wrap}>
      {login}
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>{avail?.firmName ?? 'Book a consultation'}</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>Grab a time that works for you.</p>

      {loading && <p style={{ color: '#6b7280' }}>Loading availability…</p>}

      {!loading && avail && !avail.configured && (
        <div style={{ background: '#f8f9fb', borderRadius: 10, padding: 20, marginTop: 20 }}>
          <p style={{ margin: 0 }}>
            {avail.firmName} hasn’t connected a calendar yet, so there are no times to show right
            now. Please check back soon.
          </p>
        </div>
      )}

      {!loading && avail?.configured && (
        <>
          {avail.meetingLengthsMinutes.length > 1 && (
            <div style={{ margin: '16px 0' }}>
              <label style={{ fontSize: 13, color: '#6b7280', display: 'block', marginBottom: 6 }}>
                Meeting length
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {avail.meetingLengthsMinutes.map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setDuration(m)
                      setSelected(null)
                      void load(m)
                    }}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 999,
                      border: '1px solid ' + (duration === m ? '#1a1a2e' : '#d1d5db'),
                      background: duration === m ? '#1a1a2e' : '#fff',
                      color: duration === m ? '#fff' : '#1a1a2e',
                      cursor: 'pointer',
                      fontSize: 14,
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
              <div style={{ margin: '18px 0 6px' }}>
                <div
                  role="tablist"
                  aria-label="View"
                  style={{
                    display: 'inline-flex',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}
                >
                  {(['calendar', 'list'] as const).map((v) => (
                    <button
                      key={v}
                      role="tab"
                      aria-selected={view === v}
                      onClick={() => setView(v)}
                      style={{
                        padding: '6px 16px',
                        border: 'none',
                        background: view === v ? '#1a1a2e' : '#fff',
                        color: view === v ? '#fff' : '#1a1a2e',
                        cursor: 'pointer',
                        fontSize: 14,
                        textTransform: 'capitalize',
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {avail.slots.length === 0 && (
                <p style={{ color: '#6b7280' }}>No open times in the next few weeks.</p>
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
                  live
                />
              ) : (
                days.map(({ day, slots }) => (
                  <div key={day} style={{ marginTop: 20 }}>
                    <h3 style={{ fontSize: 15, color: '#374151', margin: '0 0 8px' }}>{day}</h3>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {slots.map((s) => (
                        <button
                          key={s.startIso}
                          onClick={() => {
                            setSelected(s)
                            setError(null)
                          }}
                          style={{
                            padding: '8px 14px',
                            borderRadius: 8,
                            border: '1px solid #d1d5db',
                            background: '#fff',
                            cursor: 'pointer',
                            fontSize: 14,
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
            <div style={{ marginTop: 24 }}>
              <button
                onClick={() => setSelected(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6b7280',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 14,
                }}
              >
                ← pick another time
              </button>
              <h3 style={{ fontSize: 17, marginTop: 12 }}>
                {new Date(selected.startIso).toLocaleString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </h3>
              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                <input
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={inputStyle}
                />
                <input
                  placeholder="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                />
                <input
                  placeholder="Phone (optional)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={inputStyle}
                />
                <textarea
                  placeholder="What would you like to discuss?"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
                <button
                  onClick={() => void confirm()}
                  disabled={submitting || !name.trim() || !email.includes('@')}
                  style={{
                    padding: '12px 18px',
                    borderRadius: 8,
                    border: 'none',
                    background:
                      submitting || !name.trim() || !email.includes('@') ? '#9aa0ab' : '#1a1a2e',
                    color: '#fff',
                    fontSize: 15,
                    cursor: submitting ? 'default' : 'pointer',
                  }}
                >
                  {submitting ? 'Booking…' : 'Confirm booking'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p style={{ color: '#b91c1c', marginTop: 16 }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  fontSize: 15,
  fontFamily: 'inherit',
}
