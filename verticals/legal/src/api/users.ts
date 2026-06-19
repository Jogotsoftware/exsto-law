// User-management operation-core API (S9 — WP9.3). Reads go through executeQuery
// (RLS-bound to the caller's tenant+actor); writes go through submitAction. The
// admin gate (requireAdmin) is enforced here so EVERY adapter — MCP, REST, a
// future UI server action — inherits it, not just one route. "Admin" = the actor
// holds an active firm.admin scope (a permission scope whose action_kinds list
// the '*' wildcard), which is how migration 0074 marks the owning attorney.
import { submitAction, executeQuery, type ActionContext, type ActionResult } from '@exsto/substrate'

export interface FirmUser {
  actorId: string
  email: string | null
  displayName: string
  status: string
  scopes: string[]
  role: string | null
}

export interface FirmRole {
  roleName: string
  displayName: string
  description: string | null
  scopeNames: string[]
}

export interface WhoAmI {
  actorId: string
  isAdmin: boolean
  role: string | null
}

// True iff the acting actor holds an active admin (wildcard-action) scope.
export async function isAdmin(ctx: ActionContext): Promise<boolean> {
  const r = await executeQuery(
    ctx,
    `SELECT 1
       FROM actor_scope_assignment asa
       JOIN permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
      WHERE asa.actor_id = $1
        AND (asa.valid_to IS NULL OR asa.valid_to > now())
        AND (psd.valid_to IS NULL OR psd.valid_to > now())
        AND psd.action_kinds ? '*'
      LIMIT 1`,
    [ctx.actorId],
  )
  return r.rows.length > 0
}

export async function requireAdmin(ctx: ActionContext): Promise<void> {
  if (!(await isAdmin(ctx))) {
    throw new Error('Only a firm admin can manage users.')
  }
}

export async function listRoles(ctx: ActionContext): Promise<FirmRole[]> {
  const res = await executeQuery<{
    role_name: string
    display_name: string
    description: string | null
    default_permission_scopes: string[]
  }>(
    ctx,
    `SELECT role_name, display_name, description, default_permission_scopes
       FROM role_definition
      WHERE tenant_id = $1 AND (valid_to IS NULL OR valid_to > now())
      ORDER BY display_name`,
    [ctx.tenantId],
  )
  return res.rows.map((r) => ({
    roleName: r.role_name,
    displayName: r.display_name,
    description: r.description,
    scopeNames: r.default_permission_scopes ?? [],
  }))
}

const sortedKey = (xs: string[]) => [...xs].sort().join('|')

// Map an actor's active scope set back to a role display name (the inverse of
// "assign role materialises the role's scopes onto the actor").
function deriveRole(scopes: string[], roles: FirmRole[]): string | null {
  if (scopes.length === 0) return null
  const key = sortedKey(scopes)
  return roles.find((r) => sortedKey(r.scopeNames) === key)?.displayName ?? null
}

export async function listUsers(
  ctx: ActionContext,
): Promise<{ users: FirmUser[]; roles: FirmRole[] }> {
  await requireAdmin(ctx)
  const roles = await listRoles(ctx)
  const res = await executeQuery<{
    id: string
    email: string | null
    display_name: string
    status: string
    scopes: string[]
  }>(
    ctx,
    `SELECT a.id, a.external_id AS email, a.display_name, a.status,
            COALESCE(
              array_agg(psd.scope_name) FILTER (WHERE psd.scope_name IS NOT NULL),
              '{}'
            ) AS scopes
       FROM actor a
       LEFT JOIN actor_scope_assignment asa
         ON asa.actor_id = a.id AND (asa.valid_to IS NULL OR asa.valid_to > now())
       LEFT JOIN permission_scope_definition psd
         ON psd.id = asa.permission_scope_definition_id AND (psd.valid_to IS NULL OR psd.valid_to > now())
      WHERE a.tenant_id = $1 AND a.actor_type = 'human'
      GROUP BY a.id, a.external_id, a.display_name, a.status
      ORDER BY a.display_name`,
    [ctx.tenantId],
  )
  const users = res.rows.map((r) => ({
    actorId: r.id,
    email: r.email,
    displayName: r.display_name,
    status: r.status,
    scopes: r.scopes ?? [],
    role: deriveRole(r.scopes ?? [], roles),
  }))
  return { users, roles }
}

export async function whoAmI(ctx: ActionContext): Promise<WhoAmI> {
  const admin = await isAdmin(ctx)
  const roles = await listRoles(ctx)
  const res = await executeQuery<{ scopes: string[] }>(
    ctx,
    `SELECT COALESCE(array_agg(psd.scope_name) FILTER (WHERE psd.scope_name IS NOT NULL), '{}') AS scopes
       FROM actor_scope_assignment asa
       JOIN permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
      WHERE asa.actor_id = $1 AND (asa.valid_to IS NULL OR asa.valid_to > now())
        AND (psd.valid_to IS NULL OR psd.valid_to > now())`,
    [ctx.actorId],
  )
  return {
    actorId: ctx.actorId,
    isAdmin: admin,
    role: deriveRole(res.rows[0]?.scopes ?? [], roles),
  }
}

export interface InviteUserInput {
  email: string
  displayName?: string
  roleName?: string
}

export async function inviteUser(
  ctx: ActionContext,
  input: InviteUserInput,
): Promise<ActionResult> {
  await requireAdmin(ctx)
  return submitAction(ctx, {
    actionKindName: 'legal.user.invite',
    intentKind: 'enforcement',
    payload: { email: input.email, display_name: input.displayName, role_name: input.roleName },
  })
}

export async function assignUserRole(
  ctx: ActionContext,
  input: { actorId: string; roleName: string },
): Promise<ActionResult> {
  await requireAdmin(ctx)
  return submitAction(ctx, {
    actionKindName: 'legal.user.assign_role',
    intentKind: 'adjustment',
    payload: { actor_id: input.actorId, role_name: input.roleName },
  })
}

export async function deactivateUser(
  ctx: ActionContext,
  input: { actorId: string },
): Promise<ActionResult> {
  await requireAdmin(ctx)
  if (input.actorId === ctx.actorId) {
    throw new Error('You cannot deactivate your own account.')
  }
  return submitAction(ctx, {
    actionKindName: 'legal.user.deactivate',
    intentKind: 'enforcement',
    payload: { actor_id: input.actorId },
  })
}
