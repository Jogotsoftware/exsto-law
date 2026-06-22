// Beta-feedback "claimed / in-progress" status (migration 0089). Lets a session
// mark a feedback item in-progress so parallel sessions don't pick up the same
// thing, and release it if abandoned — giving a three-state backlog
// (open → in_progress → resolved). Mirrors feedbackNotifications.ts: writes go
// through the generic event.record action; reads are tenant-scoped queries. New
// file (not feedbackNotifications.ts) so it never collides with the in-flight
// feedback-notifications work.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

export interface ClaimFeedbackInput {
  // The assistant.turn (kind=feedback) event id.
  feedbackEventId: string
  // Who is taking it — a branch / session / PR label, e.g. 'feat/calendar-grid'.
  claimedBy: string
  note?: string
}

export interface ReleaseFeedbackInput {
  feedbackEventId: string
  releasedBy: string
  note?: string
}

interface LoadedFeedback {
  message: string
  category: string | null
  kind: string
  primaryEntityId: string | null
}

async function loadFeedbackTurn(
  ctx: ActionContext,
  eventId: string,
): Promise<LoadedFeedback | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      message: string | null
      category: string | null
      kind: string | null
      primary_entity_id: string | null
    }>(
      `SELECT e.payload->>'message'  AS message,
              e.payload->>'category' AS category,
              e.payload->>'kind'     AS kind,
              e.primary_entity_id    AS primary_entity_id
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
      primaryEntityId: r.primary_entity_id,
    }
  })
}

// Claim a feedback item (mark it in-progress). Idempotent in effect — re-claiming
// just records a newer claim; the latest claim wins.
export async function claimFeedback(
  ctx: ActionContext,
  input: ClaimFeedbackInput,
): Promise<{ eventId: string }> {
  if (!input.claimedBy?.trim()) throw new Error('claimedBy is required (a branch/session label).')
  const original = await loadFeedbackTurn(ctx, input.feedbackEventId)
  if (!original) throw new Error('Feedback not found.')
  if (original.kind !== 'feedback') throw new Error('That event is not beta feedback.')
  const message = original.message ?? ''
  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'reflection',
    payload: {
      event_kind_name: 'assistant.feedback_claimed',
      primary_entity_id: original.primaryEntityId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: {
        feedback_event_id: input.feedbackEventId,
        claimed_by: input.claimedBy.trim(),
        note: input.note?.trim() || null,
        excerpt: message.length > 140 ? `${message.slice(0, 140)}…` : message,
        category: original.category ?? 'other',
      },
    },
  })
  const eventId = (res.effects[0] as { eventId: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

// Release a claim (return the item to the open pool).
export async function releaseFeedback(
  ctx: ActionContext,
  input: ReleaseFeedbackInput,
): Promise<{ eventId: string }> {
  if (!input.releasedBy?.trim()) throw new Error('releasedBy is required.')
  const original = await loadFeedbackTurn(ctx, input.feedbackEventId)
  if (!original) throw new Error('Feedback not found.')
  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'reflection',
    payload: {
      event_kind_name: 'assistant.feedback_released',
      primary_entity_id: original.primaryEntityId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: {
        feedback_event_id: input.feedbackEventId,
        released_by: input.releasedBy.trim(),
        note: input.note?.trim() || null,
      },
    },
  })
  const eventId = (res.effects[0] as { eventId: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

export type FeedbackStatus = 'open' | 'in_progress' | 'resolved'

export interface BacklogItem {
  feedbackEventId: string
  status: FeedbackStatus
  // Set only when status === 'in_progress'.
  claimedBy: string | null
  category: string
  linkPath: string | null
  excerpt: string
  submittedAt: string
}

// The beta-feedback backlog with derived three-state status. A session calls this
// BEFORE picking up work, filters to open (or in_progress to see who has what),
// and claims an open item so others skip it. resolved always wins; otherwise an
// item is in_progress while its latest claim post-dates its latest release.
export async function listFeedbackBacklog(
  ctx: ActionContext,
  opts: { status?: FeedbackStatus } = {},
): Promise<{ items: BacklogItem[]; counts: Record<FeedbackStatus, number> }> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      feedback_event_id: string
      status: FeedbackStatus
      claimed_by: string | null
      category: string | null
      link_path: string | null
      excerpt: string | null
      submitted_at: string
    }>(
      `WITH fb AS (
         SELECT e.id, e.occurred_at,
                e.payload->>'message'  AS message,
                e.payload->>'category' AS category,
                e.payload->'page_context'->>'path' AS link_path
         FROM event e
         JOIN event_kind_definition k ON k.id = e.event_kind_id
         WHERE e.tenant_id = $1 AND k.kind_name = 'assistant.turn'
           AND e.payload->>'kind' = 'feedback'
       ),
       resolved AS (
         SELECT DISTINCT e.payload->>'feedback_event_id' AS fid
         FROM event e JOIN event_kind_definition k ON k.id = e.event_kind_id
         WHERE e.tenant_id = $1 AND k.kind_name = 'assistant.feedback_resolved'
       ),
       latest_claim AS (
         SELECT DISTINCT ON (e.payload->>'feedback_event_id')
                e.payload->>'feedback_event_id' AS fid,
                e.occurred_at, e.payload->>'claimed_by' AS claimed_by
         FROM event e JOIN event_kind_definition k ON k.id = e.event_kind_id
         WHERE e.tenant_id = $1 AND k.kind_name = 'assistant.feedback_claimed'
         ORDER BY e.payload->>'feedback_event_id', e.occurred_at DESC
       ),
       latest_release AS (
         SELECT e.payload->>'feedback_event_id' AS fid, max(e.occurred_at) AS released_at
         FROM event e JOIN event_kind_definition k ON k.id = e.event_kind_id
         WHERE e.tenant_id = $1 AND k.kind_name = 'assistant.feedback_released'
         GROUP BY 1
       )
       SELECT fb.id AS feedback_event_id,
              CASE
                WHEN r.fid IS NOT NULL THEN 'resolved'
                WHEN c.fid IS NOT NULL AND (rel.released_at IS NULL OR c.occurred_at > rel.released_at)
                  THEN 'in_progress'
                ELSE 'open'
              END AS status,
              CASE
                WHEN r.fid IS NULL AND c.fid IS NOT NULL
                  AND (rel.released_at IS NULL OR c.occurred_at > rel.released_at)
                  THEN c.claimed_by
              END AS claimed_by,
              fb.category,
              fb.link_path,
              left(regexp_replace(fb.message, '\\s+', ' ', 'g'), 140) AS excerpt,
              to_char(fb.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS submitted_at
       FROM fb
       LEFT JOIN resolved r ON r.fid = fb.id::text
       LEFT JOIN latest_claim c ON c.fid = fb.id::text
       LEFT JOIN latest_release rel ON rel.fid = fb.id::text
       ORDER BY fb.occurred_at DESC`,
      [ctx.tenantId],
    )
    const all: BacklogItem[] = res.rows.map((r) => ({
      feedbackEventId: r.feedback_event_id,
      status: r.status,
      claimedBy: r.claimed_by,
      category: r.category ?? 'other',
      linkPath: r.link_path,
      excerpt: r.excerpt ?? '',
      submittedAt: r.submitted_at,
    }))
    const counts: Record<FeedbackStatus, number> = { open: 0, in_progress: 0, resolved: 0 }
    for (const i of all) counts[i.status]++
    const items = opts.status ? all.filter((i) => i.status === opts.status) : all
    return { items, counts }
  })
}
