// User-management operation-core API (S9 — WP9.3 + role ladder). Reads go
// through executeQuery (RLS-bound to the caller's tenant+actor); writes go
// through submitAction. The admin gate AND the rank hierarchy are enforced here
// so EVERY adapter — MCP, REST, a future UI server action — inherits them.
//
// The ladder (rank): super_admin(100) > admin(80) > attorney(50) > paralegal(30).
// "Admin" = holds the firm.admin or firm.super_admin SCOPE (keyed on scope NAME,
// not "has a `*` wildcard" — attorney/paralegal are wildcard scopes too, and
// must not read as admin). Hierarchy rule: you may only assign a role BELOW your
// own rank and only act on a user BELOW your own rank — so an admin manages
// attorneys/paralegals but cannot touch (or mint) another admin or a super_admin.
import { submitAction, executeQuery, type ActionContext, type ActionResult } from '@exsto/substrate'

export const ADMIN_SCOPES = ['firm.admin', 'firm.super_admin'] as const

// Rank lives on the scope ROW in the DB (permission_scope_definition.rank,
// seeded by private.provision_firm_rbac) — schema-as-data, so the DB enforcement
// floor (migration 0078) and this layer share ONE source of truth and cannot
// drift. A RankMap is scope_name -> rank for the tenant's active scopes; an
// unmapped/custom scope ranks 0 (no management authority).
export type RankMap = Record<string, number>

// Highest rank among a set of scope names (an actor's effective rank).
export function rankOfScopes(scopeNames: string[], ranks: RankMap): number {
  return scopeNames.reduce((max, s) => Math.max(max, ranks[s] ?? 0), 0)
}

// Pure hierarchy check: may a caller of rank `caller` set a target (current rank
// `target`) to a role of rank `role`? You must out-rank the target you touch and
// the role you grant — strictly, so no one creates a peer or promotes upward.
export function canManage(caller: number, target: number, role: number): boolean {
  return caller > target && caller > role
}

export interface FirmUser {
  actorId: string
  email: string | null
  displayName: string
  status: string
  scopes: string[]
  role: string | null
  rank: number
}

export interface FirmRole {
  roleName: string
  displayName: string
  description: string | null
  scopeNames: string[]
  rank: number
}

export interface WhoAmI {
  actorId: string
  isAdmin: boolean
  role: string | null
  rank: number
}

// Active scope names held by an actor.
async function scopeNamesFor(ctx: ActionContext, actorId: string): Promise<string[]> {
  const r = await executeQuery<{ scope_name: string }>(
    ctx,
    `SELECT psd.scope_name
       FROM actor_scope_assignment asa
       JOIN permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
      WHERE asa.actor_id = $1
        AND (asa.valid_to IS NULL OR asa.valid_to > now())
        AND (psd.valid_to IS NULL OR psd.valid_to > now())`,
    [actorId],
  )
  return r.rows.map((x) => x.scope_name)
}

// scope_name -> rank for the tenant's active scopes (the rank source of truth).
async function scopeRanks(ctx: ActionContext): Promise<RankMap> {
  const r = await executeQuery<{ scope_name: string; rank: number }>(
    ctx,
    `SELECT scope_name, MAX(rank)::int AS rank
       FROM permission_scope_definition
      WHERE tenant_id = $1 AND (valid_to IS NULL OR valid_to > now())
      GROUP BY scope_name`,
    [ctx.tenantId],
  )
  return Object.fromEntries(r.rows.map((x) => [x.scope_name, x.rank]))
}

// True iff the acting actor holds an active admin (firm.admin/super_admin) scope.
export async function isAdmin(ctx: ActionContext): Promise<boolean> {
  const r = await executeQuery(
    ctx,
    `SELECT 1
       FROM actor_scope_assignment asa
       JOIN permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
      WHERE asa.actor_id = $1
        AND (asa.valid_to IS NULL OR asa.valid_to > now())
        AND (psd.valid_to IS NULL OR psd.valid_to > now())
        AND psd.scope_name = ANY($2::text[])
      LIMIT 1`,
    [ctx.actorId, ADMIN_SCOPES as unknown as string[]],
  )
  return r.rows.length > 0
}

export async function requireAdmin(ctx: ActionContext): Promise<void> {
  if (!(await isAdmin(ctx))) {
    throw new Error('Only a firm admin can manage users.')
  }
}

// The caller's own effective rank.
async function callerRank(ctx: ActionContext): Promise<number> {
  return rankOfScopes(await scopeNamesFor(ctx, ctx.actorId), await scopeRanks(ctx))
}

export async function listRoles(ctx: ActionContext): Promise<FirmRole[]> {
  const ranks = await scopeRanks(ctx)
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
    rank: rankOfScopes(r.default_permission_scopes ?? [], ranks),
  }))
}

const sortedKey = (xs: string[]) => [...xs].sort().join('|')

// Map an actor's active scope set back to a role display name (the inverse of
// "assign role materialises the role's scopes onto the actor"). Prefer an exact
// match (handles custom roles); otherwise fall back to the highest-rank role
// whose scopes the actor fully holds, so a multi-scope actor (e.g. a partial
// failure left two scopes) still resolves to a sensible label instead of null —
// consistent with rankOfScopes, which the security guards use.
function deriveRole(scopes: string[], roles: FirmRole[]): string | null {
  if (scopes.length === 0) return null
  const key = sortedKey(scopes)
  const exact = roles.find((r) => sortedKey(r.scopeNames) === key)
  if (exact) return exact.displayName
  const has = new Set(scopes)
  const covered = roles
    .filter((r) => r.scopeNames.length > 0 && r.scopeNames.every((s) => has.has(s)))
    .sort((a, b) => b.rank - a.rank)
  return covered[0]?.displayName ?? null
}

export async function listUsers(
  ctx: ActionContext,
): Promise<{ users: FirmUser[]; roles: FirmRole[] }> {
  await requireAdmin(ctx)
  const roles = await listRoles(ctx)
  const ranks = await scopeRanks(ctx)
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
    rank: rankOfScopes(r.scopes ?? [], ranks),
  }))
  return { users, roles }
}

export async function whoAmI(ctx: ActionContext): Promise<WhoAmI> {
  const admin = await isAdmin(ctx)
  const roles = await listRoles(ctx)
  const ranks = await scopeRanks(ctx)
  const scopes = await scopeNamesFor(ctx, ctx.actorId)
  return {
    actorId: ctx.actorId,
    isAdmin: admin,
    role: deriveRole(scopes, roles),
    rank: rankOfScopes(scopes, ranks),
  }
}

// Rank a role would confer (by its name), and a specific user's current rank.
async function roleRankByName(ctx: ActionContext, roleName: string): Promise<number> {
  const roles = await listRoles(ctx)
  const role = roles.find((r) => r.roleName === roleName)
  if (!role) throw new Error(`Unknown role: ${roleName}`)
  return role.rank
}

async function actorRank(ctx: ActionContext, actorId: string): Promise<number> {
  return rankOfScopes(await scopeNamesFor(ctx, actorId), await scopeRanks(ctx))
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
  const mine = await callerRank(ctx)

  // Cannot invite/grant a role at or above your own rank.
  if (input.roleName) {
    const wanted = await roleRankByName(ctx, input.roleName)
    if (wanted >= mine) {
      throw new Error('You cannot grant a role at or above your own.')
    }
  }
  // If the email is an existing user, re-inviting must not let you reach across
  // rank (e.g. an admin "re-inviting" another admin down to paralegal).
  const existing = await executeQuery<{ id: string }>(
    ctx,
    `SELECT id FROM actor
      WHERE tenant_id = $1 AND lower(external_id) = lower($2) AND actor_type = 'human' LIMIT 1`,
    [ctx.tenantId, input.email.trim()],
  )
  const existingId = existing.rows[0]?.id
  if (existingId) {
    const targetRank = await actorRank(ctx, existingId)
    if (targetRank >= mine) {
      throw new Error('You cannot modify a user at or above your own rank.')
    }
  }

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
  if (input.actorId === ctx.actorId) {
    throw new Error('You cannot change your own role.')
  }
  const mine = await callerRank(ctx)
  const target = await actorRank(ctx, input.actorId)
  const wanted = await roleRankByName(ctx, input.roleName)
  if (!canManage(mine, target, wanted)) {
    throw new Error('You cannot assign a role at or above your own, or change a peer/superior.')
  }
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
  const mine = await callerRank(ctx)
  const target = await actorRank(ctx, input.actorId)
  if (target >= mine) {
    throw new Error('You cannot deactivate a user at or above your own rank.')
  }
  return submitAction(ctx, {
    actionKindName: 'legal.user.deactivate',
    intentKind: 'enforcement',
    payload: { actor_id: input.actorId },
  })
}
