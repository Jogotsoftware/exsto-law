import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { nextHlc } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'

export async function lookupKindId(
  client: DbClient,
  table:
    | 'entity_kind_definition'
    | 'attribute_kind_definition'
    | 'relationship_kind_definition'
    | 'event_kind_definition'
    | 'outcome_kind_definition',
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
    throw new Error(`${table} kind not found: ${kindName}`)
  }
  return result.rows[0].id
}

export async function insertEntity(
  client: DbClient,
  tenantId: string,
  actionId: string,
  entityKindId: string,
  name: string,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const entityId = randomUUID()
  await client.query(
    `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'active', $6::jsonb)`,
    [entityId, tenantId, actionId, entityKindId, name, JSON.stringify(metadata)],
  )
  return entityId
}

export async function insertAttribute(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    entityId: string
    attributeKindId: string
    value: unknown
    confidence: number
    knowabilityState?: string
    timePrecision?: string
    sourceType: 'human' | 'integration' | 'agent' | 'system'
    sourceRef: string | null
  },
): Promise<string> {
  const attributeId = randomUUID()
  await client.query(
    `INSERT INTO attribute (
       id, tenant_id, action_id, entity_id, attribute_kind_id, value,
       confidence, knowability_state, time_precision, source_type, source_ref
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      attributeId,
      args.tenantId,
      args.actionId,
      args.entityId,
      args.attributeKindId,
      JSON.stringify(args.value),
      args.confidence,
      args.knowabilityState ?? 'observed',
      args.timePrecision ?? 'exact_instant',
      args.sourceType,
      args.sourceRef,
    ],
  )
  return attributeId
}

export async function insertRelationship(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    sourceEntityId: string
    targetEntityId: string
    relationshipKindId: string
    properties?: Record<string, unknown>
  },
): Promise<string> {
  const relationshipId = randomUUID()
  await client.query(
    `INSERT INTO relationship (
       id, tenant_id, action_id, source_entity_id, target_entity_id,
       relationship_kind_id, properties
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      relationshipId,
      args.tenantId,
      args.actionId,
      args.sourceEntityId,
      args.targetEntityId,
      args.relationshipKindId,
      JSON.stringify(args.properties ?? {}),
    ],
  )
  return relationshipId
}

// Append an immutable lifecycle event inside the current action's transaction.
// Mirrors the generic event.record primitive's insert (invariants 14, 15).
export async function insertEvent(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    eventKindName: string
    primaryEntityId?: string | null
    secondaryEntityIds?: string[]
    data?: Record<string, unknown>
    sourceType?: 'human' | 'integration' | 'agent' | 'system'
    sourceRef?: string | null
    occurredAt?: string | null
  },
): Promise<string> {
  const eventKindId = await lookupKindId(
    client,
    'event_kind_definition',
    args.tenantId,
    args.eventKindName,
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
      args.tenantId,
      args.actionId,
      eventKindId,
      args.primaryEntityId ?? null,
      args.secondaryEntityIds ?? [],
      JSON.stringify(args.data ?? {}),
      1.0,
      args.sourceType ?? 'human',
      args.sourceRef ?? null,
      args.occurredAt ?? null,
      'exact_instant',
      hlc.physical_time,
      hlc.logical_counter,
      hlc.source_id,
    ],
  )
  return eventId
}

// Record a realized outcome about an entity (e.g. a draft review decision).
export async function insertOutcome(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    outcomeKindName: string
    subjectEntityId: string
    polarity: 'positive' | 'neutral' | 'negative'
    data?: Record<string, unknown>
    sourceType?: 'human' | 'integration' | 'agent' | 'system'
    sourceRef?: string | null
  },
): Promise<string> {
  const outcomeKindId = await lookupKindId(
    client,
    'outcome_kind_definition',
    args.tenantId,
    args.outcomeKindName,
  )
  const id = randomUUID()
  await client.query(
    `INSERT INTO outcome (
       id, tenant_id, action_id, outcome_kind_id, subject_entity_id,
       outcome_data, polarity, confidence, evidence, source_type, source_ref,
       occurred_at, occurred_at_precision
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11, now(), 'exact_instant')`,
    [
      id,
      args.tenantId,
      args.actionId,
      outcomeKindId,
      args.subjectEntityId,
      JSON.stringify(args.data ?? {}),
      args.polarity,
      1.0,
      JSON.stringify([]),
      args.sourceType ?? 'human',
      args.sourceRef ?? null,
    ],
  )
  return id
}

export async function insertContentBlob(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    contentType: string
    body: string
  },
): Promise<string> {
  const id = randomUUID()
  const sha = createHash('sha256').update(args.body, 'utf8').digest()
  await client.query(
    `INSERT INTO content_blob (id, tenant_id, action_id, content_type, body, sha256, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      args.tenantId,
      args.actionId,
      args.contentType,
      args.body,
      sha,
      Buffer.byteLength(args.body, 'utf8'),
    ],
  )
  return id
}

export async function insertDocumentVersion(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    documentEntityId: string
    contentBlobId: string
    versionNumber: number
    status: 'pending_review' | 'approved' | 'revision_requested' | 'rejected' | 'superseded'
    reasoningTraceId: string | null
    metadata?: Record<string, unknown>
  },
): Promise<string> {
  const id = randomUUID()
  await client.query(
    `INSERT INTO document_version (
       id, tenant_id, action_id, document_entity_id, content_blob_id,
       version_number, status, reasoning_trace_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      id,
      args.tenantId,
      args.actionId,
      args.documentEntityId,
      args.contentBlobId,
      args.versionNumber,
      args.status,
      args.reasoningTraceId,
      JSON.stringify(args.metadata ?? {}),
    ],
  )
  return id
}

export async function getRelatedEntityIds(
  client: DbClient,
  tenantId: string,
  sourceEntityId: string,
  relationshipKindName: string,
): Promise<string[]> {
  const result = await client.query<{ target_entity_id: string }>(
    `SELECT r.target_entity_id
     FROM relationship r
     JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
     WHERE r.tenant_id = $1
       AND r.source_entity_id = $2
       AND rkd.kind_name = $3
       AND (r.valid_to IS NULL OR r.valid_to > now())
     ORDER BY r.recorded_at DESC`,
    [tenantId, sourceEntityId, relationshipKindName],
  )
  return result.rows.map((row) => row.target_entity_id)
}

export async function getLatestAttributeValue<T = unknown>(
  client: DbClient,
  tenantId: string,
  entityId: string,
  attributeKindName: string,
): Promise<T | null> {
  const result = await client.query<{ value: T }>(
    `SELECT a.value
     FROM attribute a
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1
       AND a.entity_id = $2
       AND akd.kind_name = $3
       AND (a.valid_to IS NULL OR a.valid_to > now())
     ORDER BY a.valid_from DESC
     LIMIT 1`,
    [tenantId, entityId, attributeKindName],
  )
  return result.rows[0]?.value ?? null
}
