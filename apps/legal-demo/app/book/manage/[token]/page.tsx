'use client'

// Public "manage your appointment" page — the destination for the Reschedule /
// Cancel buttons in the booking-confirmation email. The prospect has no account
// yet, so the HMAC manage token in the URL is the authorization (no session).
// Availability is read through the same PUBLIC client-MCP tool the booking form
// uses; the reschedule/cancel WRITES go to token-gated routes that resolve the
// tenant from the signed token (exsto-public-surface §1).
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { callClientMcp } from '@/lib/mcpClient'
import { AvailabilityCalendar, type CalendarSlot } from '@/components/AvailabilityCalendar'
import { CheckIcon, ClockIcon, ChevronLeftIcon, ScaleIcon, LockIcon } from '@/components/icons'

interface ManageableBooking {
  clientFirstName: string | null
  matterNumber: string
  serviceKey: string | null
  serviceLabel: string | null
  scheduledAtIso: string | null
  scheduledEndIso: string | null
  status: string | null
  canModify: boolean
}

const INITIAL_HORIZON_DAYS = 60
const HORIZON_INCREMENT_DAYS = 28

type View = 'overview' | 'reschedule' | 'cancel'
type Done = { kind: 'rescheduled'; whenIso: string } | { kind: 'cancelled' }

function formatWhen(iso: string | null): string {
  if (!iso) return 'your consultation'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? 'your consultation'
    : d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
}

export default function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const search = useSearchParams()

  const [booking, setBooking] = useState<ManageableBooking | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<View>('overview')
  const [done, setDone] = useState<Done | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Slot picker state (reschedule view), mirroring the booking form.
  const [slots, setSlots] = useState<CalendarSlot[] | null>(null)
  const [slotsSource, setSlotsSource] = useState<'google' | 'stub' | null>(null)
  const [slotsRefreshing, setSlotsRefreshing] = useState(false)
  const [slotsLastUpdated, setSlotsLastUpdated] = useState<Date | null>(null)
  const [horizonDays, setHorizonDays] = useState(INITIAL_HORIZON_DAYS)
  const [loadingMoreWeeks, setLoadingMoreWeeks] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null)
  const slotsReqSeq = useRef(0)

  // Load the booking once on mount.
  useEffect(() => {
    let cancelled = false
    fetch('/api/book/manage/load', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'This appointment link is invalid or expired.')
        if (cancelled) return
        const b = data.booking as ManageableBooking
        setBooking(b)
        // ?intent=cancel deep-links straight to the cancel confirmation.
        if (b.canModify && search.get('intent') === 'cancel') setView('cancel')
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [token, search])

  const fetchSlots = useCallback(
    async (daysOut: number, opts: { silent?: boolean; serviceKey?: string } = {}) => {
      const seq = ++slotsReqSeq.current
      if (!opts.silent) setSlotsRefreshing(true)
      try {
        const r = await callClientMcp<{ slots: CalendarSlot[]; source: 'google' | 'stub' }>({
          toolName: 'legal.calendar.availability',
          input: { daysOut, serviceKey: opts.serviceKey },
        })
        if (seq !== slotsReqSeq.current) return
        setSlots(r.slots)
        setSlotsSource(r.source)
        setSlotsLastUpdated(new Date())
      } catch {
        // leave previous slots in place on transient failure
      } finally {
        if (seq === slotsReqSeq.current && !opts.silent) setSlotsRefreshing(false)
      }
    },
    [],
  )

  // Fetch availability the first time the reschedule view opens.
  useEffect(() => {
    if (view !== 'reschedule' || slots !== null) return
    fetchSlots(INITIAL_HORIZON_DAYS, { serviceKey: booking?.serviceKey ?? undefined })
  }, [view, slots, fetchSlots, booking])

  async function submitReschedule() {
    if (!selectedSlot) return
    setBusy(true)
    setActionError(null)
    try {
      const r = await fetch('/api/book/manage/reschedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          startIso: selectedSlot.startIso,
          endIso: selectedSlot.endIso,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'We could not reschedule this consultation.')
      setDone({ kind: 'rescheduled', whenIso: selectedSlot.startIso })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Someone grabbed the slot between fetch and submit — refresh and re-pick.
      if (msg.includes('SLOT_TAKEN')) {
        setActionError('That time was just taken. Please choose another.')
        setSelectedSlot(null)
        void fetchSlots(horizonDays, { serviceKey: booking?.serviceKey ?? undefined })
      } else {
        setActionError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  async function submitCancel() {
    setBusy(true)
    setActionError(null)
    try {
      const r = await fetch('/api/book/manage/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'We could not cancel this consultation.')
      setDone({ kind: 'cancelled' })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="bk-shell">
      <div className="bk-aurora" aria-hidden />
      <div className="bk-frame">
        <header className="bk-topbar">
          <div className="bk-brand">
            <span className="bk-brand-mark">
              <ScaleIcon size={18} />
            </span>
            <span className="bk-brand-name">Pacheco Law</span>
          </div>
        </header>

        <section className="bk-card">
          <div className="bk-stage">
            {/* ---- Terminal: success ---- */}
            {done ? (
              <Centered>
                <SuccessMark />
                <h1 className="bk-h1">
                  {done.kind === 'rescheduled'
                    ? 'Your consultation is moved'
                    : 'Your consultation is cancelled'}
                </h1>
                <p className="bk-sub">
                  {done.kind === 'rescheduled' ? (
                    <>
                      You&rsquo;re now set for <strong>{formatWhen(done.whenIso)}</strong>. A fresh
                      calendar invitation is on its way.
                    </>
                  ) : (
                    <>
                      We&rsquo;ve cancelled this consultation and let the office know. You can book
                      again any time.
                    </>
                  )}
                </p>
                <Link href="/" className="bk-btn bk-btn-ghost bk-btn-wide">
                  Back to Pacheco Law
                </Link>
              </Centered>
            ) : loadError ? (
              /* ---- Terminal: bad/expired token ---- */
              <Centered>
                <h1 className="bk-h1">We couldn&rsquo;t open this link</h1>
                <div className="bk-alert" role="alert">
                  {loadError}
                </div>
                <p className="bk-sub">
                  The link may have expired. Please contact the firm and we&rsquo;ll be glad to
                  help.
                </p>
              </Centered>
            ) : !booking ? (
              /* ---- Loading ---- */
              <div className="bk-loading">
                <span className="bk-spinner" />
                Loading your appointment…
              </div>
            ) : (
              <>
                <div className="bk-stage-head">
                  <h1 className="bk-h1">
                    {booking.clientFirstName
                      ? `Hi ${booking.clientFirstName} —`
                      : 'Your consultation'}
                  </h1>
                  <p className="bk-sub">
                    {booking.status === 'consultation_cancelled'
                      ? 'This consultation has been cancelled.'
                      : 'Here are the details of your consultation.'}
                  </p>
                </div>

                {actionError && (
                  <div className="bk-alert" role="alert">
                    {actionError}
                  </div>
                )}

                <div className="bk-selected" aria-live="polite" style={{ marginBottom: 20 }}>
                  <span className="bk-selected-icon">
                    <ClockIcon size={18} />
                  </span>
                  <span className="bk-selected-text">
                    <span className="bk-selected-label">
                      {booking.serviceLabel || booking.serviceKey || 'Consultation'}
                    </span>
                    <span className="bk-selected-value">{formatWhen(booking.scheduledAtIso)}</span>
                  </span>
                </div>

                {!booking.canModify ? (
                  <p className="bk-sub">
                    {booking.status === 'consultation_cancelled'
                      ? 'If you&rsquo;d like to meet, you can book a new consultation any time.'
                      : 'This consultation can no longer be changed online. Please contact the firm for help.'}
                    <br />
                    <Link
                      href="/book"
                      className="bk-btn bk-btn-primary bk-btn-wide"
                      style={{ marginTop: 16 }}
                    >
                      Book a consultation
                    </Link>
                  </p>
                ) : view === 'overview' ? (
                  <div className="bk-actions">
                    <button
                      className="bk-btn bk-btn-primary bk-btn-grow"
                      onClick={() => setView('reschedule')}
                    >
                      Reschedule
                    </button>
                    <button className="bk-btn bk-btn-ghost" onClick={() => setView('cancel')}>
                      Cancel appointment
                    </button>
                  </div>
                ) : view === 'reschedule' ? (
                  <>
                    <h3 className="bk-section-title">Pick a new time</h3>
                    {slots === null ? (
                      <div className="bk-loading">
                        <span className="bk-spinner" />
                        Loading available times…
                      </div>
                    ) : slots.length === 0 ? (
                      <p className="bk-empty">No open times right now — please check back soon.</p>
                    ) : (
                      <AvailabilityCalendar
                        slots={slots}
                        live={slotsSource !== 'stub'}
                        selectedStartIso={selectedSlot?.startIso ?? null}
                        onSelect={setSelectedSlot}
                        lastUpdated={slotsLastUpdated}
                        refreshing={slotsRefreshing}
                        onRefresh={() =>
                          fetchSlots(horizonDays, { serviceKey: booking.serviceKey ?? undefined })
                        }
                        loadingMoreWeeks={loadingMoreWeeks}
                        onLoadMoreWeeks={async () => {
                          setLoadingMoreWeeks(true)
                          const next = horizonDays + HORIZON_INCREMENT_DAYS
                          setHorizonDays(next)
                          await fetchSlots(next, {
                            silent: true,
                            serviceKey: booking.serviceKey ?? undefined,
                          })
                          setLoadingMoreWeeks(false)
                        }}
                      />
                    )}
                    <div className="bk-actions">
                      <button
                        className="bk-btn bk-btn-ghost"
                        onClick={() => {
                          setView('overview')
                          setSelectedSlot(null)
                          setActionError(null)
                        }}
                      >
                        <ChevronLeftIcon size={18} />
                        Back
                      </button>
                      <button
                        className="bk-btn bk-btn-primary bk-btn-grow"
                        disabled={!selectedSlot || busy}
                        onClick={submitReschedule}
                      >
                        {busy && <span className="bk-spinner bk-spinner-sm" />}
                        {busy ? 'Moving…' : 'Confirm new time'}
                        {!busy && <CheckIcon size={18} />}
                      </button>
                    </div>
                  </>
                ) : (
                  /* view === 'cancel' */
                  <>
                    <div className="bk-notice">
                      Cancelling will release your time slot and notify the office. This can&rsquo;t
                      be undone, but you can always book again.
                    </div>
                    <div className="bk-actions">
                      <button
                        className="bk-btn bk-btn-ghost"
                        onClick={() => {
                          setView('overview')
                          setActionError(null)
                        }}
                      >
                        <ChevronLeftIcon size={18} />
                        Keep my appointment
                      </button>
                      <button
                        className="bk-btn bk-btn-danger bk-btn-grow"
                        disabled={busy}
                        onClick={submitCancel}
                      >
                        {busy && <span className="bk-spinner bk-spinner-sm" />}
                        {busy ? 'Cancelling…' : 'Yes, cancel my consultation'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </section>

        <p className="bk-secure">
          <LockIcon size={14} />
          Your information is private and secure.
        </p>
      </div>
    </main>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="bk-confirm" style={{ textAlign: 'center' }}>
      {children}
    </div>
  )
}

function SuccessMark() {
  return (
    <div className="bk-success">
      <span className="bk-success-ring" aria-hidden />
      <span className="bk-success-check">
        <CheckIcon size={40} />
      </span>
    </div>
  )
}
