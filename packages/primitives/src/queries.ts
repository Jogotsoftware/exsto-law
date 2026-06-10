// Generic read-side helpers over the core primitives. All run under the action
// context so RLS is engaged and reads see the caller's own writes (invariant 16).
import type { ActionContext } from '@exsto/substrate'
import { executeQuery } from '@exsto/substrate'

export interface EntityRow {
  id: string
  entity_kind_name: string
  name: string
  status: string
  metadata: Record<string, unknown>
  created_at: string
}

export async function getEntity(ctx: ActionContext, entityId: string): Promise<EntityRow | null> {
  const { rows } = await executeQuery<EntityRow>(
    ctx,
    `SELECT e.id, k.kind_name AS entity_kind_name, e.name, e.status, e.metadata, e.created_at
       FROM entity e JOIN entity_kind_definition k ON k.id = e.entity_kind_id
      WHERE e.tenant_id = $1 AND e.id = $2`,
    [ctx.tenantId, entityId],
  )
  return rows[0] ?? null
}

export async function listEntitiesByKind(
  ctx: ActionContext,
  entityKindName: string,
  limit = 100,
): Promise<EntityRow[]> {
  const { rows } = await executeQuery<EntityRow>(
    ctx,
    `SELECT e.id, k.kind_name AS entity_kind_name, e.name, e.status, e.metadata, e.created_at
       FROM entity e JOIN entity_kind_definition k ON k.id = e.entity_kind_id
      WHERE e.tenant_id = $1 AND k.kind_name = $2 AND e.status = 'active'
      ORDER BY e.created_at DESC LIMIT $3`,
    [ctx.tenantId, entityKindName, limit],
  )
  return rows
}

export interface CurrentAttributeRow {
  attribute_kind_name: string
  value: unknown
  confidence: number
  knowability_state: string
  time_precision: string
  source_type: string
  valid_from: string
}

// The current (open) attribute values for an entity: latest open row per kind.
export async function getCurrentAttributes(
  ctx: ActionContext,
  entityId: string,
): Promise<CurrentAttributeRow[]> {
  const { rows } = await executeQuery<CurrentAttributeRow>(
    ctx,
    `SELECT DISTINCT ON (a.attribute_kind_id)
            k.kind_name AS attribute_kind_name, a.value, a.confidence,
            a.knowability_state, a.time_precision, a.source_type, a.valid_from
       FROM attribute a JOIN attribute_kind_definition k ON k.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND a.valid_to IS NULL
      ORDER BY a.attribute_kind_id, a.valid_from DESC`,
    [ctx.tenantId, entityId],
  )
  return rows
}

export interface EntityWithAttributes {
  entity: EntityRow | null
  attributes: CurrentAttributeRow[]
}

// An entity plus its current attribute values — the light entity read. Lives in
// the core so every adapter (MCP `entity.get`, REST `GET /v1/entities/:id`)
// returns the identical shape and they cannot drift. For the full context bundle
// (relationships, events, judgments, outcomes) use getEntityContext.
export async function getEntityWithCurrentAttributes(
  ctx: ActionContext,
  entityId: string,
): Promise<EntityWithAttributes> {
  const [entity, attributes] = await Promise.all([
    getEntity(ctx, entityId),
    getCurrentAttributes(ctx, entityId),
  ])
  return { entity, attributes }
}

// Full observation history for one attribute kind on an entity (append-only trail).
export async function getAttributeHistory(
  ctx: ActionContext,
  entityId: string,
  attributeKindName: string,
): Promise<CurrentAttributeRow[]> {
  const { rows } = await executeQuery<CurrentAttributeRow>(
    ctx,
    `SELECT k.kind_name AS attribute_kind_name, a.value, a.confidence,
            a.knowability_state, a.time_precision, a.source_type, a.valid_from
       FROM attribute a JOIN attribute_kind_definition k ON k.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND k.kind_name = $3
      ORDER BY a.valid_from DESC`,
    [ctx.tenantId, entityId, attributeKindName],
  )
  return rows
}

export interface RelationshipRow {
  id: string
  relationship_kind_name: string
  source_entity_id: string
  target_entity_id: string
  properties: Record<string, unknown>
  valid_from: string
  valid_to: string | null
}

export async function listRelationships(
  ctx: ActionContext,
  entityId: string,
  opts: { onlyOpen?: boolean } = {},
): Promise<RelationshipRow[]> {
  const { rows } = await executeQuery<RelationshipRow>(
    ctx,
    `SELECT r.id, k.kind_name AS relationship_kind_name, r.source_entity_id,
            r.target_entity_id, r.properties, r.valid_from, r.valid_to
       FROM relationship r JOIN relationship_kind_definition k ON k.id = r.relationship_kind_id
      WHERE r.tenant_id = $1 AND (r.source_entity_id = $2 OR r.target_entity_id = $2)
        AND ($3::boolean IS NOT TRUE OR r.valid_to IS NULL)
      ORDER BY r.valid_from DESC`,
    [ctx.tenantId, entityId, opts.onlyOpen ?? false],
  )
  return rows
}

export interface Capabilities {
  entityKinds: Array<{ kind_name: string; display_name: string }>
  attributeKinds: Array<{ kind_name: string; display_name: string; value_type: string }>
  relationshipKinds: Array<{ kind_name: string; display_name: string; cardinality: string }>
  actionKinds: Array<{ kind_name: string; display_name: string; default_autonomy_tier: string }>
}

// What the substrate currently supports for this tenant — the live answer to
// "what's possible right now?" assembled from the definition registries.
export async function getCapabilities(ctx: ActionContext): Promise<Capabilities> {
  const entityKinds = await executeQuery<{ kind_name: string; display_name: string }>(
    ctx,
    `SELECT kind_name, display_name FROM entity_kind_definition
      WHERE tenant_id = $1 AND status = 'active' AND valid_to IS NULL ORDER BY kind_name`,
    [ctx.tenantId],
  )
  const attributeKinds = await executeQuery<{
    kind_name: string
    display_name: string
    value_type: string
  }>(
    ctx,
    `SELECT kind_name, display_name, value_type FROM attribute_kind_definition
      WHERE tenant_id = $1 AND status = 'active' AND valid_to IS NULL ORDER BY kind_name`,
    [ctx.tenantId],
  )
  const relationshipKinds = await executeQuery<{
    kind_name: string
    display_name: string
    cardinality: string
  }>(
    ctx,
    `SELECT kind_name, display_name, cardinality FROM relationship_kind_definition
      WHERE tenant_id = $1 AND status = 'active' AND valid_to IS NULL ORDER BY kind_name`,
    [ctx.tenantId],
  )
  const actionKinds = await executeQuery<{
    kind_name: string
    display_name: string
    default_autonomy_tier: string
  }>(
    ctx,
    `SELECT kind_name, display_name, default_autonomy_tier FROM action_kind_definition
      WHERE tenant_id = $1 AND status = 'active' AND valid_to IS NULL ORDER BY kind_name`,
    [ctx.tenantId],
  )
  return {
    entityKinds: entityKinds.rows,
    attributeKinds: attributeKinds.rows,
    relationshipKinds: relationshipKinds.rows,
    actionKinds: actionKinds.rows,
  }
}

export interface EventRow {
  id: string
  event_kind_name: string
  payload: Record<string, unknown>
  confidence: number
  occurred_at: string
}
export async function listEventsForEntity(
  ctx: ActionContext,
  entityId: string,
  limit = 50,
): Promise<EventRow[]> {
  const { rows } = await executeQuery<EventRow>(
    ctx,
    `SELECT e.id, k.kind_name AS event_kind_name, e.payload, e.confidence, e.occurred_at
       FROM event e JOIN event_kind_definition k ON k.id = e.event_kind_id
      WHERE e.tenant_id = $1 AND (e.primary_entity_id = $2 OR $2 = ANY(e.secondary_entity_ids))
      ORDER BY e.occurred_at DESC LIMIT $3`,
    [ctx.tenantId, entityId, limit],
  )
  return rows
}

export interface JudgmentRow {
  id: string
  judgment_kind_name: string
  value: unknown
  confidence: number
  reasoning: string | null
  valid_from: string
  valid_to: string | null
}
export async function listJudgmentsForEntity(
  ctx: ActionContext,
  entityId: string,
  opts: { onlyOpen?: boolean } = {},
): Promise<JudgmentRow[]> {
  const { rows } = await executeQuery<JudgmentRow>(
    ctx,
    `SELECT j.id, k.kind_name AS judgment_kind_name, j.value, j.confidence, j.reasoning, j.valid_from, j.valid_to
       FROM judgment j JOIN judgment_kind_definition k ON k.id = j.judgment_kind_id
      WHERE j.tenant_id = $1 AND j.subject_entity_id = $2
        AND ($3::boolean IS NOT TRUE OR j.valid_to IS NULL)
      ORDER BY j.valid_from DESC`,
    [ctx.tenantId, entityId, opts.onlyOpen ?? false],
  )
  return rows
}

export interface OutcomeRow {
  id: string
  outcome_kind_name: string
  outcome_data: Record<string, unknown>
  polarity: string
  occurred_at: string
}
export async function listOutcomesForEntity(
  ctx: ActionContext,
  entityId: string,
  limit = 50,
): Promise<OutcomeRow[]> {
  const { rows } = await executeQuery<OutcomeRow>(
    ctx,
    `SELECT o.id, k.kind_name AS outcome_kind_name, o.outcome_data, o.polarity, o.occurred_at
       FROM outcome o JOIN outcome_kind_definition k ON k.id = o.outcome_kind_id
      WHERE o.tenant_id = $1 AND o.subject_entity_id = $2
      ORDER BY o.occurred_at DESC LIMIT $3`,
    [ctx.tenantId, entityId, limit],
  )
  return rows
}

export interface EntityContext {
  entity: EntityRow | null
  attributes: CurrentAttributeRow[]
  relationships: RelationshipRow[]
  events: EventRow[]
  judgments: JudgmentRow[]
  outcomes: OutcomeRow[]
}

// The full picture of one entity in a single call — the unit of context an AI
// model needs to reason: what it is, what's currently known (with confidence +
// knowability + provenance), how it's connected, what happened, what's been
// judged, and how it turned out.
export async function getEntityContext(
  ctx: ActionContext,
  entityId: string,
): Promise<EntityContext> {
  const [entity, attributes, relationships, events, judgments, outcomes] = await Promise.all([
    getEntity(ctx, entityId),
    getCurrentAttributes(ctx, entityId),
    listRelationships(ctx, entityId, { onlyOpen: true }),
    listEventsForEntity(ctx, entityId),
    listJudgmentsForEntity(ctx, entityId, { onlyOpen: true }),
    listOutcomesForEntity(ctx, entityId),
  ])
  return { entity, attributes, relationships, events, judgments, outcomes }
}

export interface SearchHit {
  entity_id: string
  entity_kind_name: string
  name: string
  matched_on: string
}

// Hybrid search: keyword over entity name + current text attribute values, with
// an optional structured entity-kind filter. Vector search is layered on top via
// content_embedding (migration 0015) when embeddings are populated.
export async function searchEntities(
  ctx: ActionContext,
  opts: { query: string; entityKindName?: string; limit?: number },
): Promise<SearchHit[]> {
  const like = `%${opts.query}%`
  const { rows } = await executeQuery<SearchHit>(
    ctx,
    `SELECT DISTINCT ON (e.id) e.id AS entity_id, k.kind_name AS entity_kind_name, e.name,
            CASE WHEN e.name ILIKE $2 THEN 'name' ELSE 'attribute' END AS matched_on
       FROM entity e
       JOIN entity_kind_definition k ON k.id = e.entity_kind_id
       LEFT JOIN attribute a ON a.entity_id = e.id AND a.tenant_id = e.tenant_id AND a.valid_to IS NULL
      WHERE e.tenant_id = $1 AND e.status = 'active'
        AND ($3::text IS NULL OR k.kind_name = $3)
        AND (e.name ILIKE $2 OR a.value::text ILIKE $2)
      ORDER BY e.id, matched_on
      LIMIT $4`,
    [ctx.tenantId, like, opts.entityKindName ?? null, opts.limit ?? 50],
  )
  return rows
}
