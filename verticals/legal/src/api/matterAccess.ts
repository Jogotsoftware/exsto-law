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

// The firm's default matter owner — the PRACTICING attorney a new matter is
// assigned to at booking (the public matter.open path has no attorney in ctx).
// Preference: a firm.attorney (the working attorney role) BEFORE firm.admin /
// firm.super_admin — those are management/owner accounts, not who does the matter
// (at Pacheco Law the super_admins are the firm owner's own accounts and the
// practicing attorney holds firm.attorney). When the firm grows past one attorney
// this single-default gives way to routing rules. Read authoritatively
// (withSuperuser) since the caller is the intake actor, not an attorney. Returns
// null if the firm has no attorney/admin actor (matter stays unowned/firm-shared).
export async function resolveDefaultMatterOwner(tenantId: string): Promise<string | null> {
  return withSuperuser(async (client) => {
    const r = await client.query<{ actor_id: string }>(
      `SELECT asa.actor_id
         FROM actor_scope_assignment asa
         JOIN permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
         JOIN actor a ON a.id = asa.actor_id
        WHERE psd.tenant_id = $1 AND a.tenant_id = $1
          AND a.actor_type = 'human' AND a.status = 'active'
          AND (asa.valid_to IS NULL OR asa.valid_to > now())
          AND (psd.valid_to IS NULL OR psd.valid_to > now())
          AND psd.scope_name IN ('firm.attorney', 'firm.admin', 'firm.super_admin')
        ORDER BY (psd.scope_name = 'firm.attorney') DESC, psd.rank DESC, a.created_at ASC
        LIMIT 1`,
      [tenantId],
    )
    return r.rows[0]?.actor_id ?? null
  })
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
  if (await isAdmin(ctx)) return true // admins may send on any matter
  // ESIGN-BLOCK-1 (WP2): the tenant's own NON-HUMAN actors (agent/system) may send.
  // The workflow engine executes attorney-APPROVED definitions off-request as the
  // agent actor (capability runtime, workers) — an e-sign step on an owned matter
  // must not be refused because the engine is not the owner. The authorization is
  // the attorney's approval of the workflow; the send still attributes to the agent
  // actor (provenance unchanged). Human actors are unaffected. Authoritative read
  // (withSuperuser), same as the owner/grant read above.
  return withSuperuser(async (client) => {
    const r = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM actor
        WHERE tenant_id = $1 AND id = $2 AND actor_type IN ('agent', 'system')`,
      [ctx.tenantId, ctx.actorId],
    )
    return Number(r.rows[0]?.n ?? '0') > 0
  })
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
