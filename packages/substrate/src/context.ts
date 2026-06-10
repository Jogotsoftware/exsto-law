import type { ActorId, TenantId } from '@exsto/shared'
import { withTenant, type DbClient } from '@exsto/shared'

export interface ActionContext {
  tenantId: TenantId
  actorId: ActorId
}

// Binds the action context (tenant + actor) to a Postgres session so RLS sees
// both for the duration of the callback. Use this anywhere substrate code
// needs a database client with RLS engaged.
export async function withActionContext<T>(
  ctx: ActionContext,
  callback: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withTenant(ctx.tenantId, callback, { actorId: ctx.actorId })
}
