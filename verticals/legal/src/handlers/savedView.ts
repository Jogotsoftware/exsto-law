import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Saved views (beta sprint Objective 5). A saved_view entity holds a named
// filter/sort view for a list surface. legal.savedview.create makes one (owner =
// the actor); legal.savedview.update supersedes its attributes (append-only).
// Deletion reuses the core entity.archive. All writes flow through here.
// ───────────────────────────────────────────────────────────────────────────

const SAVED_VIEW_ENTITY_KIND = 'saved_view'

async function setViewAttr(
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

interface SavedViewCreatePayload {
  name: string
  surface: string
  config: Record<string, unknown>
}

registerActionHandler('legal.savedview.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as SavedViewCreatePayload
  const name = (p.name ?? '').trim()
  if (!name) throw new Error('name is required.')
  if (!p.surface?.trim()) throw new Error('surface is required.')
  if (p.config == null || typeof p.config !== 'object')
    throw new Error('config object is required.')

  const kindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    SAVED_VIEW_ENTITY_KIND,
  )
  const viewEntityId = await insertEntity(client, ctx.tenantId, actionId, kindId, name, {})

  const attrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'view_name', value: name },
    { kind: 'view_surface', value: p.surface },
    { kind: 'view_config', value: p.config },
    { kind: 'view_owner', value: ctx.actorId },
  ]
  for (const a of attrs) {
    await setViewAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: viewEntityId,
      kind: a.kind,
      value: a.value,
    })
  }

  return { savedViewId: viewEntityId }
})

interface SavedViewUpdatePayload {
  saved_view_id: string
  name?: string
  config?: Record<string, unknown>
}

registerActionHandler('legal.savedview.update', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as SavedViewUpdatePayload
  if (!p.saved_view_id) throw new Error('saved_view_id is required.')

  const updates: Array<{ kind: string; value: unknown }> = []
  if (p.name != null) {
    const name = p.name.trim()
    if (!name) throw new Error('name cannot be blank.')
    updates.push({ kind: 'view_name', value: name })
  }
  if (p.config != null) {
    if (typeof p.config !== 'object') throw new Error('config must be an object.')
    updates.push({ kind: 'view_config', value: p.config })
  }

  for (const u of updates) {
    await setViewAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: p.saved_view_id,
      kind: u.kind,
      value: u.value,
    })
  }

  return { savedViewId: p.saved_view_id, updated: updates.map((u) => u.kind) }
})
