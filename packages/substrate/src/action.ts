import { randomUUID } from 'crypto'
import type { ActionContext } from './context.js'
import { withActionContext } from './context.js'
import { withSpan, type AutonomyTier, type DbClient, type IntentKind } from '@exsto/shared'
import { nextHlc } from './hlc.js'

export type ActionPayload = Record<string, unknown>

export interface ActionInput {
  actionKindName: string
  intentKind: IntentKind
  autonomyTier?: AutonomyTier
  targetKind?: string
  targetId?: string
  payload: ActionPayload
  reasoningTraceId?: string
}

export interface ActionResult {
  actionId: string
  effects: unknown[]
}

// Handlers receive the same DB client used to insert the action so the action
// and its effects commit atomically (invariant 9, ADR 0009).
export type ActionEffectHandler = (
  ctx: ActionContext,
  client: DbClient,
  payload: ActionPayload,
  actionId: string,
) => Promise<unknown>

const actionHandlers = new Map<string, ActionEffectHandler>()

export function registerActionHandler(actionKindName: string, handler: ActionEffectHandler): void {
  actionHandlers.set(actionKindName, handler)
}

export function hasActionHandler(actionKindName: string): boolean {
  return actionHandlers.has(actionKindName)
}

export function clearActionHandlers(): void {
  actionHandlers.clear()
}

export async function submitAction(ctx: ActionContext, input: ActionInput): Promise<ActionResult> {
  // Trace + time the whole action (transaction + handler) as the unit the 50ms
  // primitive-operation budget is measured against (CLAUDE.md soft rule 7).
  return withSpan('substrate.action.submit', () => submitActionInner(ctx, input), {
    'exsto.action_kind': input.actionKindName,
    'exsto.intent_kind': input.intentKind,
  })
}

async function submitActionInner(ctx: ActionContext, input: ActionInput): Promise<ActionResult> {
  // ADR 0046 — a fresh post-commit queue per action. Handlers push side effects
  // that must run AFTER this action's transaction commits (never inside it); the
  // queue is drained below, each callback in its own transaction/context.
  const afterCommit: Array<() => Promise<void>> = []
  const handlerCtx: ActionContext = { ...ctx, afterCommit }
  const result = await withActionContext(ctx, async (client) => {
    const kindResult = await client.query<{
      id: string
      default_autonomy_tier: AutonomyTier
      requires_reasoning_trace: boolean
    }>(
      `SELECT id, default_autonomy_tier, requires_reasoning_trace
       FROM action_kind_definition
       WHERE tenant_id = $1
         AND kind_name = $2
         AND status = 'active'
       ORDER BY valid_from DESC
       LIMIT 1`,
      [ctx.tenantId, input.actionKindName],
    )

    if (kindResult.rowCount === 0) {
      throw new Error(`Action kind not found: ${input.actionKindName}`)
    }

    const kind = kindResult.rows[0]!
    if (kind.requires_reasoning_trace && !input.reasoningTraceId) {
      throw new Error(`Action kind ${input.actionKindName} requires a reasoning trace.`)
    }

    // v1.0.1: an unregistered handler is a hard failure BEFORE anything is
    // recorded. Recording an action row with zero effects would be a silent lie
    // in the audit trail (invariant 9: the log mirrors real effects). The check
    // sits ahead of the INSERT so nothing — no action row, no events, no
    // partial state — exists for a rejected submission; the surrounding
    // transaction would also roll back any earlier statements.
    const handler = actionHandlers.get(input.actionKindName)
    if (!handler) {
      throw new Error(
        `No registered action handler for kind '${input.actionKindName}'. ` +
          `Refusing to record an effect-less action. Import the package that registers ` +
          `this handler (e.g. @exsto/primitives for the generic kinds) before submitting.`,
      )
    }

    const hlc = nextHlc()
    const autonomyTier = input.autonomyTier ?? kind.default_autonomy_tier
    const actionId = randomUUID()

    await client.query(
      `INSERT INTO action (
         id,
         tenant_id,
         action_kind_id,
         actor_id,
         intent_kind,
         autonomy_tier,
         reasoning_trace_id,
         target_kind,
         target_id,
         payload,
         hlc_physical_time,
         hlc_logical_counter,
         hlc_source_id,
         occurred_at,
         recorded_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())`,
      [
        actionId,
        ctx.tenantId,
        kind.id,
        ctx.actorId,
        input.intentKind,
        autonomyTier,
        input.reasoningTraceId ?? null,
        input.targetKind ?? null,
        input.targetId ?? null,
        input.payload,
        hlc.physical_time,
        hlc.logical_counter,
        hlc.source_id,
      ],
    )

    const effects = [await handler(handlerCtx, client, input.payload, actionId)]

    return { actionId, effects }
  })

  // The action transaction has COMMITTED. Run any post-commit side effects the
  // handler scheduled — each in its OWN transaction/context (withActionContext
  // inside the callback), so slow/fallible work (an LLM call) never rides the
  // action transaction (ADR 0046). A callback failure must NOT undo the committed
  // action, so errors are caught + logged; the callback owns its own honest
  // failure signal (e.g. an observation event).
  for (const cb of afterCommit) {
    try {
      await cb()
    } catch (err) {
      console.error('[submitAction] post-commit callback failed (action already committed):', err)
    }
  }

  return result
}
