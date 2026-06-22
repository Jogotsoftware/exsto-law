import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Skills (legal know-how ported from claude-for-legal). A skill entity is a
// reusable instruction asset the assistant loads on demand. legal.skill.create
// makes one; legal.skill.update supersedes its attributes (append-only).
// Archival reuses the core entity.archive action. All writes flow through here
// (hard rule #1). Identified by a stable skill_slug so seeding is idempotent.
// ───────────────────────────────────────────────────────────────────────────

const SKILL_ENTITY_KIND = 'skill'

async function setSkillAttr(
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

// Resolve an existing skill entity by its stable slug (latest active), so a
// re-seed updates in place rather than duplicating. Read inside the action's
// transaction; RLS scopes it to the tenant.
async function findSkillBySlug(
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
       AND akd.kind_name = 'skill_slug'
       AND ekd.kind_name = 'skill'
       AND e.status = 'active'
       AND a.value #>> '{}' = $2
       AND (a.valid_to IS NULL OR a.valid_to > now())
     ORDER BY a.valid_from DESC
     LIMIT 1`,
    [tenantId, slug],
  )
  return res.rows[0]?.entity_id ?? null
}

interface SkillCreatePayload {
  slug: string
  name: string
  practice_area: string
  description?: string | null
  when_to_use: string
  body: string
  user_invocable?: boolean
}

registerActionHandler('legal.skill.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as SkillCreatePayload
  const slug = (p.slug ?? '').trim()
  const name = (p.name ?? '').trim()
  if (!slug) throw new Error('slug is required.')
  if (!name) throw new Error('name is required.')
  if (typeof p.body !== 'string' || !p.body.trim()) throw new Error('body is required.')
  if (typeof p.when_to_use !== 'string' || !p.when_to_use.trim()) {
    throw new Error('when_to_use is required.')
  }

  const kindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    SKILL_ENTITY_KIND,
  )
  const skillEntityId = await insertEntity(client, ctx.tenantId, actionId, kindId, name, {
    slug,
  })

  const attrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'skill_slug', value: slug },
    { kind: 'skill_name', value: name },
    { kind: 'skill_practice_area', value: (p.practice_area ?? '').trim() },
    { kind: 'skill_when_to_use', value: p.when_to_use },
    { kind: 'skill_body', value: p.body },
    { kind: 'skill_user_invocable', value: p.user_invocable !== false },
  ]
  if (p.description != null && String(p.description).trim()) {
    attrs.push({ kind: 'skill_description', value: String(p.description) })
  }
  for (const a of attrs) {
    await setSkillAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: skillEntityId,
      kind: a.kind,
      value: a.value,
    })
  }

  return { skillEntityId }
})

interface SkillUpdatePayload {
  skill_entity_id?: string
  slug?: string
  name?: string
  practice_area?: string
  description?: string | null
  when_to_use?: string
  body?: string
  user_invocable?: boolean
}

registerActionHandler('legal.skill.update', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as SkillUpdatePayload

  // Resolve the target either directly or by stable slug (idempotent re-seed).
  let entityId = p.skill_entity_id ?? null
  if (!entityId && p.slug) entityId = await findSkillBySlug(client, ctx.tenantId, p.slug.trim())
  if (!entityId) throw new Error('skill_entity_id or a known slug is required.')

  const updates: Array<{ kind: string; value: unknown }> = []
  if (p.name != null) {
    const name = p.name.trim()
    if (!name) throw new Error('name cannot be blank.')
    updates.push({ kind: 'skill_name', value: name })
  }
  if (p.practice_area != null) updates.push({ kind: 'skill_practice_area', value: p.practice_area })
  if (p.description != null)
    updates.push({ kind: 'skill_description', value: String(p.description) })
  if (p.when_to_use != null) {
    if (!p.when_to_use.trim()) throw new Error('when_to_use cannot be blank.')
    updates.push({ kind: 'skill_when_to_use', value: p.when_to_use })
  }
  if (p.body != null) {
    if (!p.body.trim()) throw new Error('body cannot be blank.')
    updates.push({ kind: 'skill_body', value: p.body })
  }
  if (p.user_invocable != null) {
    updates.push({ kind: 'skill_user_invocable', value: p.user_invocable })
  }

  for (const u of updates) {
    await setSkillAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId,
      kind: u.kind,
      value: u.value,
    })
  }

  return { skillEntityId: entityId, updated: updates.map((u) => u.kind) }
})
