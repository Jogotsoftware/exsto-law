// Generic, vertical-agnostic MCP tools over the core substrate primitives.
// Every write routes through the action layer (packages/substrate); every read
// runs under the tenant-scoped action context. Tool naming: domain.verb.qualifier.
//
// Each tool carries a JSON Schema `inputSchema` (the single source of truth): the
// MCP `tools/list` surface and the generated OpenAPI both render it, so the public
// contract never drifts from the handler. The handler's TypeScript signature and
// the schema describe the same shape.
import { registerTool, type JsonSchema } from '../tool.js'
import {
  createEntity,
  updateEntity,
  archiveEntity,
  setAttribute,
  createRelationship,
  closeRelationship,
  recordEvent,
  recordJudgment,
  recordOutcome,
  assertIdentity,
  listEntitiesByKind,
  getEntityWithCurrentAttributes,
  getAttributeHistory,
  listRelationships,
  getCapabilities,
  submitPrimitiveAction,
  getEntityContext,
  searchEntities,
  listEventsForEntity,
  listJudgmentsForEntity,
  listOutcomesForEntity,
} from '@exsto/primitives'
import type { IntentKind } from '@exsto/shared'

// --- Reusable schema fragments ---------------------------------------------
const STR: JsonSchema = { type: 'string' }
const UUID: JsonSchema = { type: 'string', description: 'Entity/actor UUID.' }
const NUM: JsonSchema = { type: 'number' }
const INT: JsonSchema = { type: 'integer' }
const BOOL: JsonSchema = { type: 'boolean' }
const FREEFORM: JsonSchema = { type: 'object', additionalProperties: true }
const INTENT_KIND: JsonSchema = {
  type: 'string',
  description: 'Why the action happened (invariant 10).',
  enum: [
    'correction',
    'reflection',
    'adjustment',
    'override',
    'exploration',
    'enforcement',
    'automatic_sync',
    'unknown',
  ],
}
const KNOWABILITY: JsonSchema = {
  type: 'string',
  enum: [
    'observed',
    'observed_null',
    'never_observed',
    'withheld',
    'inapplicable',
    'pending',
    'stale',
    'computation_failed',
  ],
}
const TIME_PRECISION: JsonSchema = {
  type: 'string',
  enum: [
    'exact_instant',
    'second',
    'minute',
    'hour',
    'day',
    'week',
    'month',
    'quarter',
    'year',
    'range',
    'approximate',
    'unknown',
  ],
}
// Build an object schema. additionalProperties stays open (the JSON Schema
// default): the handlers intentionally tolerate extra fields (e.g. a forged
// tenant_id is ignored, not rejected — see docs/ADVERSARIAL_AUDIT.md R1/M3), so
// the published contract documents the known + required fields without claiming a
// closed object the server does not enforce.
function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', properties, required }
}
const EMPTY: JsonSchema = { type: 'object', properties: {} }

// --- Capability -------------------------------------------------------------
registerTool({
  name: 'substrate.capability.list',
  description:
    'List the entity, attribute, relationship, and action kinds available for this tenant.',
  mode: 'read',
  inputSchema: EMPTY,
  handler: (ctx) => getCapabilities(ctx),
})

// --- Entity -----------------------------------------------------------------
registerTool({
  name: 'entity.create',
  description: 'Create an entity of a given kind, optionally with initial attributes.',
  mode: 'write',
  inputSchema: obj(
    {
      entityKindName: STR,
      attributes: {
        type: 'array',
        items: obj(
          {
            attributeKindName: STR,
            value: {},
            confidence: NUM,
            knowabilityState: KNOWABILITY,
            timePrecision: TIME_PRECISION,
          },
          ['attributeKindName', 'value', 'confidence', 'knowabilityState', 'timePrecision'],
        ),
      },
      intentKind: INTENT_KIND,
    },
    ['entityKindName'],
  ),
  handler: (
    ctx,
    input: {
      entityKindName: string
      attributes?: Array<{
        attributeKindName: string
        value: unknown
        confidence: number
        knowabilityState: string
        timePrecision: string
      }>
      intentKind?: IntentKind
    },
  ) =>
    createEntity(ctx, {
      entityKindName: input.entityKindName,
      attributes: input.attributes ?? [],
      intentKind: input.intentKind ?? 'unknown',
    }),
})

registerTool({
  name: 'entity.update',
  description: "Update an entity's name, status, or metadata.",
  mode: 'write',
  inputSchema: obj(
    {
      entityId: UUID,
      name: STR,
      status: { type: 'string', enum: ['active', 'archived', 'suspended'] },
      metadata: FREEFORM,
      intentKind: INTENT_KIND,
    },
    ['entityId'],
  ),
  handler: (
    ctx,
    input: {
      entityId: string
      name?: string
      status?: 'active' | 'archived' | 'suspended'
      metadata?: Record<string, unknown>
      intentKind?: IntentKind
    },
  ) => updateEntity(ctx, { ...input, intentKind: input.intentKind ?? 'adjustment' }),
})

registerTool({
  name: 'entity.archive',
  description: 'Archive an entity.',
  mode: 'write',
  inputSchema: obj({ entityId: UUID }, ['entityId']),
  handler: (ctx, input: { entityId: string }) => archiveEntity(ctx, input.entityId),
})

registerTool({
  name: 'entity.get',
  description: 'Get an entity with its current attribute values.',
  mode: 'read',
  inputSchema: obj({ entityId: UUID }, ['entityId']),
  handler: (ctx, input: { entityId: string }) =>
    getEntityWithCurrentAttributes(ctx, input.entityId),
})

registerTool({
  name: 'entity.list_by_kind',
  description: 'List active entities of a given kind.',
  mode: 'read',
  inputSchema: obj({ entityKindName: STR, limit: INT }, ['entityKindName']),
  handler: (ctx, input: { entityKindName: string; limit?: number }) =>
    listEntitiesByKind(ctx, input.entityKindName, input.limit ?? 100),
})

// --- Attribute --------------------------------------------------------------
registerTool({
  name: 'attribute.set',
  description: 'Set an entity attribute, closing the prior value of the same kind.',
  mode: 'write',
  inputSchema: obj(
    {
      entityId: UUID,
      attributeKindName: STR,
      value: {},
      confidence: NUM,
      knowabilityState: KNOWABILITY,
      timePrecision: TIME_PRECISION,
      intentKind: INTENT_KIND,
    },
    ['entityId', 'attributeKindName', 'value', 'confidence', 'knowabilityState', 'timePrecision'],
  ),
  handler: (
    ctx,
    input: {
      entityId: string
      attributeKindName: string
      value: unknown
      confidence: number
      knowabilityState: string
      timePrecision: string
      intentKind?: IntentKind
    },
  ) => setAttribute(ctx, { ...input, intentKind: input.intentKind ?? 'adjustment' }),
})

registerTool({
  name: 'attribute.history.get',
  description: 'Get the full observation history for one attribute kind on an entity.',
  mode: 'read',
  inputSchema: obj({ entityId: UUID, attributeKindName: STR }, ['entityId', 'attributeKindName']),
  handler: (ctx, input: { entityId: string; attributeKindName: string }) =>
    getAttributeHistory(ctx, input.entityId, input.attributeKindName),
})

// --- Relationship -----------------------------------------------------------
registerTool({
  name: 'relationship.create',
  description: 'Create a relationship between two entities.',
  mode: 'write',
  inputSchema: obj(
    {
      sourceEntityId: UUID,
      targetEntityId: UUID,
      relationshipKindName: STR,
      properties: FREEFORM,
      intentKind: INTENT_KIND,
    },
    ['sourceEntityId', 'targetEntityId', 'relationshipKindName'],
  ),
  handler: (
    ctx,
    input: {
      sourceEntityId: string
      targetEntityId: string
      relationshipKindName: string
      properties?: Record<string, unknown>
      intentKind?: IntentKind
    },
  ) => createRelationship(ctx, { ...input, intentKind: input.intentKind ?? 'unknown' }),
})

registerTool({
  name: 'relationship.close',
  description: "End a relationship's validity.",
  mode: 'write',
  inputSchema: obj({ relationshipId: UUID }, ['relationshipId']),
  handler: (ctx, input: { relationshipId: string }) => closeRelationship(ctx, input.relationshipId),
})

registerTool({
  name: 'relationship.list',
  description: 'List relationships touching an entity (optionally only currently-open ones).',
  mode: 'read',
  inputSchema: obj({ entityId: UUID, onlyOpen: BOOL }, ['entityId']),
  handler: (ctx, input: { entityId: string; onlyOpen?: boolean }) =>
    listRelationships(ctx, input.entityId, { onlyOpen: input.onlyOpen }),
})

// --- Event / Judgment / Outcome --------------------------------------------
registerTool({
  name: 'event.record',
  description: 'Record an immutable event.',
  mode: 'write',
  inputSchema: obj(
    {
      eventKindName: STR,
      primaryEntityId: UUID,
      secondaryEntityIds: { type: 'array', items: UUID },
      data: FREEFORM,
      confidence: NUM,
      occurredAt: { type: 'string', description: 'ISO 8601 timestamp.' },
      occurredAtPrecision: TIME_PRECISION,
    },
    ['eventKindName'],
  ),
  handler: (
    ctx,
    input: {
      eventKindName: string
      primaryEntityId?: string
      secondaryEntityIds?: string[]
      data?: Record<string, unknown>
      confidence?: number
      occurredAt?: string
      occurredAtPrecision?: string
    },
  ) => recordEvent(ctx, input),
})

registerTool({
  name: 'judgment.record',
  description: 'Record a judgment (qualitative assessment) about an entity.',
  mode: 'write',
  inputSchema: obj(
    {
      subjectEntityId: UUID,
      judgmentKindName: STR,
      value: {},
      confidence: NUM,
      evidence: { type: 'array', items: {} },
      reasoning: STR,
      reasoningTraceId: UUID,
      polarity: { type: 'string', enum: ['positive', 'negative'] },
    },
    ['subjectEntityId', 'judgmentKindName', 'value', 'confidence'],
  ),
  handler: (
    ctx,
    input: {
      subjectEntityId: string
      judgmentKindName: string
      value: unknown
      confidence: number
      evidence?: unknown[]
      reasoning?: string
      reasoningTraceId?: string
      polarity?: 'positive' | 'negative'
    },
  ) => recordJudgment(ctx, input),
})

registerTool({
  name: 'outcome.record',
  description: 'Record a realized outcome for an entity.',
  mode: 'write',
  inputSchema: obj(
    {
      subjectEntityId: UUID,
      outcomeKindName: STR,
      outcomeData: FREEFORM,
      polarity: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
      confidence: NUM,
      evidence: { type: 'array', items: {} },
      occurredAt: { type: 'string', description: 'ISO 8601 timestamp.' },
    },
    ['subjectEntityId', 'outcomeKindName'],
  ),
  handler: (
    ctx,
    input: {
      subjectEntityId: string
      outcomeKindName: string
      outcomeData?: Record<string, unknown>
      polarity?: 'positive' | 'negative' | 'neutral'
      confidence?: number
      evidence?: unknown[]
      occurredAt?: string
    },
  ) => recordOutcome(ctx, input),
})

// --- Identity ---------------------------------------------------------------
registerTool({
  name: 'identity.assert',
  description: 'Assert that two entities are the same, different, or related (non-destructive).',
  mode: 'write',
  inputSchema: obj(
    {
      assertionKind: { type: 'string', enum: ['same_as', 'different_from', 'related_to'] },
      entityAId: UUID,
      entityBId: UUID,
      confidence: NUM,
      evidence: { type: 'array', items: {} },
      supersedesId: UUID,
    },
    ['assertionKind', 'entityAId', 'entityBId', 'confidence'],
  ),
  handler: (
    ctx,
    input: {
      assertionKind: 'same_as' | 'different_from' | 'related_to'
      entityAId: string
      entityBId: string
      confidence: number
      evidence?: unknown[]
      supersedesId?: string
    },
  ) => assertIdentity(ctx, input),
})

// --- Generic write surface --------------------------------------------------
// Covers every action kind in the registry (governance, structural,
// communication, verification, content, ingestion). An AI discovers available
// kinds via substrate.capability.list, then submits any of them here. Every
// call still flows through the governed, audited action layer.
registerTool({
  name: 'substrate.action.submit',
  description:
    'Submit any substrate action by kind name (see substrate.capability.list for available kinds).',
  mode: 'write',
  inputSchema: obj({ actionKindName: STR, payload: FREEFORM, intentKind: INTENT_KIND }, [
    'actionKindName',
  ]),
  handler: (
    ctx,
    input: { actionKindName: string; payload?: Record<string, unknown>; intentKind?: IntentKind },
  ) =>
    submitPrimitiveAction(ctx, {
      actionKindName: input.actionKindName,
      payload: input.payload ?? {},
      intentKind: input.intentKind ?? 'unknown',
    }),
})

registerTool({
  name: 'substrate.kind.define',
  description:
    'Define a new entity/attribute/relationship/event/judgment/outcome/period kind at runtime (schema-as-data).',
  mode: 'write',
  inputSchema: obj(
    {
      registry: STR,
      kind_name: STR,
      display_name: STR,
      description: STR,
      extra: FREEFORM,
    },
    ['registry', 'kind_name', 'display_name'],
  ),
  handler: (
    ctx,
    input: {
      registry: string
      kind_name: string
      display_name: string
      description?: string
      extra?: Record<string, unknown>
    },
  ) =>
    submitPrimitiveAction(ctx, {
      actionKindName: 'kind.define',
      payload: input as Record<string, unknown>,
      intentKind: 'enforcement',
    }),
})

// --- AI context + search ----------------------------------------------------
registerTool({
  name: 'entity.context',
  description:
    'Full context for one entity: attributes, relationships, events, judgments, outcomes — the unit of context for an AI model.',
  mode: 'read',
  inputSchema: obj({ entityId: UUID }, ['entityId']),
  handler: (ctx, input: { entityId: string }) => getEntityContext(ctx, input.entityId),
})

registerTool({
  name: 'entity.search',
  description:
    'Hybrid keyword search over entity names and current attribute values, with optional entity-kind filter.',
  mode: 'read',
  inputSchema: obj({ query: STR, entityKindName: STR, limit: INT }, ['query']),
  handler: (ctx, input: { query: string; entityKindName?: string; limit?: number }) =>
    searchEntities(ctx, input),
})

registerTool({
  name: 'event.list_for_entity',
  description: 'List recent events touching an entity.',
  mode: 'read',
  inputSchema: obj({ entityId: UUID, limit: INT }, ['entityId']),
  handler: (ctx, input: { entityId: string; limit?: number }) =>
    listEventsForEntity(ctx, input.entityId, input.limit),
})

registerTool({
  name: 'judgment.list_for_entity',
  description: 'List judgments about an entity (optionally only current ones).',
  mode: 'read',
  inputSchema: obj({ entityId: UUID, onlyOpen: BOOL }, ['entityId']),
  handler: (ctx, input: { entityId: string; onlyOpen?: boolean }) =>
    listJudgmentsForEntity(ctx, input.entityId, { onlyOpen: input.onlyOpen }),
})

registerTool({
  name: 'outcome.list_for_entity',
  description: 'List realized outcomes for an entity.',
  mode: 'read',
  inputSchema: obj({ entityId: UUID, limit: INT }, ['entityId']),
  handler: (ctx, input: { entityId: string; limit?: number }) =>
    listOutcomesForEntity(ctx, input.entityId, input.limit),
})
