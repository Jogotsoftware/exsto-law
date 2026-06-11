import { withActionContext, type ActionContext } from '@exsto/substrate'

// Matter audit surface (WP5): every button press and pipeline step visible as
// an action row with intent (REQ-AUDIT-01), plus the lifecycle event timeline.

export interface MatterActionEntry {
  actionId: string
  kindName: string
  intentKind: string
  autonomyTier: string
  actorName: string
  actorType: string
  hasReasoningTrace: boolean
  recordedAt: string
}

export interface MatterEventEntry {
  eventId: string
  kindName: string
  data: Record<string, unknown>
  occurredAt: string
}

export interface MatterHistory {
  actions: MatterActionEntry[]
  events: MatterEventEntry[]
}

export async function getMatterHistory(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<MatterHistory> {
  return withActionContext(ctx, async (client) => {
    const actions = await client.query<{
      action_id: string
      kind_name: string
      intent_kind: string
      autonomy_tier: string
      actor_name: string
      actor_type: string
      has_trace: boolean
      recorded_at: string
    }>(
      `SELECT a.id AS action_id, akd.kind_name, a.intent_kind, a.autonomy_tier,
              act.display_name AS actor_name, act.actor_type,
              (a.reasoning_trace_id IS NOT NULL) AS has_trace,
              to_char(a.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS recorded_at
       FROM action a
       JOIN action_kind_definition akd ON akd.id = a.action_kind_id
       JOIN actor act ON act.id = a.actor_id
       WHERE a.tenant_id = $1 AND (
         a.payload->>'matter_entity_id' = $2
         OR a.payload->>'document_version_id' IN (
           SELECT dv.id::text
           FROM document_version dv
           JOIN relationship r ON r.source_entity_id = dv.document_entity_id
           JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
           WHERE dv.tenant_id = $1 AND rkd.kind_name = 'draft_of'
             AND r.target_entity_id = $2::uuid
         )
         -- intake.submit predates the matter id; matter.open back-references it.
         OR a.id::text IN (
           SELECT a2.payload->>'intake_action_id' FROM action a2
           WHERE a2.tenant_id = $1 AND a2.payload->>'matter_entity_id' = $2
             AND a2.payload->>'intake_action_id' IS NOT NULL
         )
       )
       ORDER BY a.recorded_at ASC`,
      [ctx.tenantId, matterEntityId],
    )

    const events = await client.query<{
      event_id: string
      kind_name: string
      payload: Record<string, unknown>
      occurred_at: string
    }>(
      `SELECT e.id AS event_id, ekd.kind_name, e.payload,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS occurred_at
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND (e.primary_entity_id = $2::uuid OR $2::uuid = ANY(e.secondary_entity_ids))
       ORDER BY e.occurred_at ASC`,
      [ctx.tenantId, matterEntityId],
    )

    return {
      actions: actions.rows.map((r) => ({
        actionId: r.action_id,
        kindName: r.kind_name,
        intentKind: r.intent_kind,
        autonomyTier: r.autonomy_tier,
        actorName: r.actor_name,
        actorType: r.actor_type,
        hasReasoningTrace: r.has_trace,
        recordedAt: r.recorded_at,
      })),
      events: events.rows.map((r) => ({
        eventId: r.event_id,
        kindName: r.kind_name,
        data: r.payload ?? {},
        occurredAt: r.occurred_at,
      })),
    }
  })
}
