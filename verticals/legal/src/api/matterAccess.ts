// Matter ownership + send authorization (0088, PR B) — operation-core API.
//
// An attorney may send CLIENT email (compose / reply) and signature requests on a
// matter only if they OWN it, are GRANTED access, or are a firm admin. Ownership
// is the matter_owner attribute (stamped at creation); grants are the
// matter_access_actor_ids JSON array. Both are written through the action layer
// (legal.matter.set_owner / grant_access), whose handlers enforce who-may-change.
//
// The send guard (assertCanSendOnMatter) lives here so every adapter — the mail
// MCP tools, the esign send, a future REST/UI — inherits it from one place. A
// matter with NO owner is treated as firm-shared (any attorney may send): this
// introduces ownership without regressing pre-0088 matters; enforcement bites the
// moment a matter has an owner, which every newly-created matter does.
//
// Read note: the owner/grant read is AUTHORITATIVE (withSuperuser, tenant-filtered),
// NOT bound to the caller's read-RLS — an authorization decision must not depend on
// whether the subject can see the data, or RLS could make an owned matter look
// unowned and wrongly trip the fail-open (firm-shared) rule. This mirrors how
// attorneySession re-checks the actor with withSuperuser. The admin check
// (isAdmin) stays RLS-bound: an actor can always see their own scope grants.
import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'
import { withSuperuser } from '@exsto/shared'
import { isAdmin } from './users.js'

export interface MatterAccess {
  ownerActorId: string | null
  grantedActorIds: string[]
}

// The matter's current owner + grant list (latest open values), read
// authoritatively (tenant-scoped, RLS-bypassing) in a single round-trip.
export async function getMatterAccess(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<MatterAccess> {
  return withSuperuser(async (client) => {
    const r = await client.query<{ kind_name: string; value: unknown }>(
      `SELECT DISTINCT ON (akd.kind_name) akd.kind_name, a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1 AND a.entity_id = $2
          AND akd.kind_name IN ('matter_owner', 'matter_access_actor_ids')
          AND (a.valid_to IS NULL OR a.valid_to > now())
        ORDER BY akd.kind_name, a.valid_from DESC, a.recorded_at DESC, a.id DESC`,
      [ctx.tenantId, matterEntityId],
    )
    let ownerActorId: string | null = null
    let grantedActorIds: string[] = []
    for (const row of r.rows) {
      if (row.kind_name === 'matter_owner') {
        ownerActorId = typeof row.value === 'string' ? row.value : null
      } else if (row.kind_name === 'matter_access_actor_ids' && Array.isArray(row.value)) {
        grantedActorIds = row.value.filter((x): x is string => typeof x === 'string')
      }
    }
    return { ownerActorId, grantedActorIds }
  })
}

// Cheap owner/grant membership test (no admin query). null owner → firm-shared.
function hasDirectAccess(ctx: ActionContext, access: MatterAccess): boolean {
  return (
    access.ownerActorId === null ||
    access.ownerActorId === ctx.actorId ||
    access.grantedActorIds.includes(ctx.actorId)
  )
}

// May ctx.actorId send client mail / signature requests on this matter?
export async function canSendOnMatter(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<boolean> {
  const access = await getMatterAccess(ctx, matterEntityId)
  if (hasDirectAccess(ctx, access)) return true
  return isAdmin(ctx) // admins may send on any matter
}

export async function assertCanSendOnMatter(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<void> {
  if (!(await canSendOnMatter(ctx, matterEntityId))) {
    throw new Error(
      'You are not authorized to send on this matter. Ask the matter owner or a firm admin for access.',
    )
  }
}

// Filter matter ids to those ctx.actorId may send on (admins: all). Resolves the
// admin check at most once.
export async function authorizedSendMatters(
  ctx: ActionContext,
  matterEntityIds: string[],
): Promise<string[]> {
  const unique = [...new Set(matterEntityIds.filter(Boolean))]
  if (unique.length === 0) return []
  let admin: boolean | null = null
  const out: string[] = []
  for (const id of unique) {
    const access = await getMatterAccess(ctx, id)
    if (hasDirectAccess(ctx, access)) {
      out.push(id)
      continue
    }
    if (admin === null) admin = await isAdmin(ctx)
    if (admin) out.push(id)
  }
  return out
}

// Set / transfer a matter's owner. The handler enforces (owner | admin | unowned).
export async function setMatterOwner(
  ctx: ActionContext,
  input: { matterEntityId: string; ownerActorId: string },
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'legal.matter.set_owner',
    intentKind: 'adjustment',
    payload: { matter_entity_id: input.matterEntityId, owner_actor_id: input.ownerActorId },
  })
}

// Replace a matter's access-grant list. The handler enforces (owner | admin).
export async function grantMatterAccess(
  ctx: ActionContext,
  input: { matterEntityId: string; actorIds: string[] },
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'legal.matter.grant_access',
    intentKind: 'adjustment',
    payload: { matter_entity_id: input.matterEntityId, actor_ids: input.actorIds },
  })
}
