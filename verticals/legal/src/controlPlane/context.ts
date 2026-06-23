// Platform control-plane context helpers (ADR 0046). The control plane's ONLY
// cross-tenant capability is the set of guarded private.cp_* SECURITY DEFINER
// functions (migration 0101); these helpers call them as the non-owner app role
// (withAppRole), exactly as the REST adapter calls auth_resolve_api_key. Per-tenant
// operations use NO override — they build the target tenant's ActionContext and go
// through submitAction. Every function here re-asserts platform-admin, so the gate
// holds for ANY adapter (MCP, REST, a server action), not just the /admin route.
import { withAppRole } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

export const PLATFORM_TENANT_ID = '00000000-0000-0000-00FF-000000000001'
export const SANDBOX_TENANT_ID = '00000000-0000-0000-00FE-000000000001'

// Tenants the control plane must never offer as ordinary firm targets (they are
// infrastructure). Used to keep the platform tenant out of tenant lists / targets.
export const RESERVED_TENANT_IDS: ReadonlySet<string> = new Set([PLATFORM_TENANT_ID])

// True iff this actor is an active platform admin (private.is_platform_admin).
export async function isPlatformAdmin(actorId: string): Promise<boolean> {
  return withAppRole(async (client) => {
    const r = await client.query<{ ok: boolean }>(`SELECT private.is_platform_admin($1) AS ok`, [
      actorId,
    ])
    return r.rows[0]?.ok === true
  })
}

// Hard gate: throws unless the calling actor is a platform admin. Call at the top
// of every control-plane operation.
export async function assertPlatformAdmin(ctx: ActionContext): Promise<void> {
  if (!(await isPlatformAdmin(ctx.actorId))) {
    throw new Error('Platform admin access required.')
  }
}

export interface ResolvedPlatformAdmin {
  actorId: string
  tenantId: string
  displayName: string
}

// Resolve a verified Google email to its platform-admin actor at admin sign-in
// (private.cp_resolve_admin_by_email). The email-match against an active
// platform_admin row IS the gate — this runs BEFORE a session exists, so it is
// not is_platform_admin-guarded (analogous to auth_resolve_api_key). Returns null
// if the email is not an active platform admin.
export async function resolvePlatformAdminByEmail(
  email: string,
): Promise<ResolvedPlatformAdmin | null> {
  if (!email) return null
  return withAppRole(async (client) => {
    const r = await client.query<{
      actor_id: string
      tenant_id: string
      display_name: string
    }>(`SELECT * FROM private.cp_resolve_admin_by_email($1)`, [email])
    const row = r.rows[0]
    if (!row) return null
    return { actorId: row.actor_id, tenantId: row.tenant_id, displayName: row.display_name }
  })
}

// Build the ActionContext used to author per-tenant operations against a TARGET
// tenant. The actor is the target's dedicated "platform-console" system actor, so
// the target tenant's own audit honestly attributes the write to the platform
// console (resolved/created by private.cp_platform_actor_for, guarded).
export async function buildTargetContext(
  ctx: ActionContext,
  targetTenantId: string,
): Promise<ActionContext> {
  const actorId = await withAppRole(async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT private.cp_platform_actor_for($1, $2) AS id`,
      [ctx.actorId, targetTenantId],
    )
    return r.rows[0]?.id ?? null
  })
  if (!actorId) throw new Error('Could not resolve a platform actor for the target tenant.')
  return { tenantId: targetTenantId, actorId }
}

// Append a control-plane audit row (private.cp_audit). Returns the audit row id.
export async function recordControlPlaneAction(
  ctx: ActionContext,
  operation: string,
  targetTenantId: string | null,
  payload: Record<string, unknown>,
  result: Record<string, unknown> | null = null,
): Promise<string> {
  return withAppRole(async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT private.cp_audit($1, $2, $3, $4::jsonb, $5::jsonb) AS id`,
      [
        ctx.actorId,
        operation,
        targetTenantId,
        JSON.stringify(payload ?? {}),
        result ? JSON.stringify(result) : null,
      ],
    )
    return r.rows[0]!.id
  })
}
