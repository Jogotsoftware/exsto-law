// Identity & ingestion write paths. raw_event_log is the append-only bedrock that
// projection workers derive normalized state from (invariant 13).
import { randomUUID, createHash } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'
import { lookupKind } from './util.js'

registerActionHandler('raw_event.ingest', async (ctx, client, payload) => {
  const p = payload as {
    source_type: string
    source_ref: string
    external_id?: string
    payload: Record<string, unknown>
  }
  const body = JSON.stringify(p.payload ?? {})
  const hash = createHash('sha256').update(body, 'utf8').digest()
  const id = randomUUID()
  await client.query(
    `INSERT INTO raw_event_log (id, tenant_id, source_type, source_ref, external_id, payload, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [id, ctx.tenantId, p.source_type, p.source_ref, p.external_id ?? null, body, hash],
  )
  return { rawEventLogId: id }
})

registerActionHandler('source_record.link', async (ctx, client, payload, actionId) => {
  const p = payload as {
    entity_id: string
    source_system: string
    source_record_id: string
    is_identity_anchor?: boolean
    metadata?: Record<string, unknown>
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO source_record_link (id, tenant_id, action_id, entity_id, source_system, source_record_id, is_identity_anchor, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (tenant_id, source_system, source_record_id) DO NOTHING`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.entity_id,
      p.source_system,
      p.source_record_id,
      p.is_identity_anchor ?? false,
      JSON.stringify(p.metadata ?? {}),
    ],
  )
  return { sourceRecordLinkId: id }
})

registerActionHandler('integration_mapping.define', async (ctx, client, payload, actionId) => {
  const p = payload as {
    source_system: string
    source_field: string
    target_kind: string
    target_kind_name: string
    transformation?: Record<string, unknown>
    is_identity_anchor?: boolean
    is_relationship_anchor?: boolean
    contains_pii?: boolean
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO integration_mapping (id, tenant_id, action_id, source_system, source_field, target_kind, target_kind_name, transformation, is_identity_anchor, is_relationship_anchor, contains_pii)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.source_system,
      p.source_field,
      p.target_kind,
      p.target_kind_name,
      JSON.stringify(p.transformation ?? {}),
      p.is_identity_anchor ?? false,
      p.is_relationship_anchor ?? false,
      p.contains_pii ?? false,
    ],
  )
  return { integrationMappingId: id }
})

registerActionHandler('authoritative_source.designate', async (ctx, client, payload, actionId) => {
  const p = payload as {
    attribute_kind_name: string
    source_system: string
    filter_expression?: Record<string, unknown>
    priority?: number
  }
  const attributeKindId = await lookupKind(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    p.attribute_kind_name,
  )
  const id = randomUUID()
  await client.query(
    `INSERT INTO authoritative_source_designation (id, tenant_id, action_id, attribute_kind_id, source_system, filter_expression, priority)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      id,
      ctx.tenantId,
      actionId,
      attributeKindId,
      p.source_system,
      JSON.stringify(p.filter_expression ?? {}),
      p.priority ?? 0,
    ],
  )
  return { authoritativeSourceDesignationId: id }
})

registerActionHandler('conflict_rule.define', async (ctx, client, payload, actionId) => {
  const p = payload as {
    attribute_kind_name: string
    strategy?: string
    source_priority?: unknown[]
    human_override_window_seconds?: number
    config?: Record<string, unknown>
  }
  const attributeKindId = await lookupKind(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    p.attribute_kind_name,
  )
  const id = randomUUID()
  await client.query(
    `INSERT INTO conflict_resolution_rule (id, tenant_id, action_id, attribute_kind_id, strategy, source_priority, human_override_window_seconds, config)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)`,
    [
      id,
      ctx.tenantId,
      actionId,
      attributeKindId,
      p.strategy ?? 'highest_confidence',
      JSON.stringify(p.source_priority ?? []),
      p.human_override_window_seconds ?? null,
      JSON.stringify(p.config ?? {}),
    ],
  )
  return { conflictResolutionRuleId: id }
})
