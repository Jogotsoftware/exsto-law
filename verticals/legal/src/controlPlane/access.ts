// Access control-plane operations (ADR 0046): manage a target tenant's users,
// roles, and assignments from the admin console. These REUSE the firm
// user-management operation core (api/users.ts) through an impersonating target
// context (buildTargetContext). The impersonation actor holds firm.super_admin in
// the target (cp_platform_actor_for), so requireAdmin + the rank-ceiling floor in
// users.ts pass and the existing audited operations are inherited unchanged.
import type { ActionContext } from '@exsto/substrate'
import {
  listUsers,
  listRoles,
  inviteUser,
  assignUserRole,
  deactivateUser,
  type FirmUser,
  type FirmRole,
  type InviteUserInput,
} from '../api/users.js'
import { assertPlatformAdmin, buildTargetContext } from './context.js'

export async function listTenantUsers(
  ctx: ActionContext,
  tenantId: string,
): Promise<{ users: FirmUser[]; roles: FirmRole[] }> {
  await assertPlatformAdmin(ctx)
  const target = await buildTargetContext(ctx, tenantId)
  return listUsers(target)
}

export async function listTenantRoles(ctx: ActionContext, tenantId: string): Promise<FirmRole[]> {
  await assertPlatformAdmin(ctx)
  const target = await buildTargetContext(ctx, tenantId)
  return listRoles(target)
}

export async function inviteTenantUser(
  ctx: ActionContext,
  tenantId: string,
  input: InviteUserInput,
): Promise<{ ok: true }> {
  await assertPlatformAdmin(ctx)
  const target = await buildTargetContext(ctx, tenantId)
  await inviteUser(target, input)
  return { ok: true }
}

export async function assignTenantUserRole(
  ctx: ActionContext,
  tenantId: string,
  input: { actorId: string; roleName: string },
): Promise<{ ok: true }> {
  await assertPlatformAdmin(ctx)
  const target = await buildTargetContext(ctx, tenantId)
  await assignUserRole(target, input)
  return { ok: true }
}

export async function deactivateTenantUser(
  ctx: ActionContext,
  tenantId: string,
  input: { actorId: string },
): Promise<{ ok: true }> {
  await assertPlatformAdmin(ctx)
  const target = await buildTargetContext(ctx, tenantId)
  await deactivateUser(target, input)
  return { ok: true }
}
