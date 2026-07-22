'use client'

// Activity tab body for a CRM client or contact: the audit timeline (actions +
// lifecycle events) aggregated across ALL their matters, newest first. Fetched
// by the caller via legal.client.activity / legal.contact.activity (both return
// the same MatterHistory shape). Mirrors the matter Activity timeline (same
// li-mat-timeline classes), with a matter tag on each row since this view spans
// matters.
import { formatDateTime } from '@/lib/datetime'
import { SettingsIcon } from '@/components/icons'

interface ActionEntry {
  actionId: string
  kindName: string
  intentKind: string
  autonomyTier: string
  actorName: string
  actorType: string
  hasReasoningTrace: boolean
  recordedAt: string
}
interface EventEntry {
  eventId: string
  kindName: string
  data: Record<string, unknown>
  occurredAt: string
}
export interface PersonActivityHistory {
  actions: ActionEntry[]
  events: EventEntry[]
}

type FeedItem =
  | { kind: 'action'; id: string; ts: string; a: ActionEntry }
  | { kind: 'event'; id: string; ts: string; e: EventEntry }

function humanize(s: string): string {
  return s.replace(/_/g, ' ')
}

function ActorBadge({ actorType, actorName }: { actorType: string; actorName: string }) {
  if (actorType === 'agent') {
    return (
      <span className="li-mat-actor li-mat-actor-ai" title="Automated">
        AI
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
  const initials =
    actorName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '·'
  return (
    <span className="li-mat-actor li-mat-actor-attorney" title={actorName || 'Attorney'}>
      {initials}
    </span>
  )
}

export function PersonActivityFeed({
  history,
  loading,
}: {
  history: PersonActivityHistory | null
  loading: boolean
}) {
  if (loading || history === null) {
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading activity…
      </div>
    )
  }

  const feed: FeedItem[] = [
    ...history.actions.map(
      (a): FeedItem => ({ kind: 'action', id: `a:${a.actionId}`, ts: a.recordedAt, a }),
    ),
    ...history.events.map(
      (e): FeedItem => ({ kind: 'event', id: `e:${e.eventId}`, ts: e.occurredAt, e }),
    ),
  ].sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0))

  if (feed.length === 0) {
    return (
      <div className="li-mat-card">
        <div className="li-crm-panel-empty">
          No activity yet. Actions and lifecycle events across this person’s matters show here.
        </div>
      </div>
    )
  }

  return (
    <div className="li-mat-card">
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
                    <code>{item.a.kindName}</code> · {humanize(item.a.intentKind)}
                    {item.a.hasReasoningTrace ? ' · trace ✓' : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="li-mat-tl-head">
                    <span className="li-mat-tl-label">{humanize(item.e.kindName)}</span>
                    <span className="li-mat-tl-when">{formatDateTime(item.ts)}</span>
                  </span>
                  <span className="li-mat-tl-detail">lifecycle event</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
