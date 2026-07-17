'use client'

// Calendar tab (WP7, REQ-CALMAIL-01; restyled to the Legal Instruments comp in
// WP-H): the attorney's real calendar in day / week / month / list views, with
// in-app create/edit/duplicate/cancel that write through the action layer and
// round-trip to Google. Matter-linked events deep-link to their matters; events
// created directly in Google appear here (live read) as read-only; tasks with a
// due date ride along as read-only "task due" entries. The fetch window follows
// the active view, so month pulls the whole month grid, day pulls a single day.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, EditIcon, XIcon } from '@/components/icons'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Modal } from '@/components/Modal'
import { useConfirm } from '@/components/ConfirmModal'
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

// A task (any matter) whose due date falls in the visible window — rendered as
// a read-only "task due" entry (BUILD, WP-H). Pulled from legal.task.list_due,
// the firm-wide sibling of the existing per-matter legal.task.list.
interface DueTaskItem {
  taskId: string
  matterEntityId: string
  matterNumber: string
  title: string
  status: string
  dueDate: string
}

type View = 'day' | 'week' | 'month' | 'list'

const DAY_MS = 24 * 3600 * 1000
// Not in the firm's calendar_categories palette — the comp's two fixed legend
// entries for events this page renders but the firm doesn't configure.
const GOOGLE_EVENT_COLOR = 'var(--li-muted-3)'
const TASK_DUE_COLOR = 'var(--li-cal-teal)'

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
// Plain local YYYY-MM-DD (no time zone shift) — matches how due dates are
// stored (date-only) and how the visible window's boundaries are sent to
// legal.task.list_due.
function toLocalDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function toLocalTimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
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

// Position a day's timed events with SIDE-BY-SIDE lanes for anything that
// overlaps (comp: CALENDAR's `layout()` — replaces the old cascading inset).
// Each event's lane group is every OTHER event it directly overlaps in time;
// within that group it gets an equal-width column (leftPct/widthPct).
function layoutTimed(
  dayEvents: WorkspaceEvent[],
): Array<{ e: WorkspaceEvent; top: number; height: number; leftPct: number; widthPct: number }> {
  const its = [...dayEvents]
    .sort((a, b) => (a.startIso! < b.startIso! ? -1 : 1))
    .map((e) => {
      const day0 = startOfDay(new Date(e.startIso!)).getTime()
      const s = new Date(e.startIso!).getTime()
      const en = e.endIso ? new Date(e.endIso).getTime() : s + 3600_000
      return {
        e,
        startMin: (s - day0) / 60_000,
        endMin: (Math.max(en, s + 600_000) - day0) / 60_000,
      }
    })
  return its.map((it) => {
    const overlapping = its.filter((o) => o.startMin < it.endMin && o.endMin > it.startMin)
    const n = overlapping.length
    const i = overlapping.indexOf(it)
    return {
      e: it.e,
      top: Math.max(0, (it.startMin / 60) * HOUR_PX),
      height: Math.max(22, ((it.endMin - it.startMin) / 60) * HOUR_PX),
      leftPct: n > 1 ? (i * 100) / n : 0,
      widthPct: n > 1 ? 100 / n : 100,
    }
  })
}

// ── Drag-to-schedule geometry (PR3) ─────────────────────────────────────────
// Times snap to quarter-hours while dragging; a dragged block can't be shorter
// than MIN_DUR_MIN. All math is within one day column (Y ↔ minutes-from-midnight,
// in LOCAL time, matching layoutTimed).
const SNAP_MIN = 15
const MIN_DUR_MIN = 15
const PRESET_DURATIONS_MIN = [15, 30, 45, 60, 90, 120]
const snapMin = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN
const clampTopPx = (px: number) => Math.max(0, Math.min(px, 24 * HOUR_PX))
const pxToMin = (px: number) => (px / HOUR_PX) * 60
const minToPx = (min: number) => (min / 60) * HOUR_PX
function dayAtMinutes(day: Date, minutes: number): Date {
  const d = startOfDay(day)
  d.setMinutes(Math.max(0, Math.min(24 * 60, minutes)))
  return d
}
function formatDuration(min: number): string {
  if (min < 60) return `${min} min`
  const hrs = min / 60
  return Number.isInteger(hrs) ? `${hrs} hr` : `${hrs.toFixed(1)} hr`
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

// The unified create/edit panel — one modal for both (comp: CALENDAR EVENT
// MODAL is reused for "New" and for editing). `create` carries the chosen mode
// (matter / contact / personal); `edit` carries the event being edited.
type Panel =
  | {
      kind: 'create'
      mode: CreateMode
      summary: string
      matterEntityId?: string
      contactEntityId?: string
      date: string
      time: string
      durationMin: number
      categoryKey: string
    }
  | {
      kind: 'edit'
      e: WorkspaceEvent
      date: string
      time: string
      durationMin: number
      categoryKey: string
    }

export default function CalendarPage() {
  const { confirm, confirmElement } = useConfirm()
  const [anchor, setAnchor] = useState(() => new Date())
  const [view, setView] = useState<View>('week')
  const [events, setEvents] = useState<WorkspaceEvent[]>([])
  const [dueTasks, setDueTasks] = useState<DueTaskItem[]>([])
  const [source, setSource] = useState<'google' | 'disconnected' | 'error' | null>(null)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [matters, setMatters] = useState<MatterOption[]>([])
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(null)
  // Which unlinked Google event is mid-assignment, and the chosen matter.
  const [assignFor, setAssignFor] = useState<{ eventId: string; matterEntityId: string } | null>(
    null,
  )
  // The firm's call-type palette (color-coding), fed by the config-as-data
  // legal.calendar.categories.* actions. seededRef guards the one-time write
  // that turns the read-time starter defaults into a REAL firm-category row
  // the first time this tenant is seen to have none (BUILD, WP-H) — never
  // hardcoded as a kind, just an ordinary save through the existing action.
  const [categories, setCategories] = useState<Category[]>([])
  const seededRef = useRef(false)
  // The right-click / pencil context menu (comp: CALENDAR CONTEXT MENU).
  const [calMenu, setCalMenu] = useState<{ x: number; y: number; e: WorkspaceEvent } | null>(null)
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
      const cats = await callAttorneyMcp<{ categories: Category[]; configured: boolean }>({
        toolName: 'legal.calendar.categories.get',
        input: {},
      })
      setCategories(cats.categories)
      // Seed a REAL firm-category row the first time this tenant has none —
      // config-as-data through the existing write action, not a hardcoded kind.
      // Fire-and-forget so a slow/failed save never blocks the calendar; on
      // failure the guard resets so the next load() retries.
      if (!cats.configured && !seededRef.current) {
        seededRef.current = true
        callAttorneyMcp({
          toolName: 'legal.calendar.categories.set',
          input: { categories: cats.categories },
        }).catch(() => {
          seededRef.current = false
        })
      }
    } catch {
      setCategories([])
    }
    // Task-due events (BUILD, WP-H) — a hiccup here degrades to no task chips,
    // never breaks the calendar.
    try {
      const dt = await callAttorneyMcp<{ tasks: DueTaskItem[] }>({
        toolName: 'legal.task.list_due',
        input: {
          fromDate: toLocalDateStr(period.start),
          toDateExclusive: toLocalDateStr(period.end),
        },
      })
      setDueTasks(dt.tasks)
    } catch {
      setDueTasks([])
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
    const now = new Date()
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
            contactEntityId: contacts[0]?.contactEntityId,
            date: toLocalDateStr(now),
            time: toLocalTimeStr(now),
            durationMin: 60,
            categoryKey: '',
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
  // uncategorized — callers fall back to the app-managed navy / external grey.
  function eventColor(e: WorkspaceEvent): string | null {
    return e.categoryKey ? (categoryColor.get(e.categoryKey) ?? null) : null
  }

  function tasksOnDay(day: Date): DueTaskItem[] {
    const key = toLocalDateStr(day)
    return dueTasks.filter((t) => t.dueDate === key)
  }

  // ── Context menu (comp: CALENDAR CONTEXT MENU — Edit event / Duplicate / Delete) ──
  function openCalMenu(ev: React.MouseEvent, e: WorkspaceEvent) {
    ev.preventDefault()
    const MENU_W = 178
    setCalMenu({
      x: Math.min(ev.clientX, window.innerWidth - MENU_W - 8),
      y: Math.min(ev.clientY, window.innerHeight - 140),
      e,
    })
  }
  function closeCalMenu() {
    setCalMenu(null)
  }

  // Open the unified modal for an existing event (comp: pencil icon + context
  // menu's "Edit event" both land here).
  function openEdit(e: WorkspaceEvent) {
    closeCalMenu()
    const s = e.startIso ? new Date(e.startIso) : new Date()
    const en = e.endIso ? new Date(e.endIso) : new Date(s.getTime() + 3600_000)
    setPanel({
      kind: 'edit',
      e,
      date: toLocalDateStr(s),
      time: toLocalTimeStr(s),
      durationMin: Math.max(MIN_DUR_MIN, Math.round((en.getTime() - s.getTime()) / 60_000)),
      categoryKey: e.categoryKey ?? '',
    })
  }

  // Open the unified modal for a new event; `start`/`end` come from a drag (a
  // painted range) or are omitted (the header "+ New" button — defaults to now,
  // 1 hour).
  function openCreate(start?: Date, end?: Date) {
    const s = start ?? new Date()
    const durationMin =
      start && end
        ? Math.max(MIN_DUR_MIN, Math.round((end.getTime() - start.getTime()) / 60_000))
        : 60
    setPanel({
      kind: 'create',
      mode: matters.length > 0 ? 'matter' : 'personal',
      summary: '',
      matterEntityId: matters[0]?.matterEntityId,
      contactEntityId: contacts[0]?.contactEntityId,
      date: toLocalDateStr(s),
      time: toLocalTimeStr(s),
      durationMin,
      categoryKey: '',
    })
  }

  // Duplicate = create a copy via the existing create action, same time (BUILD,
  // WP-H) — the attorney can then drag it to a new slot.
  async function duplicateEvent(e: WorkspaceEvent) {
    closeCalMenu()
    if (!e.startIso) return
    const endIso = e.endIso ?? e.startIso
    if (e.matterEntityId) {
      await run('legal.booking.create_for_matter', {
        matterEntityId: e.matterEntityId,
        startIso: e.startIso,
        endIso,
      })
    } else if (e.meetingEntityId) {
      await run('legal.meeting.create', {
        summary: e.summary,
        startIso: e.startIso,
        endIso,
        contactEntityId: e.contactEntityId ?? undefined,
      })
    }
  }

  // Delete = the existing cancel action, shared by the context menu, the edit
  // modal's footer, and the Actions-menu "Cancel event" item.
  function deleteEvent(e: WorkspaceEvent) {
    closeCalMenu()
    setPanel(null)
    const isMeeting = Boolean(e.meetingEntityId)
    const who = e.contactName ? ` with ${e.contactName}` : ''
    void confirm({
      title: isMeeting ? 'Cancel this meeting?' : 'Cancel the consultation?',
      body: isMeeting
        ? `Cancels the meeting${who} and removes it from the calendar.`
        : `Cancels the consultation for ${e.matterNumber} and removes it from the calendar.`,
      confirmLabel: isMeeting ? 'Cancel meeting' : 'Cancel consultation',
      cancelLabel: 'Keep it',
      danger: true,
    }).then((ok) => {
      if (!ok) return
      if (isMeeting) {
        run('legal.meeting.cancel', {
          calendarEventEntityId: e.meetingEntityId,
          googleEventId: e.eventId,
        })
      } else if (e.matterEntityId) {
        run('legal.booking.cancel', { matterEntityId: e.matterEntityId })
      }
    })
  }

  // The consolidated per-event action menu (beta feedback: every event should have
  // an edit menu) — the day/week agenda + list-view rows. Two flavors: an
  // app-created MEETING (contact/personal — the meeting actions) vs a matter
  // CONSULTATION (the booking actions, with email guests). Reschedule/Categorize
  // both open the same unified edit modal the grid's pencil/right-click use.
  function eventMenuItems(e: WorkspaceEvent): ActionItem[] {
    if (e.meetingEntityId) {
      const items: ActionItem[] = [{ label: 'Edit event', onClick: () => openEdit(e) }]
      if (e.matterEntityId)
        items.push({ label: 'View matter', href: `/attorney/matters/${e.matterEntityId}` })
      items.push({ label: 'Cancel event', danger: true, onClick: () => deleteEvent(e) })
      return items
    }
    return [
      { label: 'Edit event', onClick: () => openEdit(e) },
      {
        label: 'Email guests',
        onClick: () => {
          setAttendeeInput('')
          setAttendeesFor({ matterEntityId: e.matterEntityId!, matterNumber: e.matterNumber ?? '' })
        },
      },
      { label: 'View matter', href: `/attorney/matters/${e.matterEntityId}` },
      { label: 'Cancel event', danger: true, onClick: () => deleteEvent(e) },
    ]
  }

  // Submit the unified modal: create books/creates via the existing actions
  // (+ an optional categorize follow-up); edit reschedules (if the time moved)
  // and/or re-categorizes (if the category changed) — both existing actions.
  async function submitPanel() {
    if (!panel || !panel.date || !panel.time) return
    const start = new Date(`${panel.date}T${panel.time}`)
    if (Number.isNaN(start.getTime())) return
    const startIso = start.toISOString()
    const endIso = new Date(start.getTime() + panel.durationMin * 60_000).toISOString()

    setBusy(true)
    setError(null)
    try {
      if (panel.kind === 'create') {
        if (panel.mode === 'matter') {
          if (!panel.matterEntityId) throw new Error('Pick a matter.')
          await callAttorneyMcp({
            toolName: 'legal.booking.create_for_matter',
            input: { matterEntityId: panel.matterEntityId, startIso, endIso },
          })
          if (panel.categoryKey) {
            await callAttorneyMcp({
              toolName: 'legal.booking.categorize',
              input: { matterEntityId: panel.matterEntityId, categoryKey: panel.categoryKey },
            }).catch(() => {
              // Booking created; the category is cosmetic — don't fail the create over it.
            })
          }
        } else {
          if (panel.mode === 'contact' && !panel.contactEntityId) throw new Error('Pick a contact.')
          await callAttorneyMcp({
            toolName: 'legal.meeting.create',
            input: {
              summary:
                panel.summary.trim() || (panel.mode === 'contact' ? 'Meeting' : 'Personal block'),
              startIso,
              endIso,
              contactEntityId: panel.mode === 'contact' ? panel.contactEntityId : undefined,
            },
          })
        }
      } else {
        const e = panel.e
        if (e.meetingEntityId) {
          await callAttorneyMcp({
            toolName: 'legal.meeting.reschedule',
            input: {
              calendarEventEntityId: e.meetingEntityId,
              googleEventId: e.eventId,
              startIso,
              endIso,
            },
          })
        } else if (e.matterEntityId) {
          await callAttorneyMcp({
            toolName: 'legal.booking.reschedule',
            input: { matterEntityId: e.matterEntityId, startIso, endIso },
          })
          if (panel.categoryKey !== (e.categoryKey ?? '')) {
            await callAttorneyMcp({
              toolName: 'legal.booking.categorize',
              input: { matterEntityId: e.matterEntityId, categoryKey: panel.categoryKey },
            })
          }
        }
      }
      setPanel(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
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

  // Reschedule by the event's identity: a meeting (calendar_event) goes through the
  // meeting action, a consultation through booking — used by drag move/resize,
  // which commits immediately without opening the modal.
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
    if ((ev.target as HTMLElement).closest('.li-cal-event')) return // the event handles itself
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
    const col = (ev.currentTarget as HTMLElement).closest('.li-cal-col') as HTMLElement | null
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
    const col = (ev.currentTarget as HTMLElement).closest('.li-cal-col') as HTMLElement | null
    if (!col) return
    dragColRef.current = col
    movedRef.current = false
    const ds: DragState = { kind: 'resize', e, day, top, height, moved: false }
    dragRef.current = ds
    setDrag(ds)
  }

  // Global move/up listeners while a drag is active (so it keeps tracking outside
  // the column). On drop, times snap to 15m: create opens the modal prefilled to
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
        const endMin = b - a < MIN_DUR_MIN ? a + 60 : b // a plain click → a default 1h block
        openCreate(dayAtMinutes(d.day, a), dayAtMinutes(d.day, endMin))
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

  // Full event card — used by the day agenda, week's "Manage events", and list
  // view. Matter-linked events are color-coded by call-type (palette), falling
  // back to a navy left bar; the attorney's other Google events use a muted bar.
  function renderEvent(e: WorkspaceEvent) {
    const color = eventColor(e)
    const barColor = color ?? (e.managedByApp ? 'var(--li-navy)' : GOOGLE_EVENT_COLOR)
    return (
      <div key={e.eventId} className="li-cal-agenda-card" style={{ borderLeftColor: barColor }}>
        <div className="li-cal-agenda-time">
          {e.allDay
            ? 'All day'
            : new Date(e.startIso!).toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })}
        </div>
        <div className="li-cal-agenda-title2">{e.summary}</div>
        {e.matterEntityId ? (
          <div className="li-cal-agenda-row">
            <Link href={`/attorney/matters/${e.matterEntityId}`}>{e.matterNumber} →</Link>
            <ActionsMenu label="Actions" align="left" items={eventMenuItems(e)} />
          </div>
        ) : e.meetingEntityId ? (
          <div className="li-cal-agenda-row">
            {e.contactName && <span className="li-cal-agenda-meta">with {e.contactName}</span>}
            <ActionsMenu label="Actions" align="left" items={eventMenuItems(e)} />
          </div>
        ) : (
          <div className="li-cal-agenda-meta">
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
                <div className="li-cal-assign-row">
                  <div style={{ minWidth: 180 }}>
                    <Combobox
                      ariaLabel="Matter to assign"
                      options={matterOptions}
                      value={assignFor.matterEntityId}
                      onChange={(v) => setAssignFor({ eventId: e.eventId, matterEntityId: v })}
                    />
                  </div>
                  <button
                    type="button"
                    className="li-cal-btn-ghost"
                    disabled={busy || !assignFor.matterEntityId}
                    onClick={() => assignToMatter(e, assignFor.matterEntityId)}
                  >
                    Assign
                  </button>
                  <button
                    type="button"
                    className="li-cal-btn-ghost"
                    onClick={() => setAssignFor(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="li-cal-btn-ghost li-cal-assign-btn"
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

  // A read-only task-due card — the day agenda / week manage-events variant.
  function renderTaskAgendaRow(t: DueTaskItem) {
    return (
      <Link
        key={t.taskId}
        href={`/attorney/matters/${t.matterEntityId}/tasks/${t.taskId}`}
        className="li-cal-agenda-card li-cal-agenda-task"
        style={{ borderLeftColor: TASK_DUE_COLOR }}
      >
        <div className="li-cal-agenda-time">Task due</div>
        <div className="li-cal-agenda-title2">{t.title}</div>
        <div className="li-cal-agenda-meta">{t.matterNumber}</div>
      </Link>
    )
  }

  // Column of events (+ due tasks) for one day, used by week's "Manage events".
  function dayColumn(day: Date, opts: { headerWeekday?: boolean } = {}) {
    const isToday = day.toDateString() === new Date().toDateString()
    const dayEvents = eventsByDay(day)
    const dayTasks = tasksOnDay(day)
    return (
      <div key={day.toISOString()}>
        <div className={isToday ? 'li-cal-daycol-head is-today' : 'li-cal-daycol-head'}>
          {opts.headerWeekday
            ? day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
            : day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {isToday ? ' · today' : ''}
        </div>
        <div className="li-cal-daycol-body">
          {dayEvents.length === 0 && dayTasks.length === 0 && (
            <span className="li-cal-empty">—</span>
          )}
          {dayTasks.map((t) => renderTaskAgendaRow(t))}
          {dayEvents.map((e) => renderEvent(e))}
        </div>
      </div>
    )
  }

  // A positioned event block in the hourly grid. App-managed events (a matter
  // consultation or a contact/personal meeting) are DRAGGABLE — drag the body to
  // reschedule the time, drag the bottom edge to change the end. Matter blocks still
  // deep-link to the matter on a plain click; a contact/personal meeting opens the
  // edit modal on a plain click (it has no better default — no matter to jump to).
  // The pencil + right-click both open the comp's context menu (Edit / Duplicate /
  // Delete); the attorney's other Google events open in Google (not owned by the
  // app — no menu). Color = call-type palette, falling back to the navy "managed"
  // bar. `leftPct`/`widthPct` come from layoutTimed's side-by-side lane split.
  function renderGridEvent(
    e: WorkspaceEvent,
    day: Date,
    top: number,
    height: number,
    leftPct: number,
    widthPct: number,
  ) {
    const color = eventColor(e)
    const owned = Boolean(e.matterEntityId || e.meetingEntityId)
    const draggable = owned && source === 'google'
    const d = drag
    const isThis = !!d && (d.kind === 'move' || d.kind === 'resize') && d.e.eventId === e.eventId
    const dispTop = isThis ? d.top : top
    const dispHeight = isThis ? d.height : height
    const barColor = color ?? (e.managedByApp ? 'var(--li-navy)' : GOOGLE_EVENT_COLOR)
    const cls = `li-cal-event${e.managedByApp ? ' is-managed' : ''}${isThis ? ' is-dragging' : ''}`
    const style: React.CSSProperties = {
      top: dispTop,
      height: dispHeight,
      left: `calc(${leftPct}% + 2px)`,
      width: `calc(${widthPct}% - 4px)`,
      zIndex: isThis ? 50 : 2,
      borderLeftColor: barColor,
      background: color
        ? `${color}1a`
        : e.managedByApp
          ? 'var(--li-info-bg)'
          : 'var(--li-border-soft)',
      ...(draggable ? { cursor: isThis ? 'grabbing' : 'grab' } : {}),
    }
    const inner = (
      <>
        <span className="li-cal-event-time">
          {new Date(e.startIso!).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
        <span className="li-cal-event-title">{e.summary || '(no title)'}</span>
        {owned && (
          <button
            type="button"
            className="li-cal-event-edit"
            title="Edit / duplicate / delete"
            onMouseDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              openCalMenu(ev, e)
            }}
          >
            <EditIcon size={12} />
          </button>
        )}
        {draggable && (
          <span
            className="li-cal-event-resize"
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
          onContextMenu={(ev) => openCalMenu(ev, e)}
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
      // A contact/personal meeting — draggable; a plain click opens the edit modal
      // (there's no matter to deep-link to).
      return (
        <div
          key={e.eventId}
          className={cls}
          style={style}
          title={`${e.summary} · drag to reschedule, click to edit`}
          onMouseDown={(ev) => beginMoveDrag(ev, e, day, dispTop, dispHeight)}
          onContextMenu={(ev) => openCalMenu(ev, e)}
          onClick={() => {
            if (movedRef.current) {
              movedRef.current = false
              return
            }
            openEdit(e)
          }}
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
    const cls = `li-cal-allday-chip${e.managedByApp ? ' is-managed' : ''}`
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

  // A task-due chip for the all-day strip / month cell — read-only, click → task.
  function renderTaskChip(t: DueTaskItem) {
    return (
      <Link
        key={t.taskId}
        href={`/attorney/matters/${t.matterEntityId}/tasks/${t.taskId}`}
        className="li-cal-task-chip"
        title={`${t.title} — ${t.matterNumber}`}
      >
        {t.title}
      </Link>
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
    const anyAllDay = days.some((d) => allDay(d).length > 0 || tasksOnDay(d).length > 0)

    return (
      <div className="li-cal-card">
        <div className="li-cal-daysrow" style={{ gridTemplateColumns: cols }}>
          <div className="li-cal-daysrow-corner" />
          {days.map((day) => {
            const isToday = day.toDateString() === now.toDateString()
            return (
              <div key={day.toISOString()} className="li-cal-daycell">
                <div className="li-cal-daycell-dow">
                  {days.length === 1
                    ? day.toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })
                    : day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                </div>
                {days.length === 1 ? null : (
                  <div className={isToday ? 'li-cal-daycell-num is-today' : 'li-cal-daycell-num'}>
                    {day.getDate()}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {anyAllDay && (
          <div className="li-cal-allday" style={{ gridTemplateColumns: cols }}>
            <div className="li-cal-allday-label">all-day</div>
            {days.map((day) => (
              <div key={day.toISOString()} className="li-cal-allday-col">
                {allDay(day).map((e) => renderGridChip(e))}
                {tasksOnDay(day).map((t) => renderTaskChip(t))}
              </div>
            ))}
          </div>
        )}

        <div className="li-cal-scroll" ref={gridScrollRef}>
          <div
            className={`li-cal-body${dragging ? ' is-dragging' : ''}`}
            style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}
          >
            <div className="li-cal-axis">
              {hours.map((h) => (
                <div key={h} className="li-cal-hour" style={{ height: HOUR_PX }}>
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
                  className={`li-cal-col${canCreate ? ' li-cal-col-clickable' : ''}`}
                  // Mouse DOWN starts a create-drag; a plain click (no movement) still
                  // opens the creator with a default 1h block (handled on mouseup).
                  onMouseDown={(ev) => beginCreateDrag(ev, day)}
                  title={canCreate ? 'Click or drag an empty slot to add an event' : undefined}
                >
                  {hours.map((h) => (
                    <div key={h} className="li-cal-hline" style={{ height: HOUR_PX }} />
                  ))}
                  {nowTop !== null && <div className="li-cal-now" style={{ top: nowTop }} />}
                  {ghost && (
                    <div
                      className="li-cal-ghost"
                      style={{ top: ghost.top, height: ghost.height }}
                    />
                  )}
                  {timed(day).map(({ e, top, height, leftPct, widthPct }) =>
                    renderGridEvent(e, day, top, height, leftPct, widthPct),
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // Unified chronological entries (events + due tasks) for the List view.
  type ListEntry =
    | { kind: 'event'; e: WorkspaceEvent; at: number }
    | { kind: 'task'; t: DueTaskItem; at: number }
  const sortedEntries: ListEntry[] = useMemo(() => {
    const out: ListEntry[] = []
    for (const e of events) {
      if (e.startIso) out.push({ kind: 'event', e, at: new Date(e.startIso).getTime() })
    }
    for (const t of dueTasks) {
      out.push({ kind: 'task', t, at: new Date(`${t.dueDate}T00:00:00`).getTime() })
    }
    return out.sort((a, b) => a.at - b.at)
  }, [events, dueTasks])

  // Duration options: the common presets, plus the panel's current value if it
  // isn't one of them (e.g. a drag-created 37-minute block) — otherwise editing
  // it would silently snap to the nearest preset without the select reflecting it.
  const currentDuration = panel?.durationMin ?? null
  const durationOptions =
    currentDuration !== null && !PRESET_DURATIONS_MIN.includes(currentDuration)
      ? [...PRESET_DURATIONS_MIN, currentDuration].sort((a, b) => a - b)
      : PRESET_DURATIONS_MIN

  return (
    <main>
      {confirmElement}
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

      <div className="li-cal-header">
        <div className="li-cal-header-left">
          <h1 className="li-cal-title">Calendar</h1>
          <div className="li-cal-nav">
            <button
              type="button"
              className="li-cal-nav-btn"
              aria-label="Previous"
              onClick={() => shift(-1)}
            >
              <ChevronLeftIcon size={18} />
            </button>
            <button
              type="button"
              className="li-cal-nav-btn"
              aria-label="Next"
              onClick={() => shift(1)}
            >
              <ChevronRightIcon size={18} />
            </button>
            <span className="li-cal-range">{period.label}</span>
          </div>
        </div>
        <div className="li-cal-header-right">
          <button type="button" className="li-cal-today-btn" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <div className="li-cal-viewswitch" role="tablist" aria-label="Calendar view">
            {(['month', 'week', 'day', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={view === v ? 'li-cal-view-btn is-active' : 'li-cal-view-btn'}
                onClick={() => setView(v)}
              >
                {v[0]!.toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="li-cal-new-btn"
            disabled={source !== 'google'}
            onClick={() => openCreate()}
          >
            <PlusIcon size={15} /> New
          </button>
        </div>
      </div>

      <div className="li-cal-legend">
        {categories.map((c) => (
          <div key={c.key} className="li-cal-legend-item">
            <span className="li-cal-legend-dot" style={{ background: c.color }} />
            {c.label}
          </div>
        ))}
        <div className="li-cal-legend-item">
          <span className="li-cal-legend-dot" style={{ background: GOOGLE_EVENT_COLOR }} />
          Google event
        </div>
        <div className="li-cal-legend-item">
          <span className="li-cal-legend-dot" style={{ background: TASK_DUE_COLOR }} />
          Task due
        </div>
      </div>

      {view === 'day' && (
        <section>
          {renderTimeGrid(period.days)}
          <h3 className="li-cal-agenda-heading">Agenda</h3>
          <div className="li-cal-agenda">
            {eventsByDay(period.days[0]!).length === 0 &&
              tasksOnDay(period.days[0]!).length === 0 && (
                <span className="li-cal-empty">No events this day.</span>
              )}
            {tasksOnDay(period.days[0]!).map((t) => renderTaskAgendaRow(t))}
            {eventsByDay(period.days[0]!).map((e) => renderEvent(e))}
          </div>
          <p className="li-cal-hint">
            The grid is your real calendar. Use the agenda to edit or duplicate a consultation, or
            assign a Google event to a matter.
          </p>
        </section>
      )}

      {view === 'week' && (
        <section>
          {renderTimeGrid(period.days)}
          <details className="li-cal-manage">
            <summary className="li-cal-manage-summary">
              Manage events (edit, duplicate, cancel, assign)
            </summary>
            <div className="li-cal-manage-grid">
              {period.days.map((day) => dayColumn(day, { headerWeekday: true }))}
            </div>
          </details>
        </section>
      )}

      {view === 'month' && (
        <section>
          <div className="li-cal-month">
            <div className="li-cal-month-dow-row">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="li-cal-month-dow">
                  {d}
                </div>
              ))}
            </div>
            <div className="li-cal-month-grid">
              {period.days.map((day) => {
                const inMonth = day.getMonth() === startOfMonth(anchor).getMonth()
                const isToday = day.toDateString() === new Date().toDateString()
                const dayEvents = eventsByDay(day)
                const dayTasks = tasksOnDay(day)
                const shownEvents = dayEvents.slice(0, 3)
                const shownTasks = dayTasks.slice(0, Math.max(0, 3 - shownEvents.length))
                const overflow =
                  dayEvents.length + dayTasks.length - shownEvents.length - shownTasks.length
                return (
                  <div
                    key={day.toISOString()}
                    className={inMonth ? 'li-cal-month-cell' : 'li-cal-month-cell is-out'}
                  >
                    <button
                      type="button"
                      className={isToday ? 'li-cal-month-daybtn is-today' : 'li-cal-month-daybtn'}
                      title="Open this day"
                      onClick={() => {
                        setAnchor(day)
                        setView('day')
                      }}
                    >
                      {day.getDate()}
                    </button>
                    <div className="li-cal-month-chips">
                      {shownEvents.map((e) => (
                        <button
                          key={e.eventId}
                          type="button"
                          className="li-cal-month-chip"
                          style={{
                            borderLeftColor:
                              eventColor(e) ??
                              (e.managedByApp ? 'var(--li-navy)' : GOOGLE_EVENT_COLOR),
                          }}
                          title={e.summary}
                          onClick={() => {
                            setAnchor(day)
                            setView('day')
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
                      {shownTasks.map((t) => (
                        <Link
                          key={t.taskId}
                          href={`/attorney/matters/${t.matterEntityId}/tasks/${t.taskId}`}
                          className="li-cal-month-chip is-task"
                          style={{ borderLeftColor: TASK_DUE_COLOR }}
                          title={t.title}
                        >
                          {t.title}
                        </Link>
                      ))}
                      {overflow > 0 && <span className="li-cal-month-more">+{overflow} more</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <p className="li-cal-hint">
            Click a day to open it. Right-click (or the pencil) on an event opens Edit / Duplicate /
            Delete; task-due chips jump straight to the task.
          </p>
        </section>
      )}

      {view === 'list' && (
        <section>
          <div className="li-cal-list">
            {sortedEntries.map((entry) =>
              entry.kind === 'task' ? (
                <Link
                  key={`task-${entry.t.taskId}`}
                  href={`/attorney/matters/${entry.t.matterEntityId}/tasks/${entry.t.taskId}`}
                  className="li-cal-list-row"
                  style={{ borderLeftColor: TASK_DUE_COLOR }}
                >
                  <div>
                    <div className="li-cal-list-title">{entry.t.title}</div>
                    <div className="li-cal-list-meta">
                      Due{' '}
                      {new Date(`${entry.t.dueDate}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                  </div>
                  <span className="li-cal-list-badge">Task due · {entry.t.matterNumber}</span>
                </Link>
              ) : (
                <div
                  key={entry.e.eventId}
                  className="li-cal-list-row"
                  style={{
                    borderLeftColor:
                      eventColor(entry.e) ??
                      (entry.e.managedByApp ? 'var(--li-navy)' : GOOGLE_EVENT_COLOR),
                  }}
                >
                  <div>
                    <div className="li-cal-list-title">{entry.e.summary}</div>
                    <div className="li-cal-list-meta">
                      {new Date(entry.e.startIso!).toLocaleString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <div className="li-cal-list-actions">
                    {entry.e.matterEntityId ? (
                      <>
                        <Link href={`/attorney/matters/${entry.e.matterEntityId}`}>
                          {entry.e.matterNumber} →
                        </Link>
                        <ActionsMenu
                          label="Actions"
                          align="right"
                          items={eventMenuItems(entry.e)}
                        />
                      </>
                    ) : entry.e.meetingEntityId ? (
                      <>
                        {entry.e.contactName && (
                          <span className="li-cal-list-meta">{entry.e.contactName}</span>
                        )}
                        <ActionsMenu
                          label="Actions"
                          align="right"
                          items={eventMenuItems(entry.e)}
                        />
                      </>
                    ) : (
                      entry.e.htmlLink && (
                        <a href={entry.e.htmlLink} target="_blank" rel="noreferrer">
                          Google event ↗
                        </a>
                      )
                    )}
                  </div>
                </div>
              ),
            )}
            {sortedEntries.length === 0 && <p className="li-cal-hint">No events in this window.</p>}
          </div>
          <p className="li-cal-hint">
            Chronological list of this window&apos;s events and task due dates. Switch to Day or
            Week view to drag, or right-click an event to edit, duplicate, or delete it.
          </p>
        </section>
      )}

      {/* ── Unified create/edit modal (comp: CALENDAR EVENT MODAL) ─────────────── */}
      {panel && (
        <div className="li-cal-modal-backdrop" onClick={() => !busy && setPanel(null)}>
          <div className="li-cal-modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="li-cal-modal-head">
              <h2>{panel.kind === 'create' ? 'New event' : 'Event details'}</h2>
              <button
                type="button"
                className="li-cal-modal-x"
                onClick={() => setPanel(null)}
                disabled={busy}
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <div className="li-cal-modal-body">
              {error && <div className="alert alert-error">{error}</div>}

              {panel.kind === 'create' && (
                <div className="li-cal-seg-row">
                  {(['matter', 'contact', 'personal'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={panel.mode === mode ? 'li-cal-seg is-active' : 'li-cal-seg'}
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
              )}

              {panel.kind === 'create' && panel.mode === 'matter' && (
                <label className="li-cal-field">
                  <span>Matter</span>
                  <Combobox
                    ariaLabel="Matter"
                    options={matterOptions}
                    value={panel.matterEntityId ?? null}
                    onChange={(v) => setPanel({ ...panel, matterEntityId: v })}
                    placeholder="Search matters or clients…"
                  />
                </label>
              )}

              {panel.kind === 'create' && panel.mode === 'contact' && (
                <label className="li-cal-field">
                  <span>Contact</span>
                  <Combobox
                    ariaLabel="Contact"
                    options={contactOptions}
                    value={panel.contactEntityId ?? null}
                    onChange={(v) => setPanel({ ...panel, contactEntityId: v })}
                    placeholder="Search contacts…"
                  />
                </label>
              )}

              {panel.kind === 'create' && panel.mode !== 'matter' && (
                <label className="li-cal-field">
                  <span>Title</span>
                  <input
                    type="text"
                    placeholder={panel.mode === 'contact' ? 'Meeting' : 'Personal block'}
                    value={panel.summary}
                    onChange={(e) => setPanel({ ...panel, summary: e.target.value })}
                  />
                </label>
              )}

              {panel.kind === 'edit' && (
                <label className="li-cal-field">
                  <span>Title</span>
                  <input
                    type="text"
                    value={panel.e.summary}
                    readOnly
                    disabled
                    className="li-cal-field-readonly"
                  />
                </label>
              )}

              {panel.kind === 'edit' && panel.e.matterEntityId && (
                <label className="li-cal-field">
                  <span>Matter</span>
                  <Link
                    href={`/attorney/matters/${panel.e.matterEntityId}`}
                    className="li-cal-modal-link"
                  >
                    {panel.e.matterNumber} →
                  </Link>
                </label>
              )}
              {panel.kind === 'edit' && !panel.e.matterEntityId && panel.e.contactName && (
                <label className="li-cal-field">
                  <span>Contact</span>
                  <div className="li-cal-modal-static">{panel.e.contactName}</div>
                </label>
              )}

              <div className="li-cal-field-row">
                <label className="li-cal-field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={panel.date}
                    onChange={(e) => setPanel({ ...panel, date: e.target.value })}
                  />
                </label>
                <label className="li-cal-field">
                  <span>Time</span>
                  <input
                    type="time"
                    value={panel.time}
                    onChange={(e) => setPanel({ ...panel, time: e.target.value })}
                  />
                </label>
              </div>
              <label className="li-cal-field">
                <span>Duration</span>
                <select
                  value={panel.durationMin}
                  onChange={(e) => setPanel({ ...panel, durationMin: Number(e.target.value) })}
                >
                  {durationOptions.map((m) => (
                    <option key={m} value={m}>
                      {formatDuration(m)}
                    </option>
                  ))}
                </select>
              </label>

              {((panel.kind === 'create' && panel.mode === 'matter') ||
                (panel.kind === 'edit' && panel.e.matterEntityId)) && (
                <div className="li-cal-field">
                  <span>Category</span>
                  <div className="li-cal-chip-row">
                    {categories.map((c) => {
                      const active = panel.categoryKey === c.key
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
                          onClick={() => setPanel({ ...panel, categoryKey: active ? '' : c.key })}
                        >
                          {c.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="li-cal-modal-foot">
              {panel.kind === 'edit' ? (
                <button
                  type="button"
                  className="li-cal-btn-danger-text"
                  disabled={busy}
                  onClick={() => deleteEvent(panel.e)}
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <div className="li-cal-modal-foot-right">
                <button
                  type="button"
                  className="li-cal-btn-ghost"
                  disabled={busy}
                  onClick={() => setPanel(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="li-cal-btn-primary"
                  disabled={
                    busy ||
                    !panel.date ||
                    !panel.time ||
                    (panel.kind === 'create' && panel.mode === 'matter' && !panel.matterEntityId) ||
                    (panel.kind === 'create' && panel.mode === 'contact' && !panel.contactEntityId)
                  }
                  onClick={submitPanel}
                >
                  {busy
                    ? 'Saving…'
                    : panel.kind === 'create'
                      ? 'Create + sync to Google'
                      : 'Save event'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Right-click / pencil context menu (comp: CALENDAR CONTEXT MENU) ─────── */}
      {calMenu && (
        <div
          className="li-cal-menu-overlay"
          onClick={closeCalMenu}
          onContextMenu={(ev) => {
            ev.preventDefault()
            closeCalMenu()
          }}
        >
          <div
            className="li-cal-menu"
            style={{ left: calMenu.x, top: calMenu.y }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <button type="button" className="li-cal-menu-item" onClick={() => openEdit(calMenu.e)}>
              Edit event
            </button>
            <button
              type="button"
              className="li-cal-menu-item"
              onClick={() => duplicateEvent(calMenu.e)}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="li-cal-menu-item is-danger"
              onClick={() => deleteEvent(calMenu.e)}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {attendeesFor && (
        <Modal
          title={`Email guests — ${attendeesFor.matterNumber}`}
          onClose={() => setAttendeesFor(null)}
          footer={
            <>
              <button className="li-modal-btn-ghost" onClick={() => setAttendeesFor(null)}>
                Cancel
              </button>
              <button
                className="li-modal-btn-primary"
                disabled={busy || !attendeeInput.trim()}
                onClick={submitAttendees}
              >
                {busy ? 'Sending…' : 'Invite + email'}
              </button>
            </>
          }
        >
          <p className="li-modal-muted" style={{ marginTop: 0 }}>
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
    </main>
  )
}
