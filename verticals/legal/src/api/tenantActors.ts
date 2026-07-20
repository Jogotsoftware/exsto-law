// WF-FIX-1 (WP5) — the ONE place AI/system writes resolve which actor they run as.
//
// History: every producing runtime hardcoded tenant-zero's agent actor
// ('…0001-000000000004') as its submitAction actor and reasoning-trace agent. In any
// other tenant that id has no actor row — actions carry a foreign actor, RLS/FK-fenced
// writes fail, and `automatic` advances are rejected as "human" (the #312 class). The
// resolver below prefers THIS tenant's own agent actor (Claude), then any system
// actor, and only then falls back to the tenant-zero const — so tenant-zero behavior
// is unchanged and a mis-seeded tenant degrades to the old behavior instead of dying.
//
// Standalone module (not capabilityRuntime) so generateDraft/reviewDocument/
// regenerateStage can import it without a static cycle — capabilityRuntime statically
// imports from both of those files.
import { withActionContext, type ActionContext } from '@exsto/substrate'

// Tenant-zero's Claude agent actor — the FALLBACK only, never the first choice.
export const TENANT_ZERO_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

// The tenant's own system/agent actor id (an `automatic`/`system` advance must come
// from a non-human actor). Prefers the tenant's `agent` actor (Claude), then any
// `system` actor; falls back to the tenant-zero agent const if the tenant seeds
// neither.
export async function resolveTenantSystemActorId(ctx: ActionContext): Promise<string> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM actor
        WHERE tenant_id = $1 AND actor_type IN ('agent', 'system')
        ORDER BY CASE actor_type WHEN 'agent' THEN 0 ELSE 1 END, id
        LIMIT 1`,
      [ctx.tenantId],
    )
    return r.rows[0]?.id ?? TENANT_ZERO_AGENT_ACTOR_ID
  })
}

// The agent ActionContext the producing runtimes submit as: THIS tenant's agent/system
// actor, resolved once per operation.
export async function resolveTenantAgentCtx(ctx: ActionContext): Promise<ActionContext> {
  return { tenantId: ctx.tenantId, actorId: await resolveTenantSystemActorId(ctx) }
}
