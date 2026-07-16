import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

// CLIENT-PORTAL-UI-1 CORRECTIVE (WP-C1) — fire a permission-scope allowlist
// amendment through the core: mandatory reasoning trace (the kind requires it),
// hash-chained action, handler re-points the row's provenance. See
// handlers/permissionScope.ts for the invariant story.

export interface AmendPermissionScopeInput {
  scopeName: string
  addActionKinds: string[]
  /** Why this amendment exists — recorded on the action AND the trace. */
  reason: string
}

export interface AmendPermissionScopeResult {
  scopeId: string
  scopeName: string
  added: string[]
  ensured: string[]
  actionKinds: string[]
}

// The trace's agent actor: the tenant's Claude agent actor when present, else
// the tenant's system actor (a system-authored correction still explains itself).
async function resolveTraceActor(ctx: ActionContext): Promise<string> {
  return withActionContext(ctx, async (client) => {
    const agent = await client.query<{ id: string }>(
      `SELECT id FROM actor
       WHERE tenant_id = $1 AND actor_type = 'agent' AND status = 'active'
       ORDER BY created_at ASC LIMIT 1`,
      [ctx.tenantId],
    )
    if (agent.rows[0]) return agent.rows[0].id
    const system = await client.query<{ id: string }>(
      `SELECT id FROM actor
       WHERE tenant_id = $1 AND actor_type = 'system' AND status = 'active'
       ORDER BY created_at ASC LIMIT 1`,
      [ctx.tenantId],
    )
    const id = system.rows[0]?.id
    if (!id) throw new Error('No agent or system actor to author the reasoning trace.')
    return id
  })
}

export async function amendPermissionScope(
  ctx: ActionContext,
  input: AmendPermissionScopeInput,
): Promise<AmendPermissionScopeResult> {
  const reason = (input.reason ?? '').trim()
  if (!reason) throw new Error('A reason is required for a permission-scope amendment.')

  const traceId = randomUUID()
  const traceActor = await resolveTraceActor(ctx)
  await withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO reasoning_trace (
         id, tenant_id, agent_actor_id, prompt, evidence, alternatives,
         conclusion, confidence, model_identity, trace
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb)`,
      [
        traceId,
        ctx.tenantId,
        traceActor,
        `Amend permission scope '${input.scopeName}': allow ${input.addActionKinds.join(', ')}.`,
        JSON.stringify([{ kind: 'reason', detail: reason }]),
        JSON.stringify([
          {
            option: 'supersede the scope-def row',
            rejected:
              'actor_scope_assignment hard-binds to the scope-def id; a new id orphans every assignment (0073 enforcement joins by id).',
          },
        ]),
        `In-place allowlist amendment with provenance re-pointed to the recording action.`,
        0.95,
        'claude-fable-5',
        JSON.stringify({ scope_name: input.scopeName, add_action_kinds: input.addActionKinds }),
      ],
    )
  })

  const res = await submitAction(ctx, {
    actionKindName: 'permission_scope.amend',
    intentKind: 'correction',
    reasoningTraceId: traceId,
    payload: {
      scope_name: input.scopeName,
      add_action_kinds: input.addActionKinds,
      reason,
    },
  })
  return res.effects[0] as unknown as AmendPermissionScopeResult
}
