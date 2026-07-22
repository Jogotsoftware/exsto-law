// User-management write paths (S9 — WP9.3). Firm staff are human ACTORS within
// the firm's tenant; a "role" is a role_definition whose default_permission_scopes
// are materialised onto the actor as actor_scope_assignment rows (what migration
// 0073's enforcement reads). Every write runs on the action's transaction, so it
// flows through submitAction (hard rule 1) — no direct INSERTs outside a handler.
import { randomUUID } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { canManage } from '../api/users.js'
import { insertEvent } from './common.js'

interface InvitePayload {
  email: string
  display_name?: string
  role_name?: string
}
interface AssignRolePayload {
  actor_id: string
  role_name: string
}
interface DeactivatePayload {
  actor_id: string
}

// Resolve a role's permission_scope_definition ids (active versions only).
async function scopeIdsForRole(
  client: DbClient,
  tenantId: string,
  roleName: string,
): Promise<string[]> {
  const role = await client.query<{ default_permission_scopes: string[] }>(
    `SELECT default_permission_scopes FROM role_definition
      WHERE tenant_id = $1 AND role_name = $2 AND (valid_to IS NULL OR valid_to > now())
      ORDER BY recorded_at DESC LIMIT 1`,
    [tenantId, roleName],
  )
  const roleRow = role.rows[0]
  if (!roleRow) throw new Error(`Unknown role: ${roleName}`)
  const scopeNames = roleRow.default_permission_scopes ?? []
  if (scopeNames.length === 0) return []
  const scopes = await client.query<{ id: string }>(
    `SELECT id FROM permission_scope_definition
      WHERE tenant_id = $1 AND scope_name = ANY($2::text[])
        AND (valid_to IS NULL OR valid_to > now())`,
    [tenantId, scopeNames],
  )
  return scopes.rows.map((r) => r.id)
}

// Close the actor's currently-active scope bindings (bitemporal close, not edit).
async function closeActiveScopes(
  client: DbClient,
  tenantId: string,
  actorId: string,
): Promise<void> {
  await client.query(
    `UPDATE actor_scope_assignment SET valid_to = now()
      WHERE tenant_id = $1 AND actor_id = $2 AND valid_to IS NULL`,
    [tenantId, actorId],
  )
}

async function assignScopes(
  client: DbClient,
  tenantId: string,
  actionId: string,
  actorId: string,
  scopeIds: string[],
): Promise<void> {
  for (const scopeId of scopeIds) {
    await client.query(
      `INSERT INTO actor_scope_assignment (id, tenant_id, action_id, actor_id, permission_scope_definition_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), tenantId, actionId, actorId, scopeId],
    )
  }
}

// --- Authorization floor (defense in depth) ---------------------------------
// The rank ceiling is ALSO enforced here, inside the handlers, so it holds on
// EVERY adapter — the api/users.ts wrapper, the generic substrate.action.submit
// dispatch, an MCP client — not just the API. Ranks are read from the DB
// (permission_scope_definition.rank, seeded by private.provision_firm_rbac), and
// the caller is ALWAYS ctx.actorId (the authenticated session), never the
// payload. A throw rolls the whole action back (submitAction runs in one tx).
// The matching DB RLS floor (migration 0078) backs these even if a handler is
// bypassed. "Admin" is the scope NAME firm.admin/super_admin, not a rank.
const ADMIN_SCOPES = ['firm.admin', 'firm.super_admin']

async function callerHasAdminScope(
  client: DbClient,
  tenantId: string,
  actorId: string,
): Promise<boolean> {
  const r = await client.query(
    `SELECT 1
       FROM actor_scope_assignment asa
       JOIN permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
      WHERE asa.tenant_id = $1 AND asa.actor_id = $2
        AND (asa.valid_to IS NULL OR asa.valid_to > now())
        AND (psd.valid_to IS NULL OR psd.valid_to > now())
        AND psd.scope_name = ANY($3::text[])
      LIMIT 1`,
    [tenantId, actorId, ADMIN_SCOPES],
  )
  return (r.rowCount ?? 0) > 0
}

// Highest rank among an actor's active scopes (0 if it holds none).
async function actorRank(client: DbClient, tenantId: string, actorId: string): Promise<number> {
  const r = await client.query<{ rank: number }>(
    `SELECT COALESCE(MAX(psd.rank), 0)::int AS rank
       FROM actor_scope_assignment asa
       JOIN permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
      WHERE asa.tenant_id = $1 AND asa.actor_id = $2
        AND (asa.valid_to IS NULL OR asa.valid_to > now())
        AND (psd.valid_to IS NULL OR psd.valid_to > now())`,
    [tenantId, actorId],
  )
  return r.rows[0]?.rank ?? 0
}

// Rank a role confers: the highest rank among its default scopes (0 if none).
async function roleRank(client: DbClient, tenantId: string, roleName: string): Promise<number> {
  const r = await client.query<{ rank: number }>(
    `SELECT COALESCE(MAX(psd.rank), 0)::int AS rank
       FROM role_definition rd
       CROSS JOIN LATERAL jsonb_array_elements_text(rd.default_permission_scopes) AS s(scope_name)
       JOIN permission_scope_definition psd
         ON psd.tenant_id = rd.tenant_id AND psd.scope_name = s.scope_name
        AND (psd.valid_to IS NULL OR psd.valid_to > now())
      WHERE rd.tenant_id = $1 AND rd.role_name = $2
        AND (rd.valid_to IS NULL OR rd.valid_to > now())`,
    [tenantId, roleName],
  )
  return r.rows[0]?.rank ?? 0
}

// Require the caller to hold an admin scope; return their effective rank (the
// ceiling for what they may grant or whom they may touch).
async function requireUserAdmin(
  client: DbClient,
  ctx: { tenantId: string; actorId: string },
): Promise<number> {
  if (!(await callerHasAdminScope(client, ctx.tenantId, ctx.actorId))) {
    throw new Error('Only a firm admin can manage users.')
  }
  return actorRank(client, ctx.tenantId, ctx.actorId)
}

// Create (or re-activate) a human actor and bind it to a role. A NEW user
// defaults to the least-privilege firm.paralegal role so they are never born
// unrestricted. Re-inviting an EXISTING user only re-binds scopes when a role is
// explicitly given — otherwise the current role is preserved, so a re-invite can
// never silently demote (e.g. an admin "re-invited" without a role; P2b).
registerActionHandler('legal.user.invite', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as InvitePayload
  const email = (p.email ?? '').trim().toLowerCase()
  if (!email) throw new Error('email is required')

  // Authorization floor: caller must be an admin; the role being conferred and
  // any existing target must rank strictly below the caller (no peer/superior).
  const callerR = await requireUserAdmin(client, ctx)

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM actor WHERE tenant_id = $1 AND lower(external_id) = $2 AND actor_type = 'human' LIMIT 1`,
    [ctx.tenantId, email],
  )
  const isExisting = Boolean(existing.rows[0])
  const actorId = existing.rows[0]?.id ?? randomUUID()

  if (isExisting) {
    const targetR = await actorRank(client, ctx.tenantId, actorId)
    if (targetR >= callerR) {
      throw new Error('You cannot modify a user at or above your own rank.')
    }
  }
  const explicitRole = (p.role_name ?? '').trim()
  // A NEW user defaults to the least-privilege paralegal role; an existing user
  // with no explicit role keeps their current role (nothing conferred → no check).
  const conferred = explicitRole || (isExisting ? '' : 'firm.paralegal')
  if (conferred && (await roleRank(client, ctx.tenantId, conferred)) >= callerR) {
    throw new Error('You cannot grant a role at or above your own.')
  }

  const displayName = (p.display_name ?? '').trim() || email
  if (isExisting) {
    await client.query(
      `UPDATE actor SET status = 'active', display_name = $3 WHERE tenant_id = $1 AND id = $2`,
      [ctx.tenantId, actorId, displayName],
    )
  } else {
    await client.query(
      `INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
       VALUES ($1, $2, 'human', $3, $4, 'active')`,
      [actorId, ctx.tenantId, email, displayName],
    )
  }

  // Preserve an existing user's role when none is specified (no silent demotion).
  if (isExisting && !explicitRole) {
    return { actorId, roleName: null, scopeCount: null, preserved: true }
  }

  const roleName = explicitRole || 'firm.paralegal'
  const scopeIds = await scopeIdsForRole(client, ctx.tenantId, roleName)
  await closeActiveScopes(client, ctx.tenantId, actorId)
  await assignScopes(client, ctx.tenantId, actionId, actorId, scopeIds)
  return { actorId, roleName, scopeCount: scopeIds.length }
})

// Re-bind an existing user's scopes to a (possibly different) role.
registerActionHandler('legal.user.assign_role', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as AssignRolePayload
  if (!p.actor_id) throw new Error('actor_id is required')

  // Authorization floor: admin only, no self-change, and you must strictly
  // out-rank BOTH the target you touch and the role you grant (canManage).
  const callerR = await requireUserAdmin(client, ctx)
  if (p.actor_id === ctx.actorId) {
    throw new Error('You cannot change your own role.')
  }
  const targetR = await actorRank(client, ctx.tenantId, p.actor_id)
  const grantedR = await roleRank(client, ctx.tenantId, p.role_name)
  if (!canManage(callerR, targetR, grantedR)) {
    throw new Error('You cannot assign a role at or above your own, or change a peer/superior.')
  }

  const scopeIds = await scopeIdsForRole(client, ctx.tenantId, p.role_name)
  await closeActiveScopes(client, ctx.tenantId, p.actor_id)
  await assignScopes(client, ctx.tenantId, actionId, p.actor_id, scopeIds)
  return { actorId: p.actor_id, roleName: p.role_name, scopeCount: scopeIds.length }
})

// Deactivate a user and revoke their access.
registerActionHandler('legal.user.deactivate', async (ctx, client, payload) => {
  const p = payload as unknown as DeactivatePayload
  if (!p.actor_id) throw new Error('actor_id is required')

  // Authorization floor: admin only, no self-deactivation, and you may only
  // deactivate a user ranking strictly below you (no locking out a peer/superior).
  const callerR = await requireUserAdmin(client, ctx)
  if (p.actor_id === ctx.actorId) {
    throw new Error('You cannot deactivate your own account.')
  }
  if ((await actorRank(client, ctx.tenantId, p.actor_id)) >= callerR) {
    throw new Error('You cannot deactivate a user at or above your own rank.')
  }

  const r = await client.query(
    `UPDATE actor SET status = 'inactive' WHERE tenant_id = $1 AND id = $2 AND actor_type = 'human'`,
    [ctx.tenantId, p.actor_id],
  )
  if (r.rowCount === 0) throw new Error(`User not found: ${p.actor_id}`)
  await closeActiveScopes(client, ctx.tenantId, p.actor_id)
  return { actorId: p.actor_id, status: 'inactive' }
})

// Delete a user from the Users & Roles list. Actors are identity rows in an
// append-only system — there is no hard delete (actor.status CHECK allows only
// active/inactive) — so "delete" = the deactivate mechanics plus a user.deleted
// event marker that listUsers excludes. Re-inviting the same email reactivates
// the actor (legal.user.invite flips status back), which is the intended undo.
registerActionHandler('legal.user.delete', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DeactivatePayload
  if (!p.actor_id) throw new Error('actor_id is required')

  // Same authorization floor as deactivate: admin only, never self, and only a
  // user ranking strictly below the caller.
  const callerR = await requireUserAdmin(client, ctx)
  if (p.actor_id === ctx.actorId) {
    throw new Error('You cannot delete your own account.')
  }
  if ((await actorRank(client, ctx.tenantId, p.actor_id)) >= callerR) {
    throw new Error('You cannot delete a user at or above your own rank.')
  }

  const r = await client.query<{ external_id: string | null; display_name: string }>(
    `UPDATE actor SET status = 'inactive'
      WHERE tenant_id = $1 AND id = $2 AND actor_type = 'human'
      RETURNING external_id, display_name`,
    [ctx.tenantId, p.actor_id],
  )
  const row = r.rows[0]
  if (!row) throw new Error(`User not found: ${p.actor_id}`)
  await closeActiveScopes(client, ctx.tenantId, p.actor_id)

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'user.deleted',
    primaryEntityId: null,
    data: { actor_id: p.actor_id, email: row.external_id, display_name: row.display_name },
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })
  return { actorId: p.actor_id, status: 'inactive', deleted: true }
})
