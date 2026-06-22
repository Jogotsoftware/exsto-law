// Matter ownership / send-access handlers (0087, PR B).
//   legal.matter.set_owner    — set/transfer the matter_owner attribute.
//   legal.matter.grant_access — replace the matter_access_actor_ids array.
//
// Authorization is enforced HERE, in the handler — not only in the api wrapper —
// because the generic substrate.action.submit path lets any actor with the action
// scope call these directly, bypassing an api-layer guard (the same escalation
// class RBAC 0078 closed). A handler throw rolls the action back, so an
// unauthorized set/grant records nothing.
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, lookupKindId, getLatestAttributeValue } from './common.js'

const ADMIN_SCOPES = ['firm.admin', 'firm.super_admin']

// True iff the actor holds an active firm.admin / firm.super_admin scope. Uses the
// handler's own (tenant-scoped) client so it sees the committed grant state.
async function actorIsAdmin(client: DbClient, tenantId: string, actorId: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1
       FROM actor_scope_assignment asa
       JOIN permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
      WHERE asa.actor_id = $1
        AND psd.tenant_id = $2
        AND (asa.valid_to IS NULL OR asa.valid_to > now())
        AND (psd.valid_to IS NULL OR psd.valid_to > now())
        AND psd.scope_name = ANY($3::text[])
      LIMIT 1`,
    [actorId, tenantId, ADMIN_SCOPES],
  )
  return r.rows.length > 0
}

// Read the matter's current owner (latest open matter_owner attribute), or null.
async function currentOwner(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
): Promise<string | null> {
  return getLatestAttributeValue<string>(client, tenantId, matterEntityId, 'matter_owner')
}

// Close the open value of a matter attribute (valid_to is the only mutable column
// on an open fact row — append-only invariant), so the freshly-inserted row is the
// sole open value.
async function closeOpen(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
  attrKindId: string,
): Promise<void> {
  await client.query(
    `UPDATE attribute SET valid_to = now()
      WHERE tenant_id = $1 AND entity_id = $2 AND attribute_kind_id = $3 AND valid_to IS NULL`,
    [tenantId, matterEntityId, attrKindId],
  )
}

registerActionHandler('legal.matter.set_owner', async (ctx, client, payload, actionId) => {
  const p = payload as { matter_entity_id?: string; owner_actor_id?: string }
  if (!p.matter_entity_id) throw new Error('matter_entity_id is required')
  if (!p.owner_actor_id) throw new Error('owner_actor_id is required')

  // Only the current owner, a firm admin, OR anyone on an as-yet-UNOWNED matter
  // (legacy / firm-shared) may set the owner. A grantee cannot seize ownership.
  const owner = await currentOwner(client, ctx.tenantId, p.matter_entity_id)
  const admin = await actorIsAdmin(client, ctx.tenantId, ctx.actorId)
  if (owner !== null && owner !== ctx.actorId && !admin) {
    throw new Error('Only the matter owner or a firm admin can change the matter owner.')
  }

  const attrKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'matter_owner',
  )
  await closeOpen(client, ctx.tenantId, p.matter_entity_id, attrKindId)
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: p.matter_entity_id,
    attributeKindId: attrKindId,
    value: p.owner_actor_id,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })
  return { matterEntityId: p.matter_entity_id, ownerActorId: p.owner_actor_id }
})

registerActionHandler('legal.matter.grant_access', async (ctx, client, payload, actionId) => {
  const p = payload as { matter_entity_id?: string; actor_ids?: unknown }
  if (!p.matter_entity_id) throw new Error('matter_entity_id is required')
  const actorIds = Array.isArray(p.actor_ids)
    ? [...new Set(p.actor_ids.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    : []

  // Only the owner or a firm admin may change the grant list (a grantee cannot
  // re-grant, which would let access chain past the owner's intent).
  const owner = await currentOwner(client, ctx.tenantId, p.matter_entity_id)
  const admin = await actorIsAdmin(client, ctx.tenantId, ctx.actorId)
  if (owner !== ctx.actorId && !admin) {
    throw new Error('Only the matter owner or a firm admin can change matter access.')
  }

  const attrKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'matter_access_actor_ids',
  )
  await closeOpen(client, ctx.tenantId, p.matter_entity_id, attrKindId)
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: p.matter_entity_id,
    attributeKindId: attrKindId,
    value: actorIds,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })
  return { matterEntityId: p.matter_entity_id, actorIds }
})
