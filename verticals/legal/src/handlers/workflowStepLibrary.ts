import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'
import { STEP_ACTION_KINDS } from '../lifecycle/catalog.js'
import { GATE_KINDS } from '../lifecycle/types.js'

// ───────────────────────────────────────────────────────────────────────────
// Workflow STEP library (migration 0095, ADR 0045 PR4c). A workflow_step_template
// entity is a reusable workflow STEP (a LifecycleStage WITHOUT edges) NOT bound to
// a service. legal.workflow_step_template.create makes one; .update supersedes its
// attributes (append-only). Archival reuses the core entity.archive action.
// Mirrors the questionnaire library handler exactly.
// ───────────────────────────────────────────────────────────────────────────

const WST_ENTITY_KIND = 'workflow_step_template'

async function setAttr(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    entityId: string
    kind: string
    value: unknown
  },
): Promise<void> {
  const akId = await lookupKindId(client, 'attribute_kind_definition', args.tenantId, args.kind)
  await insertAttribute(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: args.entityId,
    attributeKindId: akId,
    value: args.value,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: args.actorId,
  })
}

// A saved STAGE must be a LifecycleStage WITHOUT edges: it carries label / action
// {kind} / gate / documents? / blocking?, but NO `advances_to` (and no key / entry
// / terminal — those are position-dependent, assigned by the builder at insertion).
// A half-edge would later fail validateLifecycle, so we reject it AT THE WRITE.
// The closed action + gate catalogs are the only sets a step may compose from.
function assertStage(stage: unknown): void {
  const s = stage as {
    label?: unknown
    action?: { kind?: unknown }
    gate?: unknown
    advances_to?: unknown
    key?: unknown
    entry?: unknown
    terminal?: unknown
  } | null
  if (!s || typeof s !== 'object') throw new Error('stage must be an object.')
  if (typeof s.label !== 'string' || !s.label.trim()) throw new Error('stage.label is required.')
  if ('advances_to' in s && s.advances_to != null)
    throw new Error('a saved step must not carry advances_to (the builder assigns edges).')
  if ('key' in s && s.key != null)
    throw new Error('a saved step must not carry a key (assigned at insertion).')
  if (('entry' in s && s.entry != null) || ('terminal' in s && s.terminal != null))
    throw new Error('a saved step must not be marked entry/terminal (assigned at insertion).')
  const kind = s.action?.kind
  if (typeof kind !== 'string' || !STEP_ACTION_KINDS.includes(kind as never))
    throw new Error(`stage.action.kind must be one of the catalog kinds (got ${String(kind)}).`)
  if (typeof s.gate !== 'string' || !GATE_KINDS.includes(s.gate as never))
    throw new Error(`stage.gate must be one of ${GATE_KINDS.join(', ')} (got ${String(s.gate)}).`)
}

interface CreatePayload {
  name: string
  description?: string | null
  stage: unknown
}

registerActionHandler(
  'legal.workflow_step_template.create',
  async (ctx, client, payload, actionId) => {
    const p = payload as unknown as CreatePayload
    const name = (p.name ?? '').trim()
    if (!name) throw new Error('name is required.')
    assertStage(p.stage)

    const kindId = await lookupKindId(
      client,
      'entity_kind_definition',
      ctx.tenantId,
      WST_ENTITY_KIND,
    )
    const workflowStepTemplateId = await insertEntity(
      client,
      ctx.tenantId,
      actionId,
      kindId,
      name,
      {},
    )

    const attrs: Array<{ kind: string; value: unknown }> = [
      { kind: 'workflow_step_template_name', value: name },
      { kind: 'workflow_step_template_stage', value: p.stage },
    ]
    if (p.description != null && p.description.trim()) {
      attrs.push({ kind: 'workflow_step_template_description', value: p.description.trim() })
    }
    for (const a of attrs) {
      await setAttr(client, {
        tenantId: ctx.tenantId,
        actionId,
        actorId: ctx.actorId,
        entityId: workflowStepTemplateId,
        kind: a.kind,
        value: a.value,
      })
    }

    return { workflowStepTemplateId }
  },
)

interface UpdatePayload {
  workflow_step_template_id: string
  name?: string
  description?: string | null
  stage?: unknown
}

registerActionHandler(
  'legal.workflow_step_template.update',
  async (ctx, client, payload, actionId) => {
    const p = payload as unknown as UpdatePayload
    if (!p.workflow_step_template_id) throw new Error('workflow_step_template_id is required.')

    const updates: Array<{ kind: string; value: unknown }> = []
    if (p.name != null) {
      const name = p.name.trim()
      if (!name) throw new Error('name cannot be blank.')
      updates.push({ kind: 'workflow_step_template_name', value: name })
    }
    if (p.description != null) {
      updates.push({ kind: 'workflow_step_template_description', value: p.description })
    }
    if (p.stage != null) {
      assertStage(p.stage)
      updates.push({ kind: 'workflow_step_template_stage', value: p.stage })
    }

    for (const u of updates) {
      await setAttr(client, {
        tenantId: ctx.tenantId,
        actionId,
        actorId: ctx.actorId,
        entityId: p.workflow_step_template_id,
        kind: u.kind,
        value: u.value,
      })
    }

    return {
      workflowStepTemplateId: p.workflow_step_template_id,
      updated: updates.map((u) => u.kind),
    }
  },
)
