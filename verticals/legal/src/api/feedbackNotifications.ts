// Feedback-resolution in-app notifications (migration 0070). Closes the beta-
// feedback loop: an admin/agent resolves a feedback item, the attorney who
// submitted it sees an in-app notification (the nav bell) with the resolution
// note and a link back to the exact page they gave the feedback on.
//
// All three operations go through the substrate the normal way — resolutions and
// "seen" markers are recorded as events via the generic event.record action; the
// read is a tenant-scoped query over those events. No raw substrate writes.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import type { FeedbackCategory } from './assistantChat.js'

export interface ResolveFeedbackInput {
  // The assistant.turn (kind=feedback) event id — the ref shown to the attorney
  // when they submitted it.
  feedbackEventId: string
  // What was done about it (shown verbatim in the attorney's notification).
  note?: string
}

// Resolve one beta-feedback item. Reads the original feedback to learn who
// submitted it (the recipient), where they were (the deep-link path), and what
// they said (an excerpt), then records an assistant.feedback_resolved event
// addressed to that attorney. Callable by an admin/agent (no triage UI).
export async function resolveAssistantFeedback(
  ctx: ActionContext,
  input: ResolveFeedbackInput,
): Promise<{ eventId: string }> {
  const original = await loadFeedbackEvent(ctx, input.feedbackEventId)
  if (!original) throw new Error('Feedback not found.')
  if (original.kind !== 'feedback') throw new Error('That event is not beta feedback.')

  const message = original.message ?? ''
  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    // Resolving feedback is a deliberate, governed act on the team's part.
    intentKind: 'enforcement',
    payload: {
      event_kind_name: 'assistant.feedback_resolved',
      // Thread the resolution on the same matter/contact the feedback was on.
      primary_entity_id: original.primaryEntityId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: {
        feedback_event_id: input.feedbackEventId,
        // The submitter — who gets notified in-app.
        recipient_actor_id: original.sourceRef,
        note: input.note?.trim() || null,
        link_path: original.linkPath,
        excerpt: message.length > 140 ? `${message.slice(0, 140)}…` : message,
        category: original.category ?? 'other',
      },
    },
  })
  const eventId = (res.effects[0] as { eventId: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

export interface NotificationItem {
  eventId: string
  feedbackEventId: string | null
  note: string | null
  linkPath: string | null
  excerpt: string
  category: FeedbackCategory
  resolvedAt: string
  unread: boolean
}

// The current actor's in-app notifications — resolved feedback addressed to
// them, newest first. Each is `unread` if it post-dates the actor's last bell
// open (their latest notification.seen). Unread state is computed in SQL so the
// timestamp comparison is done by Postgres, not by string-compare in JS.
export async function listMyNotifications(
  ctx: ActionContext,
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      event_id: string
      feedback_event_id: string | null
      note: string | null
      link_path: string | null
      excerpt: string | null
      category: string | null
      resolved_at: string
      unread: boolean
    }>(
      `WITH seen AS (
         -- The actor's last bell-open. We key off the notification.seen event's
         -- own occurred_at (DB clock) — the same clock the resolutions are stamped
         -- on — so the unread comparison never depends on app-vs-DB clock skew.
         SELECT max(e.occurred_at) AS seen_through
         FROM event e
         JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
         WHERE e.tenant_id = $1 AND ekd.kind_name = 'notification.seen'
           AND e.source_ref = $2
       )
       SELECT e.id AS event_id,
              e.payload->>'feedback_event_id' AS feedback_event_id,
              e.payload->>'note'              AS note,
              e.payload->>'link_path'         AS link_path,
              e.payload->>'excerpt'           AS excerpt,
              e.payload->>'category'          AS category,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS resolved_at,
              (seen.seen_through IS NULL OR e.occurred_at > seen.seen_through) AS unread
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       CROSS JOIN seen
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'assistant.feedback_resolved'
         AND e.payload->>'recipient_actor_id' = $2
       ORDER BY e.occurred_at DESC
       LIMIT 50`,
      [ctx.tenantId, ctx.actorId],
    )
    const items: NotificationItem[] = res.rows.map((r) => ({
      eventId: r.event_id,
      feedbackEventId: r.feedback_event_id,
      note: r.note,
      linkPath: r.link_path,
      excerpt: r.excerpt ?? '',
      category: (r.category as FeedbackCategory) ?? 'other',
      resolvedAt: r.resolved_at,
      unread: r.unread,
    }))
    return { items, unreadCount: items.filter((i) => i.unread).length }
  })
}

// Mark the actor's notifications seen (records a notification.seen). Called when
// the attorney opens the bell — its occurred_at (DB clock) becomes the "seen
// through" line listMyNotifications compares against, clearing the unread badge.
export async function markNotificationsSeen(ctx: ActionContext): Promise<{ eventId: string }> {
  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'reflection',
    payload: {
      event_kind_name: 'notification.seen',
      primary_entity_id: null,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: { via: 'bell' },
    },
  })
  const eventId = (res.effects[0] as { eventId: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

interface LoadedFeedback {
  message: string
  category: string | null
  kind: string
  sourceRef: string
  primaryEntityId: string | null
  linkPath: string | null
}

// Load an assistant.turn event and pull out the bits resolution needs.
async function loadFeedbackEvent(
  ctx: ActionContext,
  eventId: string,
): Promise<LoadedFeedback | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      message: string | null
      category: string | null
      kind: string | null
      source_ref: string
      primary_entity_id: string | null
      link_path: string | null
    }>(
      `SELECT e.payload->>'message'  AS message,
              e.payload->>'category' AS category,
              e.payload->>'kind'     AS kind,
              e.source_ref           AS source_ref,
              e.primary_entity_id    AS primary_entity_id,
              e.payload->'page_context'->>'path' AS link_path
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'assistant.turn'`,
      [ctx.tenantId, eventId],
    )
    const r = res.rows[0]
    if (!r) return null
    return {
      message: r.message ?? '',
      category: r.category,
      kind: r.kind ?? '',
      sourceRef: r.source_ref,
      primaryEntityId: r.primary_entity_id,
      linkPath: r.link_path,
    }
  })
}
