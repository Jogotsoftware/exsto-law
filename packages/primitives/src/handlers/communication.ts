// Communication & stakeholder write paths. Messages are append-only events that
// reference a thread; stakeholder positions are temporal (superseded).
import { randomUUID } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'

registerActionHandler('thread.start', async (ctx, client, payload, actionId) => {
  const p = payload as {
    thread_kind: string
    subject?: string
    participants?: unknown[]
    related_entity_ids?: string[]
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO communication_thread (id, tenant_id, action_id, thread_kind, subject, participants, related_entity_ids)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.thread_kind,
      p.subject ?? null,
      JSON.stringify(p.participants ?? []),
      p.related_entity_ids ?? [],
    ],
  )
  return { threadId: id }
})

registerActionHandler('message.append', async (ctx, client, payload, actionId) => {
  const p = payload as {
    thread_id: string
    body_preview?: string
    body_blob_id?: string
    sender_entity_id?: string
    payload?: Record<string, unknown>
    source_type?: string
    occurred_at?: string
    occurred_at_precision?: string
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO communication_message (id, tenant_id, action_id, thread_id, sender_actor_id, sender_entity_id, body_blob_id, body_preview, payload, source_type, source_ref, occurred_at, occurred_at_precision)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,COALESCE($12::timestamptz, now()),$13)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.thread_id,
      ctx.actorId,
      p.sender_entity_id ?? null,
      p.body_blob_id ?? null,
      p.body_preview ?? null,
      JSON.stringify(p.payload ?? {}),
      p.source_type ?? 'human',
      ctx.actorId,
      p.occurred_at ?? null,
      p.occurred_at_precision ?? 'exact_instant',
    ],
  )
  return { messageId: id }
})

registerActionHandler('stakeholder.set', async (ctx, client, payload, actionId) => {
  const p = payload as {
    subject_entity_id: string
    stakeholder_entity_id: string
    position_role: string
    stance?: string
    influence?: number
    confidence?: number
    source_type?: string
  }
  // Supersede the prior open position for this stakeholder on this subject.
  await client.query(
    `UPDATE stakeholder_position SET valid_to = now()
      WHERE tenant_id = $1 AND subject_entity_id = $2 AND stakeholder_entity_id = $3 AND valid_to IS NULL`,
    [ctx.tenantId, p.subject_entity_id, p.stakeholder_entity_id],
  )
  const id = randomUUID()
  await client.query(
    `INSERT INTO stakeholder_position (id, tenant_id, action_id, subject_entity_id, stakeholder_entity_id, position_role, stance, influence, confidence, source_type, source_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.subject_entity_id,
      p.stakeholder_entity_id,
      p.position_role,
      p.stance ?? 'neutral',
      p.influence ?? null,
      p.confidence ?? 1.0,
      p.source_type ?? 'human',
      ctx.actorId,
    ],
  )
  return { stakeholderPositionId: id }
})
