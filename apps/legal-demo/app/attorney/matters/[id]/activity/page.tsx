'use client'

// Matter › ACTIVITY tab. Leads with what the attorney acts on day-to-day — the
// client↔attorney message thread and this matter's calendar (consultations /
// meetings) — and tucks the full audited timeline (actions + lifecycle events)
// into a collapsed section below. (Beta feedback: messages/calendar at the top,
// timeline collapsible & collapsed by default, drop the research section.)
import { use, useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { WeeklyCalendar, type CalendarItem } from '@/components/WeeklyCalendar'
import { humanizeKind } from '../shared'

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

export default function MatterActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [history, setHistory] = useState<MatterHistory | null>(null)
  const [error, setError] = useState<string | null>(null)

  // This matter's calendar. There is no matter-scoped calendar tool, so we read
  // the unified feed for a window and keep only the items tagged with this matter
  // (consultations carry matterEntityId; external Google events are null → dropped).
  const [calItems, setCalItems] = useState<CalendarItem[] | null>(null)
  const [calLoaded, setCalLoaded] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const [calError, setCalError] = useState<string | null>(null)

  useEffect(() => {
    callAttorneyMcp<MatterHistory>({
      toolName: 'legal.matter.history',
      input: { matterEntityId: id },
    })
      .then(setHistory)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    const fromIso = new Date(now - 90 * 24 * 3600 * 1000).toISOString()
    const toIso = new Date(now + 120 * 24 * 3600 * 1000).toISOString()
    callAttorneyMcp<{ items: CalendarItem[]; source: string; error?: string }>({
      toolName: 'legal.calendar.feed',
      input: { fromIso, toIso },
    })
      .then((r) => {
        if (cancelled) return
        setCalItems(r.items)
        setCalLoaded(true)
        setLastRefreshedAt(Date.now())
        setCalError(r.source === 'error' ? (r.error ?? 'Google calendar read failed.') : null)
      })
      .catch((e) => {
        if (cancelled) return
        setCalError(e instanceof Error ? e.message : String(e))
        setCalLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [id])

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
    <>
      <MessagesSection matterEntityId={id} />

      <section>
        <h2>Calendar</h2>
        <p className="text-muted text-sm">Consultations and meetings booked on this matter.</p>
        {calError && <div className="alert alert-error">{calError}</div>}
        <WeeklyCalendar items={matterEvents} loaded={calLoaded} lastRefreshedAt={lastRefreshedAt} />
      </section>

      <CollapsibleSection
        title="Timeline"
        subtitle="Every change to this matter — audited actions (actor · intent · autonomy · reasoning trace) and lifecycle events, newest first."
      >
        {error && <div className="alert alert-error">{error}</div>}
        {history === null ? (
          <p className="text-muted text-sm">
            <span className="spinner" /> Loading timeline…
          </p>
        ) : feed.length === 0 ? (
          <p className="text-muted">Nothing recorded yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Who</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {feed.map((item) =>
                  item.kind === 'action' ? (
                    <tr key={item.id}>
                      <td>{new Date(item.ts).toLocaleString()}</td>
                      <td>
                        <code>{item.a.kindName}</code>
                      </td>
                      <td>
                        {item.a.actorName}
                        {item.a.actorType === 'agent' && <span className="badge info"> AI</span>}
                        {item.a.actorType === 'system' && <span className="badge"> system</span>}
                      </td>
                      <td className="text-sm text-muted">
                        {humanizeKind(item.a.intentKind)} · {humanizeKind(item.a.autonomyTier)}
                        {item.a.hasReasoningTrace ? ' · trace ✓' : ''}
                      </td>
                    </tr>
                  ) : (
                    <tr key={item.id}>
                      <td>{new Date(item.ts).toLocaleString()}</td>
                      <td>
                        <span className="badge">{humanizeKind(item.e.kindName)}</span>
                      </td>
                      <td className="text-muted">—</td>
                      <td className="text-sm text-muted">lifecycle event</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>
    </>
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
    <section>
      <h2>Messages</h2>
      <p className="text-muted text-sm">
        The client↔attorney message thread for this matter. Replies are sent to the client and
        appear in their portal.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      {messages === null ? (
        <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
          <span className="spinner" /> Loading messages…
        </p>
      ) : messages.length === 0 ? (
        <p className="text-muted" style={{ marginTop: 'var(--space-3)' }}>
          No messages yet.
        </p>
      ) : (
        <div
          style={{
            marginTop: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {messages.map((m, i) => (
            <div
              key={`${m.sentAt}-${i}`}
              style={{
                alignSelf: m.author === 'attorney' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: '10px',
                background:
                  m.author === 'attorney'
                    ? 'var(--accent-soft, #e0e7ff)'
                    : 'var(--surface, #f4f4f5)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>
                {m.body}
              </div>
              <div className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
                {m.author === 'attorney' ? 'You' : 'Client'} · {new Date(m.sentAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className="row"
        style={{ gap: 'var(--space-2)', alignItems: 'flex-start', marginTop: 'var(--space-3)' }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Reply to the client…"
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) reply()
          }}
        />
        <button className="primary" onClick={reply} disabled={busy || !draft.trim()}>
          {busy ? 'Sending…' : 'Reply'}
        </button>
      </div>
    </section>
  )
}
