// Generic substrate action handlers for the core primitives that did not yet
// have a write path: entity lifecycle, attribute supersession, relationship
// close, event/judgment/outcome recording, identity assertion. Additive to the
// existing entity.create / attribute.create / relationship.create handlers.
// Every handler runs inside submitAction's transaction so its writes commit
// atomically with the action row (invariant 9).
import { randomUUID } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'
import { nextHlc } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute } from './entity.js'

async function lookupKindId(
  client: DbClient,
  table: string,
  tenantId: string,
  kindName: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM ${table}
     WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active'
     ORDER BY valid_from DESC LIMIT 1`,
    [tenantId, kindName],
  )
  if (result.rowCount === 0 || !result.rows[0]) {
    throw new Error(`Kind not found in ${table}: ${kindName}`)
  }
  return result.rows[0].id
}

// ---------------------------------------------------------------------------
// entity.update — mutate an entity's core fields (name / status / metadata).
// ---------------------------------------------------------------------------
interface EntityUpdatePayload {
  entity_id: string
  name?: string
  status?: 'active' | 'archived' | 'suspended'
  metadata?: Record<string, unknown>
}

registerActionHandler('entity.update', async (ctx, client, payload) => {
  const p = payload as unknown as EntityUpdatePayload
  const result = await client.query(
    `UPDATE entity
       SET name = COALESCE($3, name),
           status = COALESCE($4, status),
           metadata = COALESCE($5::jsonb, metadata)
     WHERE tenant_id = $1 AND id = $2`,
    [
      ctx.tenantId,
      p.entity_id,
      p.name ?? null,
      p.status ?? null,
      p.metadata ? JSON.stringify(p.metadata) : null,
    ],
  )
  if (result.rowCount === 0) throw new Error(`Entity not found: ${p.entity_id}`)
  return { entityId: p.entity_id }
})

// ---------------------------------------------------------------------------
// entity.archive — soft-archive (reversible via entity.create per the kind def).
// ---------------------------------------------------------------------------
registerActionHandler('entity.archive', async (ctx, client, payload) => {
  const p = payload as unknown as { entity_id: string }
  const result = await client.query(
    `UPDATE entity SET status = 'archived' WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, p.entity_id],
  )
  if (result.rowCount === 0) throw new Error(`Entity not found: ${p.entity_id}`)
  return { entityId: p.entity_id, status: 'archived' }
})

// ---------------------------------------------------------------------------
// attribute.set — record a new observation, closing the prior open value of the
// same kind (temporal supersession, invariant 2). This is the canonical write
// for "the value is now X"; attribute.create remains for raw appends.
// ---------------------------------------------------------------------------
interface AttributeSetPayload {
  entity_id: string
  attribute_kind_name: string
  value: unknown
  confidence: number
  knowability_state: string
  time_precision: string
  source_type?: string
  source_ref?: string
}

registerActionHandler('attribute.set', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as AttributeSetPayload
  const attributeKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    p.attribute_kind_name,
  )
  // Close any currently-open observation of this kind on this entity.
  await client.query(
    `UPDATE attribute SET valid_to = now()
     WHERE tenant_id = $1 AND entity_id = $2 AND attribute_kind_id = $3 AND valid_to IS NULL`,
    [ctx.tenantId, p.entity_id, attributeKindId],
  )
  const attributeId = await insertAttribute(
    client,
    ctx.tenantId,
    actionId,
    p.entity_id,
    attributeKindId,
    p.value,
    p.confidence,
    p.knowability_state,
    p.time_precision,
    p.source_type ?? 'human',
    p.source_ref ?? ctx.actorId,
  )
  return { attributeId }
})

// ---------------------------------------------------------------------------
// relationship.close — end a relationship's validity (invariant 2).
// ---------------------------------------------------------------------------
registerActionHandler('relationship.close', async (ctx, client, payload) => {
  const p = payload as unknown as { relationship_id: string }
  const result = await client.query(
    `UPDATE relationship SET valid_to = now()
     WHERE tenant_id = $1 AND id = $2 AND valid_to IS NULL`,
    [ctx.tenantId, p.relationship_id],
  )
  if (result.rowCount === 0) throw new Error(`Open relationship not found: ${p.relationship_id}`)
  return { relationshipId: p.relationship_id }
})

// ---------------------------------------------------------------------------
// event.record — append an immutable event with its own HLC (invariants 14, 15).
// ---------------------------------------------------------------------------
interface EventRecordPayload {
  event_kind_name: string
  primary_entity_id?: string
  secondary_entity_ids?: string[]
  data?: Record<string, unknown>
  confidence?: number
  source_type?: string
  source_ref?: string
  occurred_at?: string
  occurred_at_precision?: string
}

registerActionHandler('event.record', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EventRecordPayload
  const eventKindId = await lookupKindId(
    client,
    'event_kind_definition',
    ctx.tenantId,
    p.event_kind_name,
  )
  const hlc = nextHlc()
  const eventId = randomUUID()
  await client.query(
    `INSERT INTO event (
       id, tenant_id, action_id, event_kind_id, primary_entity_id,
       secondary_entity_ids, payload, confidence, source_type, source_ref,
       occurred_at, occurred_at_precision,
       hlc_physical_time, hlc_logical_counter, hlc_source_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,
              COALESCE($11::timestamptz, now()),$12,$13,$14,$15)`,
    [
      eventId,
      ctx.tenantId,
      actionId,
      eventKindId,
      p.primary_entity_id ?? null,
      p.secondary_entity_ids ?? [],
      JSON.stringify(p.data ?? {}),
      p.confidence ?? 1.0,
      p.source_type ?? 'human',
      p.source_ref ?? ctx.actorId,
      p.occurred_at ?? null,
      p.occurred_at_precision ?? 'exact_instant',
      hlc.physical_time,
      hlc.logical_counter,
      hlc.source_id,
    ],
  )
  return { eventId }
})

// ---------------------------------------------------------------------------
// judgment.record — a qualitative assessment about an entity (invariants 6, 20).
// ---------------------------------------------------------------------------
interface JudgmentRecordPayload {
  subject_entity_id: string
  judgment_kind_name: string
  value: unknown
  confidence: number
  evidence?: unknown[]
  reasoning?: string
  reasoning_trace_id?: string
  source_type?: string
  polarity?: 'positive' | 'negative'
}

registerActionHandler('judgment.record', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as JudgmentRecordPayload
  const judgmentKindId = await lookupKindId(
    client,
    'judgment_kind_definition',
    ctx.tenantId,
    p.judgment_kind_name,
  )
  const judgmentId = randomUUID()
  await client.query(
    `INSERT INTO judgment (
       id, tenant_id, action_id, judgment_kind_id, subject_entity_id,
       judging_actor_id, value, confidence, evidence, reasoning,
       reasoning_trace_id, source_type, source_ref, polarity
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13,$14)`,
    [
      judgmentId,
      ctx.tenantId,
      actionId,
      judgmentKindId,
      p.subject_entity_id,
      ctx.actorId,
      JSON.stringify(p.value ?? null),
      p.confidence,
      JSON.stringify(p.evidence ?? []),
      p.reasoning ?? null,
      p.reasoning_trace_id ?? null,
      p.source_type ?? 'human',
      ctx.actorId,
      p.polarity ?? 'positive',
    ],
  )
  return { judgmentId }
})

// ---------------------------------------------------------------------------
// outcome.record — a realized result for an entity (validation signal, ADR 0028).
// ---------------------------------------------------------------------------
interface OutcomeRecordPayload {
  subject_entity_id: string
  outcome_kind_name: string
  outcome_data?: Record<string, unknown>
  polarity?: 'positive' | 'negative' | 'neutral'
  confidence?: number
  evidence?: unknown[]
  source_type?: string
  occurred_at?: string
  occurred_at_precision?: string
}

registerActionHandler('outcome.record', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as OutcomeRecordPayload
  const outcomeKindId = await lookupKindId(
    client,
    'outcome_kind_definition',
    ctx.tenantId,
    p.outcome_kind_name,
  )
  const outcomeId = randomUUID()
  await client.query(
    `INSERT INTO outcome (
       id, tenant_id, action_id, outcome_kind_id, subject_entity_id,
       outcome_data, polarity, confidence, evidence, source_type, source_ref,
       occurred_at, occurred_at_precision
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,
              COALESCE($12::timestamptz, now()),$13)`,
    [
      outcomeId,
      ctx.tenantId,
      actionId,
      outcomeKindId,
      p.subject_entity_id,
      JSON.stringify(p.outcome_data ?? {}),
      p.polarity ?? 'neutral',
      p.confidence ?? 1.0,
      JSON.stringify(p.evidence ?? []),
      p.source_type ?? 'human',
      ctx.actorId,
      p.occurred_at ?? null,
      p.occurred_at_precision ?? 'exact_instant',
    ],
  )
  return { outcomeId }
})

// ---------------------------------------------------------------------------
// identity.assert — non-destructive identity assertion (invariant 4).
// ---------------------------------------------------------------------------
interface IdentityAssertPayload {
  assertion_kind: 'same_as' | 'different_from' | 'related_to'
  entity_a_id: string
  entity_b_id: string
  confidence: number
  evidence?: unknown[]
  source_type?: string
  supersedes_id?: string
}

registerActionHandler('identity.assert', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as IdentityAssertPayload
  const assertionId = randomUUID()
  await client.query(
    `INSERT INTO identity_assertion (
       id, tenant_id, action_id, assertion_kind, entity_a_id, entity_b_id,
       confidence, evidence, asserter_actor_id, source_type, source_ref, supersedes_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)`,
    [
      assertionId,
      ctx.tenantId,
      actionId,
      p.assertion_kind,
      p.entity_a_id,
      p.entity_b_id,
      p.confidence,
      JSON.stringify(p.evidence ?? []),
      ctx.actorId,
      p.source_type ?? 'human',
      ctx.actorId,
      p.supersedes_id ?? null,
    ],
  )
  return { assertionId }
})
