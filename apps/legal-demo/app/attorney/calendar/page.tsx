'use client'

// Calendar tab (WP7, REQ-CALMAIL-01): the attorney's real calendar in day / week
// / month / list views, with in-app create/reschedule/cancel that write through
// the action layer and round-trip to Google. Matter-linked events deep-link to
// their matters; events created directly in Google appear here (live read) as
// read-only. The fetch window follows the active view, so month pulls the whole
// month grid, day pulls a single day, etc.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'
import { Modal } from '@/components/Modal'
import { ActionsMenu, type ActionItem } from '@/components/ActionsMenu'
import { Combobox, type ComboboxOption } from '@/components/Combobox'

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
  // The matter's chosen call-type palette key, for color-coding (PR1).
  categoryKey: string | null
  // App-created meetings (PR2): the calendar_event id + linked contact, so the
  // page can reschedule/cancel via the meeting actions. Null for consultations.
  meetingEntityId: string | null
  contactEntityId: string | null
  contactName: string | null
  managedByApp: boolean
}

interface MatterOption {
  matterEntityId: string
  matterNumber: string
  clientName: string
}

interface ContactOption {
  contactEntityId: string
  fullName: string
  email: string
}

// What kind of event the create dialog is making: tied to a matter (a
// consultation, via the booking path), with a contact (invites them), or a
// personal block (no invites). Matter/contact/neither — the beta-feedback ask.
type CreateMode = 'matter' | 'contact' | 'personal'

// The firm's configurable call-type palette (firm.calendar_categories).
interface Category {
  key: string
  label: string
  color: string
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
// Format a Date for a <input type="datetime-local"> value (local, no seconds/TZ).
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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

// Hourly time-grid metrics. One hour = HOUR_PX tall; the grid is the full 24h and
// scrolls, opening near the workday.
const HOUR_PX = 48

function formatHourLabel(h: number): string {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

// Position a day's timed events: top/height in px from midnight, plus a small
// cascading inset for events that overlap an earlier one so concurrent meetings
// stay individually visible (full lane-splitting is overkill at firm scale).
function layoutTimed(
  dayEvents: WorkspaceEvent[],
): Array<{ e: WorkspaceEvent; top: number; height: number; inset: number }> {
  const sorted = [...dayEvents].sort((a, b) => (a.startIso! < b.startIso! ? -1 : 1))
  return sorted.map((e, i) => {
    const day0 = startOfDay(new Date(e.startIso!)).getTime()
    const s = new Date(e.startIso!).getTime()
    const en = e.endIso ? new Date(e.endIso).getTime() : s + 3600_000
    const top = Math.max(0, ((s - day0) / 3600_000) * HOUR_PX)
    const height = Math.max(22, ((Math.max(en, s + 600_000) - s) / 3600_000) * HOUR_PX)
    const inset = sorted.slice(0, i).filter((o) => {
      const os = new Date(o.startIso!).getTime()
      const oe = o.endIso ? new Date(o.endIso).getTime() : os + 3600_000
      return os < en && oe > s
    }).length
    return { e, top, height, inset }
  })
}

// ── Drag-to-schedule geometry (PR3) ─────────────────────────────────────────
// Times snap to quarter-hours while dragging; a dragged block can't be shorter
// than MIN_DUR_MIN. All math is within one day column (Y ↔ minutes-from-midnight,
// in LOCAL time, matching layoutTimed).
const SNAP_MIN = 15
const MIN_DUR_MIN = 15
const snapMin = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN
const clampTopPx = (px: number) => Math.max(0, Math.min(px, 24 * HOUR_PX))
const pxToMin = (px: number) => (px / HOUR_PX) * 60
const minToPx = (min: number) => (min / 60) * HOUR_PX
function dayAtMinutes(day: Date, minutes: number): Date {
  const d = startOfDay(day)
  d.setMinutes(Math.max(0, Math.min(24 * 60, minutes)))
  return d
}

// An in-progress grid drag: paint a new event (create), move an event to a new
// time, or resize its end. `moved` distinguishes a real drag from a plain click
// (which must still navigate / open the 1h creator).
type DragState =
  | { kind: 'create'; day: Date; y0: number; y1: number }
  | {
      kind: 'move'
      e: WorkspaceEvent
      day: Date
      top: number
      height: number
      grabDy: number
      moved: boolean
    }
  | { kind: 'resize'; e: WorkspaceEvent; day: Date; top: number; height: number; moved: boolean }

export default function CalendarPage() {
  const [anchor, setAnchor] = useState(() => new Date())
  const [view, setView] = useState<View>('week')
  const [events, setEvents] = useState<WorkspaceEvent[]>([])
  const [source, setSource] = useState<'google' | 'disconnected' | 'error' | null>(null)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [matters, setMatters] = useState<MatterOption[]>([])
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Dialog state for create/reschedule. create carries the chosen mode (matter /
  // contact / personal) + a title (for contact/personal — consultations auto-title)
  // and the picked matter/contact. reschedule carries the event's identity so the
  // submit routes to booking.reschedule (consultations) or meeting.reschedule
  // (app-created meetings).
  const [panel, setPanel] = useState<{
    kind: 'create' | 'reschedule'
    mode?: CreateMode
    summary?: string
    matterEntityId?: string
    contactEntityId?: string
    meeting?: { calendarEventEntityId: string; googleEventId: string | null }
    start: string
    end: string
  } | null>(null)
  // Which unlinked Google event is mid-assignment, and the chosen matter.
  const [assignFor, setAssignFor] = useState<{ eventId: string; matterEntityId: string } | null>(
    null,
  )
  // The firm's call-type palette (color-coding) + the two per-event modals it
  // feeds: categorize (set call-type) and email-guests (invite attendees).
  const [categories, setCategories] = useState<Category[]>([])
  const [categorizeFor, setCategorizeFor] = useState<{
    matterEntityId: string
    matterNumber: string
    categoryKey: string
  } | null>(null)
  const [attendeesFor, setAttendeesFor] = useState<{
    matterEntityId: string
    matterNumber: string
  } | null>(null)
  const [attendeeInput, setAttendeeInput] = useState('')
  // Drag-to-schedule on the time grid (create / move / resize). `drag` drives the
  // visual; `dragRef` mirrors it synchronously for the global mouseup; `dragColRef`
  // is the column being dragged in; `movedRef` suppresses click-navigation after a
  // real drag.
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const dragColRef = useRef<HTMLElement | null>(null)
  const movedRef = useRef(false)
  // The hourly grid scrolls the full 24h; open it near the workday.
  const gridScrollRef = useRef<HTMLDivElement>(null)

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
      const c = await callAttorneyMcp<{ contacts: ContactOption[] }>({
        toolName: 'legal.contact.list',
        input: {},
      })
      setContacts(c.contacts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    // The palette is only color-coding — a hiccup here must not error the whole
    // calendar, so it loads independently and degrades to no colors.
    try {
      const cats = await callAttorneyMcp<{ categories: Category[] }>({
        toolName: 'legal.calendar.categories.get',
        input: {},
      })
      setCategories(cats.categories)
    } catch {
      setCategories([])
    }
  }

  // Refetch whenever the visible window changes (navigation OR a view switch that
  // changes the range). week↔list share a window, so toggling between them is a
  // pure re-render with no extra fetch.
  useEffect(() => {
    load()
  }, [fromIso, toIso])

  // Open the hourly grid scrolled to ~7:30am so the workday is visible without
  // scrolling, while the full 24h stays reachable.
  useEffect(() => {
    if ((view === 'day' || view === 'week') && gridScrollRef.current) {
      gridScrollRef.current.scrollTop = 7.5 * HOUR_PX
    }
  }, [view, fromIso])

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
            mode: 'matter',
            summary: '',
            matterEntityId:
              (matterId && matters.find((m) => m.matterEntityId === matterId)?.matterEntityId) ||
              matters[0]?.matterEntityId,
            start: '',
            end: '',
          },
    )
  }, [matters])

  async function run(toolName: string, input: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({ toolName, input })
      setPanel(null)
      await load()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  // Matters as searchable combobox options (matter # + client name, both matched).
  const matterOptions: ComboboxOption[] = useMemo(
    () =>
      matters.map((m) => ({
        value: m.matterEntityId,
        label: m.matterNumber,
        hint: m.clientName || undefined,
      })),
    [matters],
  )

  // Contacts as searchable combobox options (name + email, both matched).
  const contactOptions: ComboboxOption[] = useMemo(
    () =>
      contacts.map((c) => ({
        value: c.contactEntityId,
        label: c.fullName || c.email,
        hint: c.fullName ? c.email : undefined,
      })),
    [contacts],
  )

  // Palette key → hex color, for color-coding events by their call-type.
  const categoryColor = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.key, c.color)
    return m
  }, [categories])

  // The palette color for an event (by its matter's call-type), or null when
  // uncategorized — callers fall back to the app-managed gold / external grey.
  function eventColor(e: WorkspaceEvent): string | null {
    return e.categoryKey ? (categoryColor.get(e.categoryKey) ?? null) : null
  }

  // The consolidated per-event action menu (beta feedback: every event should have
  // an edit menu). Two flavors: an app-created MEETING (contact/personal — routes to
  // the meeting actions) vs a matter CONSULTATION (the booking actions, with email
  // guests + categorize). Reschedule opens the dialog carrying the event's identity.
  function eventMenuItems(e: WorkspaceEvent): ActionItem[] {
    if (e.meetingEntityId) {
      const items: ActionItem[] = [
        {
          label: 'Reschedule',
          onClick: () =>
            setPanel({
              kind: 'reschedule',
              meeting: { calendarEventEntityId: e.meetingEntityId!, googleEventId: e.eventId },
              start: '',
              end: '',
            }),
        },
      ]
      if (e.matterEntityId)
        items.push({ label: 'View matter', href: `/attorney/matters/${e.matterEntityId}` })
      items.push({
        label: 'Cancel event',
        onClick: () => {
          const who = e.contactName ? ` with ${e.contactName}` : ''
          if (window.confirm(`Cancel this meeting${who}?`)) {
            run('legal.meeting.cancel', {
              calendarEventEntityId: e.meetingEntityId,
              googleEventId: e.eventId,
            })
          }
        },
      })
      return items
    }
    return [
      {
        label: 'Reschedule',
        onClick: () =>
          setPanel({ kind: 'reschedule', matterEntityId: e.matterEntityId!, start: '', end: '' }),
      },
      {
        label: 'Email guests',
        onClick: () => {
          setAttendeeInput('')
          setAttendeesFor({ matterEntityId: e.matterEntityId!, matterNumber: e.matterNumber ?? '' })
        },
      },
      {
        label: 'Categorize',
        onClick: () =>
          setCategorizeFor({
            matterEntityId: e.matterEntityId!,
            matterNumber: e.matterNumber ?? '',
            categoryKey: e.categoryKey ?? '',
          }),
      },
      { label: 'View matter', href: `/attorney/matters/${e.matterEntityId}` },
      {
        label: 'Cancel event',
        onClick: () => {
          if (window.confirm(`Cancel the consultation for ${e.matterNumber}?`)) {
            run('legal.booking.cancel', { matterEntityId: e.matterEntityId })
          }
        },
      },
    ]
  }

  // Submit the create dialog: matter → booking (a consultation); contact/personal →
  // a calendar_event meeting (contact invites them, personal is a private hold).
  async function submitCreate() {
    if (!panel || panel.kind !== 'create' || !panel.start || !panel.end) return
    const startIso = new Date(panel.start).toISOString()
    const endIso = new Date(panel.end).toISOString()
    if (panel.mode === 'matter') {
      await run('legal.booking.create_for_matter', {
        matterEntityId: panel.matterEntityId,
        startIso,
        endIso,
      })
    } else {
      await run('legal.meeting.create', {
        summary: panel.summary?.trim() || (panel.mode === 'contact' ? 'Meeting' : 'Personal block'),
        startIso,
        endIso,
        contactEntityId: panel.mode === 'contact' ? panel.contactEntityId : undefined,
      })
    }
  }

  // Submit the reschedule dialog: route to the matching action by the event's
  // identity captured when the dialog opened.
  async function submitReschedule() {
    if (!panel || panel.kind !== 'reschedule' || !panel.start || !panel.end) return
    const startIso = new Date(panel.start).toISOString()
    const endIso = new Date(panel.end).toISOString()
    if (panel.meeting) {
      await run('legal.meeting.reschedule', {
        calendarEventEntityId: panel.meeting.calendarEventEntityId,
        googleEventId: panel.meeting.googleEventId,
        startIso,
        endIso,
      })
    } else {
      await run('legal.booking.reschedule', {
        matterEntityId: panel.matterEntityId,
        startIso,
        endIso,
      })
    }
  }

  async function submitAttendees() {
    if (!attendeesFor) return
    const emails = attendeeInput
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (emails.length === 0) return
    if (
      await run('legal.booking.add_attendees', {
        matterEntityId: attendeesFor.matterEntityId,
        attendeeEmails: emails,
      })
    ) {
      setAttendeesFor(null)
      setAttendeeInput('')
    }
  }

  async function submitCategorize(categoryKey: string) {
    if (!categorizeFor) return
    if (
      await run('legal.booking.categorize', {
        matterEntityId: categorizeFor.matterEntityId,
        categoryKey,
      })
    ) {
      setCategorizeFor(null)
    }
  }

  // Open the create dialog with a default mode: matter when the firm has matters,
  // else a personal block (which needs none). Pre-selects the first matter/contact.
  function openCreate(start: string, end: string) {
    setPanel({
      kind: 'create',
      mode: matters.length > 0 ? 'matter' : 'personal',
      summary: '',
      matterEntityId: matters[0]?.matterEntityId,
      contactEntityId: contacts[0]?.contactEntityId,
      start,
      end,
    })
  }

  // Reschedule by the event's identity: a meeting (calendar_event) goes through the
  // meeting action, a consultation through booking — same split as the menu.
  async function rescheduleEventTo(e: WorkspaceEvent, startIso: string, endIso: string) {
    if (e.meetingEntityId) {
      await run('legal.meeting.reschedule', {
        calendarEventEntityId: e.meetingEntityId,
        googleEventId: e.eventId,
        startIso,
        endIso,
      })
    } else if (e.matterEntityId) {
      await run('legal.booking.reschedule', { matterEntityId: e.matterEntityId, startIso, endIso })
    }
  }

  // Start a drag: paint a new range on empty grid (create), move an event block, or
  // resize its bottom edge. dragColRef captures the column so move tracking survives
  // a scroll; movedRef is reset so a no-move "drag" still counts as a click.
  function beginCreateDrag(ev: React.MouseEvent, day: Date) {
    if (source !== 'google') return
    if ((ev.target as HTMLElement).closest('.cal-event')) return // the event handles itself
    ev.preventDefault()
    const col = ev.currentTarget as HTMLElement
    const relY = clampTopPx(ev.clientY - col.getBoundingClientRect().top)
    dragColRef.current = col
    movedRef.current = false
    const ds: DragState = { kind: 'create', day, y0: relY, y1: relY }
    dragRef.current = ds
    setDrag(ds)
  }
  function beginMoveDrag(
    ev: React.MouseEvent,
    e: WorkspaceEvent,
    day: Date,
    top: number,
    height: number,
  ) {
    ev.stopPropagation() // don't also start a create-drag on the column
    const col = (ev.currentTarget as HTMLElement).closest('.cal-grid-col') as HTMLElement | null
    if (!col) return
    const relY = clampTopPx(ev.clientY - col.getBoundingClientRect().top)
    dragColRef.current = col
    movedRef.current = false
    const ds: DragState = { kind: 'move', e, day, top, height, grabDy: relY - top, moved: false }
    dragRef.current = ds
    setDrag(ds)
  }
  function beginResizeDrag(
    ev: React.MouseEvent,
    e: WorkspaceEvent,
    day: Date,
    top: number,
    height: number,
  ) {
    ev.stopPropagation()
    ev.preventDefault()
    const col = (ev.currentTarget as HTMLElement).closest('.cal-grid-col') as HTMLElement | null
    if (!col) return
    dragColRef.current = col
    movedRef.current = false
    const ds: DragState = { kind: 'resize', e, day, top, height, moved: false }
    dragRef.current = ds
    setDrag(ds)
  }

  // Global move/up listeners while a drag is active (so it keeps tracking outside
  // the column). On drop, times snap to 15m: create opens the dialog prefilled to
  // the painted range (a plain click → a 1h block); move/resize reschedule.
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    function onMove(ev: MouseEvent) {
      const d = dragRef.current
      const col = dragColRef.current
      if (!d || !col) return
      const relY = clampTopPx(ev.clientY - col.getBoundingClientRect().top)
      let next: DragState
      if (d.kind === 'create') next = { ...d, y1: relY }
      else if (d.kind === 'move') next = { ...d, top: clampTopPx(relY - d.grabDy), moved: true }
      else next = { ...d, height: Math.max(minToPx(MIN_DUR_MIN), relY - d.top), moved: true }
      if (d.kind !== 'create') movedRef.current = true
      dragRef.current = next
      setDrag(next)
    }
    async function onUp() {
      const d = dragRef.current
      dragRef.current = null
      dragColRef.current = null
      setDrag(null)
      if (!d) return
      if (d.kind === 'create') {
        const a = snapMin(pxToMin(Math.min(d.y0, d.y1)))
        const b = snapMin(pxToMin(Math.max(d.y0, d.y1)))
        const end = b - a < MIN_DUR_MIN ? a + 60 : b // a plain click → a default 1h block
        openCreate(toLocalInput(dayAtMinutes(d.day, a)), toLocalInput(dayAtMinutes(d.day, end)))
        return
      }
      if (!d.moved) return // a click on the block — its own onClick handles it
      const startMin = snapMin(pxToMin(d.top))
      const endMin = startMin + Math.max(MIN_DUR_MIN, snapMin(pxToMin(d.height)))
      await rescheduleEventTo(
        d.e,
        dayAtMinutes(d.day, startMin).toISOString(),
        dayAtMinutes(d.day, endMin).toISOString(),
      )
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

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
  // Matter-linked events are color-coded by call-type (palette), falling back to a
  // gold left border; the attorney's other Google events use a muted border.
  function renderEvent(e: WorkspaceEvent) {
    const color = eventColor(e)
    const borderLeft = color
      ? `3px solid ${color}`
      : e.managedByApp
        ? '3px solid var(--navy)'
        : '3px solid var(--border)'
    return (
      <div
        key={e.eventId}
        style={{
          border: '1px solid var(--border)',
          borderLeft,
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
          <div
            className="row"
            style={{ marginTop: 4, gap: 'var(--space-2)', alignItems: 'center' }}
          >
            <Link href={`/attorney/matters/${e.matterEntityId}`}>{e.matterNumber} →</Link>
            <ActionsMenu label="Actions" align="left" items={eventMenuItems(e)} />
          </div>
        ) : e.meetingEntityId ? (
          <div
            className="row"
            style={{ marginTop: 4, gap: 'var(--space-2)', alignItems: 'center' }}
          >
            {e.contactName && <span className="text-muted text-sm">with {e.contactName}</span>}
            <ActionsMenu label="Actions" align="left" items={eventMenuItems(e)} />
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
                  <div style={{ minWidth: 180 }}>
                    <Combobox
                      ariaLabel="Matter to assign"
                      options={matterOptions}
                      value={assignFor.matterEntityId}
                      onChange={(v) => setAssignFor({ eventId: e.eventId, matterEntityId: v })}
                    />
                  </div>
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

  // A positioned event block in the hourly grid. App-managed events (a matter
  // consultation or a contact/personal meeting) are DRAGGABLE — drag the body to
  // reschedule the time, drag the bottom edge to change the end. Matter blocks still
  // deep-link to the matter on a plain click; the attorney's other Google events
  // open in Google (not draggable — we don't own them). Color = call-type palette,
  // falling back to the gold "managed" border.
  function renderGridEvent(
    e: WorkspaceEvent,
    day: Date,
    top: number,
    height: number,
    inset: number,
  ) {
    const color = eventColor(e)
    const draggable = Boolean(e.matterEntityId || e.meetingEntityId) && source === 'google'
    const d = drag
    const isThis = !!d && (d.kind === 'move' || d.kind === 'resize') && d.e.eventId === e.eventId
    const dispTop = isThis ? d.top : top
    const dispHeight = isThis ? d.height : height
    const cls = `cal-event${e.managedByApp ? ' managed' : ''}${isThis ? ' dragging' : ''}`
    const style = {
      top: dispTop,
      height: dispHeight,
      left: `calc(3px + ${inset * 12}px)`,
      zIndex: isThis ? 50 : 2 + inset,
      ...(color ? { borderLeft: `3px solid ${color}`, background: `${color}1a` } : {}),
      ...(draggable ? { cursor: isThis ? 'grabbing' : 'grab' } : {}),
    }
    const inner = (
      <>
        <span className="cal-event-time">
          {new Date(e.startIso!).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
        <span className="cal-event-title">{e.summary || '(no title)'}</span>
        {draggable && (
          <span
            className="cal-event-resize"
            onMouseDown={(ev) => beginResizeDrag(ev, e, day, dispTop, dispHeight)}
            title="Drag to change the end time"
          />
        )}
      </>
    )
    if (draggable && e.matterEntityId) {
      return (
        <Link
          key={e.eventId}
          href={`/attorney/matters/${e.matterEntityId}`}
          className={cls}
          style={style}
          title={`${e.summary} — ${e.matterNumber} · drag to reschedule`}
          draggable={false}
          onMouseDown={(ev) => beginMoveDrag(ev, e, day, dispTop, dispHeight)}
          onClick={(ev) => {
            // Suppress the deep-link navigation when this was a drag, not a click.
            if (movedRef.current) {
              ev.preventDefault()
              movedRef.current = false
            }
          }}
        >
          {inner}
        </Link>
      )
    }
    if (draggable) {
      // A contact/personal meeting — draggable, but no navigation target.
      return (
        <div
          key={e.eventId}
          className={cls}
          style={style}
          title={`${e.summary} · drag to reschedule`}
          onMouseDown={(ev) => beginMoveDrag(ev, e, day, dispTop, dispHeight)}
        >
          {inner}
        </div>
      )
    }
    if (e.htmlLink) {
      return (
        <a
          key={e.eventId}
          href={e.htmlLink}
          target="_blank"
          rel="noreferrer"
          className={cls}
          style={style}
          title={e.summary}
        >
          {inner}
        </a>
      )
    }
    return (
      <div key={e.eventId} className={cls} style={style} title={e.summary}>
        {inner}
      </div>
    )
  }

  // All-day / dateless event chip for the strip above the grid.
  function renderGridChip(e: WorkspaceEvent) {
    const cls = `cal-allday-chip${e.managedByApp ? ' managed' : ''}`
    if (e.matterEntityId) {
      return (
        <Link key={e.eventId} href={`/attorney/matters/${e.matterEntityId}`} className={cls}>
          {e.summary || '(no title)'}
        </Link>
      )
    }
    return (
      <span key={e.eventId} className={cls}>
        {e.summary || '(no title)'}
      </span>
    )
  }

  // Hourly time-grid day/week view (beta feedback: "see full calendar with times").
  // Rows = hours (full 24h, scrollable); events are absolutely positioned by their
  // start/end. `days` is one day (Day view) or seven (Week view).
  function renderTimeGrid(days: Date[]) {
    const hours = Array.from({ length: 24 }, (_, h) => h)
    const cols = `56px repeat(${days.length}, minmax(110px, 1fr))`
    const now = new Date()
    const sameDay = (e: WorkspaceEvent, day: Date) =>
      Boolean(e.startIso) && new Date(e.startIso!).toDateString() === day.toDateString()
    const timed = (day: Date) => layoutTimed(events.filter((e) => !e.allDay && sameDay(e, day)))
    const allDay = (day: Date) => events.filter((e) => e.allDay && sameDay(e, day))
    const anyAllDay = days.some((d) => allDay(d).length > 0)

    return (
      <div className="cal-grid">
        <div className="cal-grid-head" style={{ gridTemplateColumns: cols }}>
          <div className="cal-grid-corner" />
          {days.map((day) => {
            const isToday = day.toDateString() === now.toDateString()
            return (
              <div key={day.toISOString()} className={`cal-grid-dayhead${isToday ? ' today' : ''}`}>
                {days.length === 1
                  ? day.toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })
                  : day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
              </div>
            )
          })}
        </div>

        {anyAllDay && (
          <div className="cal-grid-allday" style={{ gridTemplateColumns: cols }}>
            <div className="cal-grid-corner cal-grid-allday-label">all-day</div>
            {days.map((day) => (
              <div key={day.toISOString()} className="cal-grid-allday-col">
                {allDay(day).map((e) => renderGridChip(e))}
              </div>
            ))}
          </div>
        )}

        <div className="cal-grid-scroll" ref={gridScrollRef}>
          <div
            className={`cal-grid-body${dragging ? ' dragging' : ''}`}
            style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}
          >
            <div className="cal-grid-axis">
              {hours.map((h) => (
                <div key={h} className="cal-grid-hour" style={{ height: HOUR_PX }}>
                  <span>{formatHourLabel(h)}</span>
                </div>
              ))}
            </div>
            {days.map((day) => {
              const isToday = day.toDateString() === now.toDateString()
              const nowTop = isToday
                ? ((now.getTime() - startOfDay(now).getTime()) / 3600_000) * HOUR_PX
                : null
              const canCreate = source === 'google'
              const ghost =
                drag?.kind === 'create' && drag.day.toDateString() === day.toDateString()
                  ? { top: Math.min(drag.y0, drag.y1), height: Math.abs(drag.y1 - drag.y0) }
                  : null
              return (
                <div
                  key={day.toISOString()}
                  className={`cal-grid-col${canCreate ? ' cal-grid-col-clickable' : ''}`}
                  // Mouse DOWN starts a create-drag; a plain click (no movement) still
                  // opens the creator with a default 1h block (handled on mouseup).
                  onMouseDown={(ev) => beginCreateDrag(ev, day)}
                  title={canCreate ? 'Click or drag an empty slot to add an event' : undefined}
                >
                  {hours.map((h) => (
                    <div key={h} className="cal-grid-hline" style={{ height: HOUR_PX }} />
                  ))}
                  {nowTop !== null && <div className="cal-grid-now" style={{ top: nowTop }} />}
                  {ghost && (
                    <div
                      className="cal-grid-ghost"
                      style={{ top: ghost.top, height: ghost.height }}
                    />
                  )}
                  {timed(day).map(({ e, top, height, inset }) =>
                    renderGridEvent(e, day, top, height, inset),
                  )}
                </div>
              )
            })}
          </div>
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
      <PageHead title="Calendar" />
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
          <button
            onClick={() => shift(-1)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
          >
            <ChevronLeft size={16} aria-hidden /> Previous
          </button>
          <button onClick={() => setAnchor(new Date())}>Today</button>
          <button
            onClick={() => shift(1)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
          >
            Next <ChevronRight size={16} aria-hidden />
          </button>
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
            disabled={source !== 'google'}
            onClick={() => openCreate('', '')}
          >
            + Event
          </button>
        </div>
      </section>

      {panel && (
        <Modal
          title={panel.kind === 'create' ? 'New event' : 'Reschedule'}
          onClose={() => setPanel(null)}
          footer={
            <>
              <button onClick={() => setPanel(null)}>Cancel</button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !panel.start ||
                  !panel.end ||
                  (panel.kind === 'create' && panel.mode === 'matter' && !panel.matterEntityId) ||
                  (panel.kind === 'create' && panel.mode === 'contact' && !panel.contactEntityId)
                }
                onClick={() => (panel.kind === 'create' ? submitCreate() : submitReschedule())}
              >
                {busy
                  ? 'Saving…'
                  : panel.kind === 'create'
                    ? 'Create + sync to Google'
                    : 'Reschedule'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {panel.kind === 'create' && (
              <>
                {/* Mode: tie to a matter, a contact, or neither (personal block). */}
                <div className="row" style={{ gap: 0 }}>
                  {(['matter', 'contact', 'personal'] as const).map((mode) => (
                    <button
                      key={mode}
                      className={panel.mode === mode ? 'primary' : ''}
                      disabled={mode === 'matter' && matters.length === 0}
                      title={
                        mode === 'matter' && matters.length === 0
                          ? 'No matters yet'
                          : mode === 'matter'
                            ? 'A consultation on a matter'
                            : mode === 'contact'
                              ? 'A meeting with a client (they get an invite)'
                              : 'A private block on your calendar'
                      }
                      onClick={() => setPanel({ ...panel, mode })}
                    >
                      {mode === 'matter' ? 'Matter' : mode === 'contact' ? 'Contact' : 'Personal'}
                    </button>
                  ))}
                </div>

                {panel.mode === 'matter' && (
                  <div>
                    <div className="kv-label" style={{ marginBottom: 4 }}>
                      Matter
                    </div>
                    <Combobox
                      ariaLabel="Matter"
                      options={matterOptions}
                      value={panel.matterEntityId ?? null}
                      onChange={(v) => setPanel({ ...panel, matterEntityId: v })}
                      placeholder="Search matters or clients…"
                    />
                  </div>
                )}

                {panel.mode === 'contact' && (
                  <div>
                    <div className="kv-label" style={{ marginBottom: 4 }}>
                      Contact
                    </div>
                    <Combobox
                      ariaLabel="Contact"
                      options={contactOptions}
                      value={panel.contactEntityId ?? null}
                      onChange={(v) => setPanel({ ...panel, contactEntityId: v })}
                      placeholder="Search contacts…"
                    />
                  </div>
                )}

                {panel.mode !== 'matter' && (
                  <div>
                    <div className="kv-label" style={{ marginBottom: 4 }}>
                      Title
                    </div>
                    <input
                      type="text"
                      style={{ width: '100%' }}
                      placeholder={panel.mode === 'contact' ? 'Meeting' : 'Personal block'}
                      value={panel.summary ?? ''}
                      onChange={(e) => setPanel({ ...panel, summary: e.target.value })}
                    />
                  </div>
                )}
              </>
            )}
            <div>
              <div className="kv-label" style={{ marginBottom: 4 }}>
                Start
              </div>
              <input
                type="datetime-local"
                style={{ width: '100%' }}
                value={panel.start}
                onChange={(e) => setPanel({ ...panel, start: e.target.value })}
              />
            </div>
            <div>
              <div className="kv-label" style={{ marginBottom: 4 }}>
                End
              </div>
              <input
                type="datetime-local"
                style={{ width: '100%' }}
                value={panel.end}
                onChange={(e) => setPanel({ ...panel, end: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}

      {categorizeFor && (
        <Modal
          title={`Categorize — ${categorizeFor.matterNumber}`}
          onClose={() => setCategorizeFor(null)}
          footer={<button onClick={() => setCategorizeFor(null)}>Done</button>}
        >
          <p className="text-muted text-sm" style={{ marginTop: 0 }}>
            Pick the call-type. It color-codes the event everywhere it appears.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {categories.map((c) => (
              <button
                key={c.key}
                className="row"
                style={{
                  justifyContent: 'flex-start',
                  gap: 'var(--space-2)',
                  alignItems: 'center',
                  padding: 'var(--space-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background:
                    categorizeFor.categoryKey === c.key ? 'var(--surface, #f6f6f6)' : 'transparent',
                  fontWeight: categorizeFor.categoryKey === c.key ? 700 : 400,
                  cursor: 'pointer',
                }}
                disabled={busy}
                onClick={() => submitCategorize(c.key)}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: c.color,
                    flex: '0 0 auto',
                  }}
                />
                {c.label}
                {categorizeFor.categoryKey === c.key ? (
                  <Check size={14} aria-hidden style={{ marginLeft: 4 }} />
                ) : null}
              </button>
            ))}
            {categorizeFor.categoryKey && (
              <button
                style={{ marginTop: 'var(--space-1)' }}
                disabled={busy}
                onClick={() => submitCategorize('')}
              >
                Clear category
              </button>
            )}
          </div>
        </Modal>
      )}

      {attendeesFor && (
        <Modal
          title={`Email guests — ${attendeesFor.matterNumber}`}
          onClose={() => setAttendeesFor(null)}
          footer={
            <>
              <button onClick={() => setAttendeesFor(null)}>Cancel</button>
              <button
                className="primary"
                disabled={busy || !attendeeInput.trim()}
                onClick={submitAttendees}
              >
                {busy ? 'Sending…' : 'Invite + email'}
              </button>
            </>
          }
        >
          <p className="text-muted text-sm" style={{ marginTop: 0 }}>
            Add guests to this consultation. Google emails them the invite. Separate multiple
            addresses with a comma or new line.
          </p>
          <textarea
            rows={3}
            style={{ width: '100%' }}
            placeholder="guest@example.com, another@example.com"
            value={attendeeInput}
            onChange={(e) => setAttendeeInput(e.target.value)}
          />
        </Modal>
      )}

      {view === 'day' && (
        <section>
          {renderTimeGrid(period.days)}
          <h3 style={{ marginTop: 'var(--space-4)' }}>Agenda</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {eventsByDay(period.days[0]!).length === 0 && (
              <span className="text-muted text-sm">No events this day.</span>
            )}
            {eventsByDay(period.days[0]!).map((e) => renderEvent(e))}
          </div>
          <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
            The grid is your real calendar. Use the agenda to reschedule or cancel consultations or
            assign a Google event to a matter.
          </p>
        </section>
      )}

      {view === 'week' && (
        <section>
          {renderTimeGrid(period.days)}
          <details style={{ marginTop: 'var(--space-4)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              Manage events (reschedule, cancel, assign)
            </summary>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))',
                gap: 'var(--space-2)',
                overflowX: 'auto',
                marginTop: 'var(--space-3)',
              }}
            >
              {period.days.map((day) => dayColumn(day, { headerWeekday: true }))}
            </div>
          </details>
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
                          borderLeft: `3px solid ${
                            eventColor(e) ?? (e.managedByApp ? 'var(--navy)' : 'var(--border)')
                          }`,
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
                  borderLeft: `3px solid ${
                    eventColor(e) ?? (e.managedByApp ? 'var(--navy)' : 'var(--border)')
                  }`,
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
                    <>
                      <Link href={`/attorney/matters/${e.matterEntityId}`}>{e.matterNumber} →</Link>
                      <ActionsMenu label="Actions" align="right" items={eventMenuItems(e)} />
                    </>
                  ) : e.meetingEntityId ? (
                    <>
                      {e.contactName && <span className="text-muted text-sm">{e.contactName}</span>}
                      <ActionsMenu label="Actions" align="right" items={eventMenuItems(e)} />
                    </>
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
