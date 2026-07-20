'use client'

// Settings → Booking rules (WP-G). Split out of the old settings monolith —
// same legal.booking_rules.get/update tools, restyled to the comp's card
// (day buttons, hour/buffer/notice selects, meeting-length chips, copyable
// public link). Calendar categories rides along below: it isn't in the comp
// and isn't one of the eight routed sections, but it's a live, wired firm
// setting with nowhere else to live — closest fit is here, next to the other
// calendar-facing config. See WIRING.md §WP-G for the note.
import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

// Firm booking rules (Contract L) — the constraints the public availability
// engine slices slots against. Mirrors the FirmBookingRules type in the legal
// vertical.
interface BookingRules {
  timezone: string
  bookableDays: number[]
  bookableHours: { start: number; end: number }
  slotGranularityMinutes: number
  bufferMinutes: number
  minLeadTimeHours: number
  defaultDurationMinutes: number
  // BOOKING-FRONTDOOR-1 WP2 — meeting lengths the standalone booker offers.
  meetingLengthsMinutes: number[]
}

// The meeting-length options an attorney can offer on the standalone booking link.
const MEETING_LENGTH_OPTIONS = [15, 30, 45, 60, 90]

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Human 12-hour label for an hour-of-day (0–24). The booking engine still stores
// 0–23 start / 1–24 end internally; we only present them as real clock times.
function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12:00 AM'
  if (h === 12) return '12:00 PM'
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
}
const START_HOURS = Array.from({ length: 24 }, (_, h) => h) // 0–23
const END_HOURS = Array.from({ length: 24 }, (_, h) => h + 1) // 1–24

// Curated US timezones (this is a US law firm). The stored value is prepended if
// it falls outside the list, so the select never silently drops a real setting.
const TIMEZONES: [string, string][] = [
  ['America/New_York', 'Eastern (New York)'],
  ['America/Chicago', 'Central (Chicago)'],
  ['America/Denver', 'Mountain (Denver)'],
  ['America/Phoenix', 'Mountain — no DST (Phoenix)'],
  ['America/Los_Angeles', 'Pacific (Los Angeles)'],
  ['America/Anchorage', 'Alaska (Anchorage)'],
  ['Pacific/Honolulu', 'Hawaii (Honolulu)'],
]

const BUFFER_OPTIONS: [number, string][] = [
  [0, 'No buffer'],
  [5, '5 minutes'],
  [10, '10 minutes'],
  [15, '15 minutes'],
  [30, '30 minutes'],
  [45, '45 minutes'],
  [60, '1 hour'],
]
const LEAD_TIME_OPTIONS: [number, string][] = [
  [0, 'No minimum'],
  [1, '1 hour'],
  [2, '2 hours'],
  [4, '4 hours'],
  [12, '12 hours'],
  [24, '1 day'],
  [48, '2 days'],
  [72, '3 days'],
]

export default function BookingPage(): React.ReactElement {
  const [bookingRules, setBookingRules] = useState<BookingRules | null>(null)
  const [publicSlug, setPublicSlug] = useState<string | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ rules: BookingRules; publicSlug: string | null }>({
        toolName: 'legal.booking_rules.get',
      })
      setBookingRules(r.rules)
      setPublicSlug(r.publicSlug)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  function updateRule<K extends keyof BookingRules>(key: K, value: BookingRules[K]): void {
    setBookingRules((r) => (r ? { ...r, [key]: value } : r))
    setSaved(false)
  }

  function toggleBookableDay(day: number): void {
    setBookingRules((r) => {
      if (!r) return r
      const has = r.bookableDays.includes(day)
      const next = has ? r.bookableDays.filter((d) => d !== day) : [...r.bookableDays, day]
      return { ...r, bookableDays: next.sort((a, b) => a - b) }
    })
    setSaved(false)
  }

  // BOOKING-FRONTDOOR-1 WP2 — the meeting lengths offered on the standalone booker.
  // Never let the list go empty (the server would fall back to the default anyway).
  function toggleMeetingLength(minutes: number): void {
    setBookingRules((r) => {
      if (!r) return r
      const has = r.meetingLengthsMinutes.includes(minutes)
      const next = has
        ? r.meetingLengthsMinutes.filter((m) => m !== minutes)
        : [...r.meetingLengthsMinutes, minutes]
      return {
        ...r,
        meetingLengthsMinutes: (next.length ? next : [minutes]).sort((a, b) => a - b),
      }
    })
    setSaved(false)
  }

  async function save(): Promise<void> {
    if (!bookingRules) return
    setBusy(true)
    setError(null)
    try {
      const r = await callAttorneyMcp<{ rules: BookingRules }>({
        toolName: 'legal.booking_rules.update',
        input: bookingRules,
      })
      setBookingRules(r.rules) // server clamps; reflect the canonical values back
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Never silently drop a saved timezone that isn't in the curated list.
  const tzOptions: [string, string][] =
    bookingRules && !TIMEZONES.some(([tz]) => tz === bookingRules.timezone)
      ? [[bookingRules.timezone, bookingRules.timezone], ...TIMEZONES]
      : TIMEZONES

  return (
    <>
      <SettingsHeader title="Booking Rules" />
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}

      {!bookingRules ? (
        <SettingsLoading />
      ) : (
        <div className="li-set-card li-set-card--medium">
          <p className="li-set-hint" style={{ margin: '0 0 18px', fontSize: '13.5px' }}>
            The public booking page offers times that fit these rules and the real Google calendar.
            Per-service durations (set on each service) override the default below.
          </p>
          {saved && <SettingsAlert tone="success">Saved.</SettingsAlert>}

          <div className="li-set-section-heading" style={{ marginTop: 0 }}>
            Bookable days
          </div>
          <div className="li-set-daybtns">
            {WEEKDAY_LABELS.map((label, day) => {
              const on = bookingRules.bookableDays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleBookableDay(day)}
                  className={`li-set-daybtn${on ? ' on' : ''}`}
                  aria-pressed={on}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div className="li-set-form-grid">
            <label className="li-set-label">
              <span>Bookable hours — start</span>
              <select
                className="li-set-select"
                value={bookingRules.bookableHours.start}
                onChange={(e) =>
                  updateRule('bookableHours', {
                    ...bookingRules.bookableHours,
                    start: Number(e.target.value),
                  })
                }
              >
                {START_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {formatHour(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="li-set-label">
              <span>Bookable hours — end</span>
              <select
                className="li-set-select"
                value={bookingRules.bookableHours.end}
                onChange={(e) =>
                  updateRule('bookableHours', {
                    ...bookingRules.bookableHours,
                    end: Number(e.target.value),
                  })
                }
              >
                {END_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {formatHour(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="li-set-label">
              <span>Buffer between calls</span>
              <select
                className="li-set-select"
                value={bookingRules.bufferMinutes}
                onChange={(e) => updateRule('bufferMinutes', Number(e.target.value))}
              >
                {BUFFER_OPTIONS.map(([n, label]) => (
                  <option key={n} value={n}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="li-set-label">
              <span>Minimum notice before a booking</span>
              <select
                className="li-set-select"
                value={bookingRules.minLeadTimeHours}
                onChange={(e) => updateRule('minLeadTimeHours', Number(e.target.value))}
              >
                {LEAD_TIME_OPTIONS.map(([n, label]) => (
                  <option key={n} value={n}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="li-set-label">
              <span>Default consultation length</span>
              <select
                className="li-set-select"
                value={bookingRules.defaultDurationMinutes}
                onChange={(e) => updateRule('defaultDurationMinutes', Number(e.target.value))}
              >
                {[15, 30, 45, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} minutes
                  </option>
                ))}
              </select>
            </label>
            <label className="li-set-label">
              <span>Timezone</span>
              <select
                className="li-set-select"
                value={bookingRules.timezone}
                onChange={(e) => updateRule('timezone', e.target.value)}
              >
                {tzOptions.map(([tz, label]) => (
                  <option key={tz} value={tz}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="li-set-section-heading">
            Meeting lengths offered (public booking link)
          </div>
          <div className="li-set-lenchips">
            {MEETING_LENGTH_OPTIONS.map((m) => {
              const on = bookingRules.meetingLengthsMinutes.includes(m)
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMeetingLength(m)}
                  className={`li-set-lenchip${on ? ' on' : ''}`}
                >
                  {m}m
                </button>
              )
            })}
          </div>

          <div className="li-set-booklink">
            <div className="li-set-booklink-label">Your public booking link</div>
            {publicSlug ? (
              <div className="li-set-booklink-row">
                <code>/book/{publicSlug}</code>
                <button
                  type="button"
                  className="li-set-btn li-set-btn-sm"
                  onClick={() => {
                    const url = `${window.location.origin}/book/${publicSlug}`
                    void navigator.clipboard?.writeText(url)
                    setCopiedLink(true)
                    setTimeout(() => setCopiedLink(false), 1500)
                  }}
                >
                  {copiedLink ? 'Copied ✓' : 'Copy link'}
                </button>
                <a href={`/book/${publicSlug}`} target="_blank" rel="noreferrer">
                  Open →
                </a>
              </div>
            ) : (
              <span className="li-set-hint">Not configured yet.</span>
            )}
          </div>

          <div className="li-set-actions-row">
            <button className="li-set-btn li-set-btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save booking rules'}
            </button>
          </div>
        </div>
      )}

      <CalendarCategoriesCard />
    </>
  )
}

// ── Calendar categories (the color palette for consultation call-types) ───────
// Self-contained: fetches + saves the firm's `firm.calendar_categories` palette
// (config-as-data, versioned + audited via legal.calendar.categories.set). The
// server normalizes — derives stable keys, dedupes, validates hex — so the editor
// stays a thin UI. Existing rows keep their key, so already-tagged consultations
// stay linked when a label is renamed.
interface EditCategory {
  key: string
  label: string
  color: string
}
function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
function CalendarCategoriesCard(): React.ReactElement {
  const [cats, setCats] = useState<EditCategory[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ categories: EditCategory[] }>({
        toolName: 'legal.calendar.categories.get',
      })
      setCats(r.categories)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  function update(i: number, patch: Partial<EditCategory>): void {
    setCats((c) => (c ? c.map((cat, idx) => (idx === i ? { ...cat, ...patch } : cat)) : c))
    setSaved(false)
  }
  function remove(i: number): void {
    setCats((c) => (c ? c.filter((_, idx) => idx !== i) : c))
    setSaved(false)
  }
  function add(): void {
    setCats((c) => [...(c ?? []), { key: '', label: '', color: '#2563eb' }])
    setSaved(false)
  }

  async function save(): Promise<void> {
    if (!cats) return
    // Derive a stable key for new rows; existing rows keep theirs (server dedupes).
    const prepared = cats
      .map((c) => ({ ...c, label: c.label.trim(), key: c.key || slugifyKey(c.label) }))
      .filter((c) => c.label && c.key)
    setBusy(true)
    setError(null)
    try {
      const r = await callAttorneyMcp<{ categories: EditCategory[] }>({
        toolName: 'legal.calendar.categories.set',
        input: { categories: prepared },
      })
      setCats(r.categories)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="li-set-card li-set-card--medium">
      <div className="li-set-table-title">Calendar categories</div>
      <p className="li-set-hint" style={{ margin: '0 0 16px' }}>
        Color-code consultations by call type. Tag any event with one of these from its edit menu on
        the calendar.
      </p>
      {saved && <SettingsAlert tone="success">Saved.</SettingsAlert>}
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}
      {!cats ? (
        <SettingsLoading />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cats.length === 0 && <p className="li-set-hint">No categories yet. Add one below.</p>}
            {cats.map((cat, i) => (
              <div
                key={i}
                style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
              >
                <input
                  type="color"
                  value={cat.color}
                  onChange={(e) => update(i, { color: e.target.value })}
                  aria-label="Color"
                  className="li-set-color-swatch"
                  style={{ width: '2.4rem', height: '2.2rem' }}
                />
                <input
                  type="text"
                  className="li-set-input"
                  value={cat.label}
                  placeholder="e.g. Court appearance"
                  onChange={(e) => update(i, { label: e.target.value })}
                  style={{ flex: 1, minWidth: '12rem' }}
                />
                <button
                  type="button"
                  className="li-set-btn li-set-btn-sm"
                  onClick={() => remove(i)}
                  aria-label="Remove category"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="li-set-actions-row" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="li-set-btn" onClick={add}>
              + Add category
            </button>
            <button className="li-set-btn li-set-btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save categories'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
