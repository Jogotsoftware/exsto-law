import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

// Data-as-schema authoring for the Build-Wizard (Tier 1). The builder can PROPOSE
// a genuinely new DATA kind — a new attribute on a matter/client/document, a new
// relationship, a new event (workflow milestone), or a new entity the firm tracks
// — when a novel practice area needs to model something the platform has no kind
// for yet. These are PURE DATA: the substrate's generic engines consume the new
// definition row with no code (kind.define, primitives/handlers/config.ts). This
// is DISTINCT from the closed EXECUTABLE catalogs (workflow steps, gates,
// questionnaire field types) — those need code and are handled via
// request_capability, never invented here.

// The registries the builder may mint. Judgment/outcome/period exist in
// kind.define but are advanced and out of scope for service building.
export const PROPOSABLE_REGISTRIES = ['entity', 'attribute', 'relationship', 'event'] as const
export type ProposableRegistry = (typeof PROPOSABLE_REGISTRIES)[number]

// Attribute value types the builder may choose (the substrate's scalar set).
export const KIND_VALUE_TYPES = ['text', 'number', 'boolean', 'date', 'json'] as const
export type KindValueType = (typeof KIND_VALUE_TYPES)[number]

export interface KindProposal {
  registry: ProposableRegistry
  kindName: string
  displayName: string
  description: string | null
  // attribute: the entity kind it attaches to (e.g. 'matter') + its value type.
  onEntityKind?: string | null
  valueType?: KindValueType | null
  // relationship: the entity kinds it connects.
  sourceEntityKind?: string | null
  targetEntityKind?: string | null
  summary: string
  confidence: number
}

export interface KindAuthoringContext {
  entityKinds: string[]
  attributeKinds: string[]
  relationshipKinds: string[]
  eventKinds: string[]
  proposableRegistries: readonly string[]
  valueTypes: readonly string[]
}

// Existing kinds so the builder REUSES rather than duplicating, and picks a real
// entity kind to attach an attribute/relationship to. Read-only, tenant-scoped.
export async function loadKindAuthoringContext(ctx: ActionContext): Promise<KindAuthoringContext> {
  return withActionContext(ctx, async (client) => {
    const q = async (table: string): Promise<string[]> => {
      const res = await client.query<{ kind_name: string }>(
        `SELECT kind_name FROM ${table} WHERE tenant_id = $1 AND status = 'active' ORDER BY kind_name`,
        [ctx.tenantId],
      )
      return res.rows.map((r) => r.kind_name)
    }
    const [entityKinds, attributeKinds, relationshipKinds, eventKinds] = await Promise.all([
      q('entity_kind_definition'),
      q('attribute_kind_definition'),
      q('relationship_kind_definition'),
      q('event_kind_definition'),
    ])
    return {
      entityKinds,
      attributeKinds,
      relationshipKinds,
      eventKinds,
      proposableRegistries: PROPOSABLE_REGISTRIES,
      valueTypes: KIND_VALUE_TYPES,
    }
  })
}

// snake_case, letters/digits/underscore — the substrate kind_name convention.
export function normalizeKindName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

export interface KindValidationResult {
  ok: boolean
  errors: string[]
  normalizedKindName: string
}

// The SAME checks the write path applies, so a captured proposal is always
// mintable. Reuse over create: a kind_name that already exists in the registry is
// rejected (the builder should reuse it, not duplicate).
export function validateProposedKind(
  input: {
    registry: string
    kindName: string
    displayName: string
    onEntityKind?: string | null
    valueType?: string | null
    sourceEntityKind?: string | null
    targetEntityKind?: string | null
  },
  ctx: KindAuthoringContext,
): KindValidationResult {
  const errors: string[] = []
  const normalizedKindName = normalizeKindName(input.kindName || input.displayName || '')

  if (!PROPOSABLE_REGISTRIES.includes(input.registry as ProposableRegistry)) {
    errors.push(
      `registry must be one of ${PROPOSABLE_REGISTRIES.join(', ')} (workflow steps, gates, and field types are closed — use request_capability for those).`,
    )
  }
  if (!normalizedKindName) errors.push('a kind name is required.')
  if (!input.displayName?.trim()) errors.push('a display name is required.')

  const existing =
    input.registry === 'entity'
      ? ctx.entityKinds
      : input.registry === 'attribute'
        ? ctx.attributeKinds
        : input.registry === 'relationship'
          ? ctx.relationshipKinds
          : ctx.eventKinds
  if (existing.includes(normalizedKindName)) {
    errors.push(
      `"${normalizedKindName}" already exists as a ${input.registry} kind — REUSE it instead of proposing a duplicate.`,
    )
  }

  if (input.registry === 'attribute') {
    if (!input.onEntityKind || !ctx.entityKinds.includes(input.onEntityKind)) {
      errors.push(
        `an attribute must attach to an existing entity kind (onEntityKind) — one of: ${ctx.entityKinds.slice(0, 12).join(', ')}…`,
      )
    }
    if (input.valueType && !KIND_VALUE_TYPES.includes(input.valueType as KindValueType)) {
      errors.push(`valueType must be one of ${KIND_VALUE_TYPES.join(', ')}.`)
    }
  }
  if (input.registry === 'relationship') {
    for (const [label, k] of [
      ['sourceEntityKind', input.sourceEntityKind],
      ['targetEntityKind', input.targetEntityKind],
    ] as const) {
      if (!k || !ctx.entityKinds.includes(k)) {
        errors.push(`${label} must be an existing entity kind.`)
      }
    }
  }

  return { ok: errors.length === 0, errors, normalizedKindName }
}

// The WRITE path — mint the proposed kind through the core kind.define action
// (the approval card calls this via an MCP tool). Resolves entity-kind NAMES to
// ids (kind.define's `extra` columns take ids), validates once more against live
// state, then submits. Append-only + audited by the kind.define handler.
export interface DefineKindInput {
  registry: string
  kindName: string
  displayName: string
  description?: string | null
  onEntityKind?: string | null
  valueType?: string | null
  sourceEntityKind?: string | null
  targetEntityKind?: string | null
}

export async function defineKind(
  ctx: ActionContext,
  input: DefineKindInput,
): Promise<{ registry: string; kindName: string }> {
  const context = await loadKindAuthoringContext(ctx)
  const validation = validateProposedKind(input, context)
  if (!validation.ok) {
    throw new Error(`Cannot define kind: ${validation.errors.join('; ')}`)
  }
  const kindName = validation.normalizedKindName

  // Resolve entity-kind names → ids for the `extra` columns kind.define expects.
  const entityKindId = async (name: string): Promise<string> =>
    withActionContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `SELECT id FROM entity_kind_definition
         WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active'
         ORDER BY valid_from DESC LIMIT 1`,
        [ctx.tenantId, name],
      )
      const id = res.rows[0]?.id
      if (!id) throw new Error(`Entity kind not found: ${name}`)
      return id
    })

  const extra: Record<string, unknown> = {}
  if (input.registry === 'attribute') {
    extra.on_entity_kind_id = await entityKindId(input.onEntityKind as string)
    extra.value_type = (input.valueType as string) || 'text'
  } else if (input.registry === 'relationship') {
    extra.source_entity_kind_id = await entityKindId(input.sourceEntityKind as string)
    extra.target_entity_kind_id = await entityKindId(input.targetEntityKind as string)
  } else if (input.registry === 'event') {
    extra.is_state_change = false
  }

  await submitAction(ctx, {
    actionKindName: 'kind.define',
    intentKind: 'enforcement',
    payload: {
      registry: input.registry,
      kind_name: kindName,
      display_name: input.displayName.trim(),
      description: input.description ?? null,
      extra,
    },
  })
  return { registry: input.registry, kindName }
}
