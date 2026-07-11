// HARDENING-RESIDUALS-1 (WP-D item 2) — general-assistant conversation
// persistence. One conversation in the assistant widget = ONE
// assistant_chat_session entity (runtime kinds, see
// demo/seed-assistant-session-kinds.ts): started on the conversation's first
// turn, closed when the attorney starts a new chat or the conversation is
// finished. The turns themselves stay assistant.turn events — the session id
// rides in the turn payload (chat_session_id), so no message rows are
// duplicated (unlike service_build_session, whose message events exist to
// scope a BUILD's audit record; a general chat's record IS the turn events).
//
// DECISION (briefed): a DISTINCT kind, not a generalization of
// service_build_session. Build sessions carry build-specific lifecycle
// (service key stamping, enable-closes-it, receipts key on the kind_name);
// reusing the row-space would make every build query and receipt ambiguous.
// The PATTERN is reused; the kind is separate.
//
// Everything flows through EXISTING core actions (entity.create /
// attribute.set / event.record) — no new action kinds needed.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { stripMachinerySpans } from './assistantMachinery.js'

const SESSION_KIND = 'assistant_chat_session'
const TITLE_CAP = 80

export type ChatSessionScope = 'global' | 'matter' | 'contact'

export interface ChatSessionSummary {
  chatSessionId: string
  title: string
  scope: ChatSessionScope
  scopeEntityId: string | null
  status: 'open' | 'closed'
  startedAt: string
  lastMessageAt: string | null
  turnCount: number
}

export async function startChatSession(
  ctx: ActionContext,
  input: { firstMessage: string; scope: ChatSessionScope; scopeEntityId?: string | null },
): Promise<{ chatSessionId: string }> {
  // WP-D6: strip ⟦…⟧ orchestration machinery BEFORE titling — a hidden priming/
  // wrap-up continuation sent while buildMode is momentarily false can reach this
  // path as a conversation's first message, and its raw driver text must never
  // become the session title shown in the conversation switcher.
  const title =
    stripMachinerySpans(input.firstMessage).replace(/\s+/g, ' ').trim().slice(0, TITLE_CAP) ||
    'Conversation'
  const created = await submitAction(ctx, {
    actionKindName: 'entity.create',
    intentKind: 'exploration',
    payload: {
      entity_kind_name: SESSION_KIND,
      name: title,
      attributes: [
        {
          attributeKindName: 'chat_session_status',
          value: 'open',
          confidence: 1.0,
          knowabilityState: 'observed',
          timePrecision: 'exact_instant',
          sourceType: 'human',
          sourceRef: ctx.actorId,
        },
        {
          attributeKindName: 'chat_session_scope',
          value: input.scope,
          confidence: 1.0,
          knowabilityState: 'observed',
          timePrecision: 'exact_instant',
          sourceType: 'human',
          sourceRef: ctx.actorId,
        },
        ...(input.scopeEntityId
          ? [
              {
                attributeKindName: 'chat_session_scope_entity',
                value: input.scopeEntityId,
                confidence: 1.0,
                knowabilityState: 'observed' as const,
                timePrecision: 'exact_instant' as const,
                sourceType: 'human' as const,
                sourceRef: ctx.actorId,
              },
            ]
          : []),
      ],
    },
  })
  const chatSessionId = (created.effects[0] as { entityId?: string })?.entityId
  if (!chatSessionId) throw new Error('entity.create returned no entityId for the chat session.')
  await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'exploration',
    payload: {
      event_kind_name: 'assistant.chat_session.started',
      primary_entity_id: chatSessionId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: { scope: input.scope, scope_entity_id: input.scopeEntityId ?? null },
    },
  })
  return { chatSessionId }
}

export async function closeChatSession(ctx: ActionContext, chatSessionId: string): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'attribute.set',
    intentKind: 'adjustment',
    payload: {
      entity_id: chatSessionId,
      attribute_kind_name: 'chat_session_status',
      value: 'closed',
      confidence: 1.0,
      knowability_state: 'observed',
      time_precision: 'exact_instant',
      source_type: 'human',
      source_ref: ctx.actorId,
    },
  })
  await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'adjustment',
    payload: {
      event_kind_name: 'assistant.chat_session.closed',
      primary_entity_id: chatSessionId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: {},
    },
  })
}

// True when the id names an OPEN assistant_chat_session in this tenant — the
// chat path calls this so a stale client-held id (closed session, foreign row)
// starts a fresh conversation instead of appending to the wrong one.
export async function isOpenChatSession(
  ctx: ActionContext,
  chatSessionId: string,
): Promise<boolean> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ status: string | null }>(
      `SELECT (
         SELECT a.value #>> '{}'
           FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
            AND akd.kind_name = 'chat_session_status'
          ORDER BY a.valid_from DESC LIMIT 1
       ) AS status
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
      WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = $3 AND e.status = 'active'`,
      [ctx.tenantId, chatSessionId, SESSION_KIND],
    )
    return r.rows[0]?.status === 'open'
  })
}

// The attorney's conversations, most-recent-activity first — powers the
// conversation switcher. Turn counts come from assistant.turn events carrying
// this session's id in their payload (one event = one exchange). The turn
// stats are ONE grouped pass over the tenant's assistant.turn events (not a
// per-row correlated scan), and the per-session attribute reads are entity-
// scoped indexed lookups — no tenant-wide attribute pivot (HOTFIX-ATTR-PIVOT).
export async function listChatSessions(ctx: ActionContext): Promise<ChatSessionSummary[]> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{
      id: string
      name: string
      started_at: string
      status: string | null
      scope: string | null
      scope_entity: string | null
      turn_count: number
      last_at: string | null
    }>(
      `WITH turns AS (
         SELECT ev.payload->>'chat_session_id' AS sid,
                count(*)::int AS turn_count,
                max(ev.occurred_at) AS last_at
         FROM event ev
         JOIN event_kind_definition ek ON ek.id = ev.event_kind_id
         WHERE ev.tenant_id = $1 AND ek.kind_name = 'assistant.turn'
           AND ev.payload ? 'chat_session_id'
         GROUP BY 1
       )
       SELECT e.id, e.name,
              to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS started_at,
              (SELECT a.value #>> '{}' FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
                  AND akd.kind_name = 'chat_session_status'
                ORDER BY a.valid_from DESC LIMIT 1) AS status,
              (SELECT a.value #>> '{}' FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
                  AND akd.kind_name = 'chat_session_scope'
                ORDER BY a.valid_from DESC LIMIT 1) AS scope,
              (SELECT a.value #>> '{}' FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
                  AND akd.kind_name = 'chat_session_scope_entity'
                ORDER BY a.valid_from DESC LIMIT 1) AS scope_entity,
              COALESCE(t.turn_count, 0) AS turn_count,
              to_char(t.last_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS last_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       LEFT JOIN turns t ON t.sid = e.id::text
       WHERE e.tenant_id = $1 AND ekd.kind_name = $2 AND e.status = 'active'
       ORDER BY COALESCE(t.last_at, e.created_at) DESC
       LIMIT 40`,
      [ctx.tenantId, SESSION_KIND],
    )
    return r.rows.map((row) => ({
      chatSessionId: row.id,
      title: row.name,
      scope: (row.scope as ChatSessionScope | null) ?? 'global',
      scopeEntityId: row.scope_entity ?? null,
      status: row.status === 'closed' ? 'closed' : 'open',
      startedAt: row.started_at,
      lastMessageAt: row.last_at,
      turnCount: row.turn_count,
    }))
  })
}
