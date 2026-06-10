// Reasoning, causality, contestation, access-log write paths (invariants 19, 20,
// 21). causal_claim / fact_contestation / reasoning_trace / access_log are
// append-only; contestation status transitions are new superseding rows.
import { randomUUID } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'

registerActionHandler('causal.claim', async (ctx, client, payload, actionId) => {
  const p = payload as {
    cause_kind: string
    cause_id: string
    effect_kind: string
    effect_id: string
    claim_kind: string
    confidence: number
    reasoning?: string
    evidence?: unknown[]
    source_type?: string
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO causal_claim (id, tenant_id, action_id, cause_kind, cause_id, effect_kind, effect_id, claim_kind, asserter_actor_id, confidence, reasoning, evidence, source_type, source_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.cause_kind,
      p.cause_id,
      p.effect_kind,
      p.effect_id,
      p.claim_kind,
      ctx.actorId,
      p.confidence,
      p.reasoning ?? null,
      JSON.stringify(p.evidence ?? []),
      p.source_type ?? 'agent',
      ctx.actorId,
    ],
  )
  return { causalClaimId: id }
})

registerActionHandler('contestation.open', async (ctx, client, payload, actionId) => {
  const p = payload as {
    contested_fact_kind: string
    contested_fact_id: string
    conflicting_fact_id?: string
    contestation_kind: string
    detected_by?: string
  }
  const id = randomUUID()
  const groupId = randomUUID()
  await client.query(
    `INSERT INTO fact_contestation (id, tenant_id, action_id, contestation_group_id, contested_fact_kind, contested_fact_id, conflicting_fact_id, contestation_kind, status, detected_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)`,
    [
      id,
      ctx.tenantId,
      actionId,
      groupId,
      p.contested_fact_kind,
      p.contested_fact_id,
      p.conflicting_fact_id ?? null,
      p.contestation_kind,
      p.detected_by ?? 'system',
    ],
  )
  return { contestationId: id, contestationGroupId: groupId }
})

registerActionHandler('contestation.update', async (ctx, client, payload, actionId) => {
  // Append a new row in the same group with the new status (append-only).
  const p = payload as {
    contestation_group_id: string
    status: string
    resolution?: Record<string, unknown>
  }
  const prev = await client.query<{
    id: string
    contested_fact_kind: string
    contested_fact_id: string
    conflicting_fact_id: string | null
    contestation_kind: string
    detected_by: string
  }>(
    `SELECT id, contested_fact_kind, contested_fact_id, conflicting_fact_id, contestation_kind, detected_by
       FROM fact_contestation
      WHERE tenant_id = $1 AND contestation_group_id = $2
      ORDER BY recorded_at DESC LIMIT 1`,
    [ctx.tenantId, p.contestation_group_id],
  )
  const head = prev.rows[0]
  if (!head) throw new Error(`Contestation group not found: ${p.contestation_group_id}`)
  const id = randomUUID()
  await client.query(
    `INSERT INTO fact_contestation (id, tenant_id, action_id, contestation_group_id, supersedes_id, contested_fact_kind, contested_fact_id, conflicting_fact_id, contestation_kind, status, detected_by, resolution, resolved_by_actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.contestation_group_id,
      head.id,
      head.contested_fact_kind,
      head.contested_fact_id,
      head.conflicting_fact_id,
      head.contestation_kind,
      p.status,
      head.detected_by,
      p.resolution ? JSON.stringify(p.resolution) : null,
      p.status === 'resolved' ? ctx.actorId : null,
    ],
  )
  return { contestationId: id, status: p.status }
})

registerActionHandler('reasoning.capture', async (ctx, client, payload) => {
  const p = payload as {
    prompt: string
    conclusion: string
    confidence: number
    evidence?: unknown[]
    alternatives?: unknown[]
    model_identity?: string
    trace?: Record<string, unknown>
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO reasoning_trace (id, tenant_id, agent_actor_id, prompt, evidence, alternatives, conclusion, confidence, model_identity, trace)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10::jsonb)`,
    [
      id,
      ctx.tenantId,
      ctx.actorId,
      p.prompt,
      JSON.stringify(p.evidence ?? []),
      JSON.stringify(p.alternatives ?? []),
      p.conclusion,
      p.confidence,
      p.model_identity ?? null,
      JSON.stringify(p.trace ?? {}),
    ],
  )
  return { reasoningTraceId: id }
})

registerActionHandler('access.record', async (ctx, client, payload) => {
  const p = payload as {
    accessed_kind: string
    accessed_id?: string
    query_summary?: string
    authorization_scope?: string
    purpose_ref?: string
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO access_log (id, tenant_id, actor_id, accessed_kind, accessed_id, query_summary, authorization_scope, purpose_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      ctx.tenantId,
      ctx.actorId,
      p.accessed_kind,
      p.accessed_id ?? null,
      p.query_summary ?? null,
      p.authorization_scope ?? null,
      p.purpose_ref ?? null,
    ],
  )
  return { accessLogId: id }
})
