'use client'

// Matter › ACTIVITY tab. Leads with what the attorney acts on day-to-day — the
// client↔attorney message thread and this matter's calendar (consultations /
// meetings) — and tucks the full audited timeline (actions + lifecycle events)
// into a collapsed section below. (Beta feedback: messages/calendar at the top,
// timeline collapsible & collapsed by default, drop the research section.)
import { use, useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { formatDateTime } from '@/lib/datetime'
import {
  WeeklyCalendar,
  type CalendarItem,
  type CalendarCategory,
} from '@/components/WeeklyCalendar'
import { GemSparkle } from '@/components/GemSparkle'
import { BriefcaseIcon, ChevronDownIcon, SettingsIcon } from '@/components/icons'
import { humanizeKind } from '../shared'
import { MatterEmailsCard } from './MatterEmailsCard'

interface MatterActionEntry {
  actionId: string
  kindName: string
  intentKind: string
  autonomyTier: string
  actorName: string
  actorType: string
  hasReasoningTrace: boolean
  recordedAt: string
}
interface MatterEventEntry {
  eventId: string
  kindName: string
  data: Record<string, unknown>
  occurredAt: string
}
interface MatterHistory {
  actions: MatterActionEntry[]
  events: MatterEventEntry[]
}

type FeedItem =
  | { id: string; ts: string; kind: 'action'; a: MatterActionEntry }
  | { id: string; ts: string; kind: 'event'; e: MatterEventEntry }

// Timeline actor badge (WP-B: "extend the existing AI/system badging to a human
// case"). The substrate has no client-vs-attorney signal on THIS feed — both
// are actor_type='human' (client portal actors are provisioned the same way,
// see clientPortalActor.ts) — so a human actor here is labeled Attorney, which
// is honest for legal.matter.history: client-authored activity (portal replies)
// renders separately below, in the Portal messages card, where the real
// client/attorney distinction (PortalMessage.author) is available.
function ActorBadge({ actorType, actorName }: { actorType: string; actorName: string }) {
  if (actorType === 'agent') {
    return (
      <span className="li-mat-actor li-mat-actor-ai" title="Automated">
        <GemSparkle size={14} secondary={false} />
      </span>
    )
  }
  if (actorType === 'system') {
    return (
      <span className="li-mat-actor li-mat-actor-system" title="System">
        <SettingsIcon size={13} />
      </span>
    )
  }
  return (
    <span className="li-mat-actor li-mat-actor-attorney" title={actorName || 'Attorney'}>
      <BriefcaseIcon size={13} />
    </span>
  )
}

export default function MatterActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [history, setHistory] = useState<MatterHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [timelineOpen, setTimelineOpen] = useState(false)

  // This matter's calendar. There is no matter-scoped calendar tool, so we read
  // the unified feed for a window and keep only the items tagged with this matter
  // (consultations carry matterEntityId; external Google events are null → dropped).
  const [calItems, setCalItems] = useState<CalendarItem[] | null>(null)
  const [calLoaded, setCalLoaded] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const [calError, setCalError] = useState<string | null>(null)
  const [categories, setCategories] = useState<CalendarCategory[]>([])

  const refreshHistory = useCallback(() => {
    callAttorneyMcp<MatterHistory>({
      toolName: 'legal.matter.history',
      input: { matterEntityId: id },
    })
      .then(setHistory)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  // Fetch the unified feed for a window and keep the items for this matter. Reused
  // by the initial load and by onChanged (after a reschedule/cancel/categorize).
  const refreshCal = useCallback(() => {
    const now = Date.now()
    const fromIso = new Date(now - 90 * 24 * 3600 * 1000).toISOString()
    const toIso = new Date(now + 120 * 24 * 3600 * 1000).toISOString()
    return callAttorneyMcp<{ items: CalendarItem[]; source: string; error?: string }>({
      toolName: 'legal.calendar.feed',
      input: { fromIso, toIso },
    })
      .then((r) => {
        setCalItems(r.items)
        setCalLoaded(true)
        setLastRefreshedAt(Date.now())
        setCalError(r.source === 'error' ? (r.error ?? 'Google calendar read failed.') : null)
      })
      .catch((e) => {
        setCalError(e instanceof Error ? e.message : String(e))
        setCalLoaded(true)
      })
  }, [])

  useEffect(() => {
    refreshCal()
  }, [refreshCal])

  useEffect(() => {
    callAttorneyMcp<{ categories: CalendarCategory[] }>({
      toolName: 'legal.calendar.categories.get',
    })
      .then((r) => setCategories(r.categories))
      .catch(() => {
        // Non-fatal: fall back to the built-in booking-category colors.
      })
  }, [])

  // After a calendar write, refetch both the feed and the audit timeline.
  const onCalChanged = useCallback(() => {
    refreshCal()
    refreshHistory()
  }, [refreshCal, refreshHistory])

  const matterEvents = (calItems ?? []).filter((i) => i.matterEntityId === id)

  // Merge actions + events into one timeline, newest first. Actions carry the rich
  // audit detail; events are the lifecycle markers — together they read as one story.
  const feed: FeedItem[] = history
    ? [
        ...history.actions.map(
          (a): FeedItem => ({ id: a.actionId, ts: a.recordedAt, kind: 'action', a }),
        ),
        ...history.events.map(
          (e): FeedItem => ({ id: e.eventId, ts: e.occurredAt, kind: 'event', e }),
        ),
      ].sort((x, y) => (x.ts < y.ts ? 1 : -1))
    : []

  return (
    <div className="li-mat-ov-col">
      <section className="li-mat-card li-mat-week">
        <h2 className="li-mat-card-title">This week</h2>
        {calError && <div className="alert alert-error">{calError}</div>}
        <WeeklyCalendar
          items={matterEvents}
          loaded={calLoaded}
          lastRefreshedAt={lastRefreshedAt}
          categories={categories}
          onChanged={onCalChanged}
        />
      </section>

      <MatterEmailsCard matterEntityId={id} />

      <MessagesSection matterEntityId={id} />

      <section className="li-mat-card">
        <button
          type="button"
          className="li-mat-notes-head"
          onClick={() => setTimelineOpen((o) => !o)}
          aria-expanded={timelineOpen}
        >
          <h2>Timeline</h2>
          <ChevronDownIcon
            size={18}
            className={timelineOpen ? 'li-mat-notes-chevron is-open' : 'li-mat-notes-chevron'}
          />
        </button>
        <div className={timelineOpen ? 'li-mat-notes-body is-open' : 'li-mat-notes-body'}>
          <div className="li-mat-notes-body-inner">
            {error && <div className="alert alert-error">{error}</div>}
            {history === null ? (
              <p className="text-muted text-sm">
                <span className="spinner" /> Loading timeline…
              </p>
            ) : feed.length === 0 ? (
              <p className="text-muted">Nothing recorded yet.</p>
            ) : (
              <div className="li-mat-timeline">
                {feed.map((item, i) => (
                  <div key={item.id} className="li-mat-tl-row">
                    <span className="li-mat-tl-rail">
                      {item.kind === 'action' ? (
                        <ActorBadge actorType={item.a.actorType} actorName={item.a.actorName} />
                      ) : (
                        <span className="li-mat-actor li-mat-actor-system" title="Lifecycle event">
                          <SettingsIcon size={13} />
                        </span>
                      )}
                      {i < feed.length - 1 && <span className="li-mat-tl-line" />}
                    </span>
                    <span className="li-mat-tl-body">
                      {item.kind === 'action' ? (
                        <>
                          <span className="li-mat-tl-head">
                            <span className="li-mat-tl-label">{item.a.actorName}</span>
                            <span className="li-mat-tl-when">{formatDateTime(item.ts)}</span>
                          </span>
                          <span className="li-mat-tl-detail">
                            <code>{item.a.kindName}</code> · {humanizeKind(item.a.intentKind)} ·{' '}
                            {humanizeKind(item.a.autonomyTier)}
                            {item.a.hasReasoningTrace ? ' · trace ✓' : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="li-mat-tl-head">
                            <span className="li-mat-tl-label">{humanizeKind(item.e.kindName)}</span>
                            <span className="li-mat-tl-when">{formatDateTime(item.ts)}</span>
                          </span>
                          <span className="li-mat-tl-detail">lifecycle event</span>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

interface PortalMessage {
  author: 'client' | 'attorney'
  body: string
  sentAt: string
}

// Attorney side of the client↔attorney portal thread (legal.matter.thread_get /
// legal.matter.message_post). Same thread the client sees in their portal.
function MessagesSection({ matterEntityId }: { matterEntityId: string }) {
  const [messages, setMessages] = useState<PortalMessage[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ messages: PortalMessage[] }>({
        toolName: 'legal.matter.thread_get',
        input: { matterEntityId },
      })
      setMessages(r.messages)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setMessages((prev) => prev ?? [])
    }
  }, [matterEntityId])

  useEffect(() => {
    load()
  }, [load])

  async function reply() {
    if (busy || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.matter.message_post',
        input: { matterEntityId, body: draft.trim() },
      })
      setDraft('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="li-mat-card">
      <h2 className="li-mat-card-title">Portal messages</h2>
      {error && <div className="alert alert-error">{error}</div>}

      {messages === null ? (
        <p className="text-muted text-sm">
          <span className="spinner" /> Loading messages…
        </p>
      ) : messages.length === 0 ? (
        <p className="text-muted">No messages yet.</p>
      ) : (
        <div className="li-mat-portal-thread">
          {messages.map((m, i) => (
            <div
              key={`${m.sentAt}-${i}`}
              className={`li-mat-portal-row ${m.author === 'attorney' ? 'is-attorney' : 'is-client'}`}
            >
              <div className="li-mat-portal-bubble">
                <div className="li-mat-portal-who">
                  {m.author === 'attorney' ? 'You' : 'Client'}
                </div>
                <div className="li-mat-portal-text">{m.body}</div>
              </div>
              <div className="li-mat-portal-time">{formatDateTime(m.sentAt)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="li-mat-portal-replyrow">
        <input
          className="li-mat-portal-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Reply to the client…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) reply()
          }}
        />
        <button
          type="button"
          className="li-mat-portal-send"
          onClick={reply}
          disabled={busy || !draft.trim()}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </section>
  )
}
