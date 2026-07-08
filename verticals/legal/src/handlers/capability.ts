import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Platform capability library (schema-as-data). A capability is an ENTITY the
// service-builder reads to know what the platform can do — reuse vs. build. One
// upsert action creates it by stable slug or supersedes its status/spec
// (append-only attribute supersession). Archival reuses core entity.archive.
// All writes flow through here (hard rule #1). Mirrors handlers/skill.ts.
// ───────────────────────────────────────────────────────────────────────────

const CAPABILITY_ENTITY_KIND = 'platform_capability'

async function setCapabilityAttr(
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

// Resolve an existing capability entity by its stable slug (latest active), so an
// upsert supersedes in place rather than duplicating.
async function findCapabilityBySlug(
  client: DbClient,
  tenantId: string,
  slug: string,
): Promise<string | null> {
  const res = await client.query<{ entity_id: string }>(
    `SELECT a.entity_id
     FROM attribute a
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     JOIN entity e ON e.id = a.entity_id
     JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
     WHERE a.tenant_id = $1
       AND akd.kind_name = 'capability_slug'
       AND ekd.kind_name = 'platform_capability'
       AND e.status = 'active'
       AND a.value #>> '{}' = $2
       AND (a.valid_to IS NULL OR a.valid_to > now())
     ORDER BY a.valid_from DESC
     LIMIT 1`,
    [tenantId, slug],
  )
  return res.rows[0]?.entity_id ?? null
}

interface CapabilitySpec {
  name: string
  category?: string
  purpose?: string
  when_to_use?: string
  backed_by?: string[]
  docs_path?: string
}

interface CapabilityUpsertPayload {
  slug: string
  status?: string
  spec: CapabilitySpec
}

const CAPABILITY_STATUSES = new Set(['available', 'building', 'requested', 'deprecated'])

registerActionHandler('legal.capability.upsert', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as CapabilityUpsertPayload
  const slug = (p.slug ?? '').trim()
  if (!slug) throw new Error('slug is required.')
  const spec = p.spec
  if (!spec || typeof spec !== 'object') throw new Error('spec is required.')
  const name = (spec.name ?? '').trim()
  if (!name) throw new Error('spec.name is required.')
  const status = (p.status ?? 'available').trim()
  if (!CAPABILITY_STATUSES.has(status)) {
    throw new Error(`status must be one of: ${[...CAPABILITY_STATUSES].join(', ')}.`)
  }

  let entityId = await findCapabilityBySlug(client, ctx.tenantId, slug)
  if (!entityId) {
    const kindId = await lookupKindId(
      client,
      'entity_kind_definition',
      ctx.tenantId,
      CAPABILITY_ENTITY_KIND,
    )
    entityId = await insertEntity(client, ctx.tenantId, actionId, kindId, name, { slug })
    await setCapabilityAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId,
      kind: 'capability_slug',
      value: slug,
    })
  }

  // Create or supersede the status + spec (append-only attribute supersession).
  await setCapabilityAttr(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    entityId,
    kind: 'capability_status',
    value: status,
  })
  await setCapabilityAttr(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    entityId,
    kind: 'capability_spec',
    value: { ...spec, name },
  })

  return { capabilityEntityId: entityId, slug, status }
})
