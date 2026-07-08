import type { ActorId, TenantId } from '@exsto/shared'
import { withTenant, type DbClient } from '@exsto/shared'

export interface ActionContext {
  tenantId: TenantId
  actorId: ActorId
  // Optional post-commit side-effect queue (ADR 0046). A handler may push callbacks
  // here; submitAction runs them AFTER the action's transaction has committed, each
  // in its own transaction/context. This is the sanctioned way to trigger slow or
  // fallible work (e.g. an LLM call) from a handler WITHOUT putting it inside the
  // action transaction. submitAction attaches a fresh queue per call and drains it;
  // callers never populate this themselves.
  afterCommit?: Array<() => Promise<void>>
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
