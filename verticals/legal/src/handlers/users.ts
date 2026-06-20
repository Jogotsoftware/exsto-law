// User-management write paths (S9 — WP9.3). Firm staff are human ACTORS within
// the firm's tenant; a "role" is a role_definition whose default_permission_scopes
// are materialised onto the actor as actor_scope_assignment rows (what migration
// 0073's enforcement reads). Every write runs on the action's transaction, so it
// flows through submitAction (hard rule 1) — no direct INSERTs outside a handler.
import { randomUUID } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'

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

// Create (or re-activate) a human actor and bind it to a role. A NEW user
// defaults to the least-privilege firm.paralegal role so they are never born
// unrestricted. Re-inviting an EXISTING user only re-binds scopes when a role is
// explicitly given — otherwise the current role is preserved, so a re-invite can
// never silently demote (e.g. an admin "re-invited" without a role; P2b).
registerActionHandler('legal.user.invite', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as InvitePayload
  const email = (p.email ?? '').trim().toLowerCase()
  if (!email) throw new Error('email is required')

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM actor WHERE tenant_id = $1 AND lower(external_id) = $2 AND actor_type = 'human' LIMIT 1`,
    [ctx.tenantId, email],
  )
  const displayName = (p.display_name ?? '').trim() || email
  const isExisting = Boolean(existing.rows[0])
  const actorId = existing.rows[0]?.id ?? randomUUID()
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

  const explicitRole = (p.role_name ?? '').trim()
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
  const scopeIds = await scopeIdsForRole(client, ctx.tenantId, p.role_name)
  await closeActiveScopes(client, ctx.tenantId, p.actor_id)
  await assignScopes(client, ctx.tenantId, actionId, p.actor_id, scopeIds)
  return { actorId: p.actor_id, roleName: p.role_name, scopeCount: scopeIds.length }
})

// Deactivate a user and revoke their access.
registerActionHandler('legal.user.deactivate', async (ctx, client, payload) => {
  const p = payload as unknown as DeactivatePayload
  if (!p.actor_id) throw new Error('actor_id is required')
  const r = await client.query(
    `UPDATE actor SET status = 'inactive' WHERE tenant_id = $1 AND id = $2 AND actor_type = 'human'`,
    [ctx.tenantId, p.actor_id],
  )
  if (r.rowCount === 0) throw new Error(`User not found: ${p.actor_id}`)
  await closeActiveScopes(client, ctx.tenantId, p.actor_id)
  return { actorId: p.actor_id, status: 'inactive' }
})
