// WF-FIX-1 — PROD ops: unstick ONE live matter parked by the pre-fix workflow shape.
//
// What it does (all through the action layer, tenant's own system actor):
//   1. legal.matter.repin_workflow — move the matter to its service's LATEST
//      workflow version (successor instance; settle drains any non-blocking prefix
//      and fires the producing auto-run for the resting stage).
//   2. If the matter then rests on a stage whose exit edge waits on
//      'intake.completed' AND the matter already has a questionnaire response,
//      dispatch intake.completed (matter.open pre-dated the fix, so the signal
//      never fired) — intent 'correction'.
//
// Usage:
//   UNSTICK_TENANT_ID=<tenant uuid> UNSTICK_MATTER_ID=<matter entity uuid> \
//     npx tsx --env-file=.env.local verticals/legal/demo/unstick-pacheco-matter.ts
//
// Requires migrations 0176/0177 applied (intake.completed / repin kinds present in
// the tenant via the 0174 vocab sweep).
process.env.LEGAL_WORKFLOW_ENGINE = process.env.LEGAL_WORKFLOW_ENGINE ?? '1'

import '@exsto/legal'
import { repinMatterWorkflow, resolveTenantSystemActorId } from '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

const tenantId = process.env.UNSTICK_TENANT_ID?.trim()
const matterEntityId = process.env.UNSTICK_MATTER_ID?.trim()
if (!tenantId || !matterEntityId) {
  console.error('Set UNSTICK_TENANT_ID and UNSTICK_MATTER_ID.')
  process.exit(1)
}

async function main(): Promise<void> {
  const bootstrapCtx: ActionContext = { tenantId: tenantId!, actorId: 'bootstrap' }
  const actorId = await resolveTenantSystemActorId(bootstrapCtx)
  const ctx: ActionContext = { tenantId: tenantId!, actorId }
  console.log(`tenant ${tenantId} · matter ${matterEntityId} · acting as ${actorId}`)

  const targetState = process.env.UNSTICK_TARGET_STATE?.trim() || undefined
  const repin = await repinMatterWorkflow(ctx, matterEntityId!, { targetState })
  console.log('repin:', JSON.stringify(repin))

  const info = await withActionContext(ctx, async (client) => {
    const inst = await client.query<{ current_state: string; workflow_definition_id: string }>(
      `SELECT current_state, workflow_definition_id FROM workflow_instance
        WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
      [tenantId, matterEntityId],
    )
    const def = inst.rows[0]
      ? await client.query<{ states: unknown }>(
          `SELECT states FROM workflow_definition WHERE tenant_id=$1 AND id=$2`,
          [tenantId, inst.rows[0].workflow_definition_id],
        )
      : null
    const hasQuestionnaire = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id=r.relationship_kind_id
        WHERE r.tenant_id=$1 AND r.source_entity_id=$2 AND rkd.kind_name='matter_has_questionnaire'`,
      [tenantId, matterEntityId],
    )
    return {
      state: inst.rows[0]?.current_state ?? '(none)',
      states: (def?.rows[0]?.states ?? []) as Array<{
        key: string
        advances_to?: Array<{ on?: string }>
      }>,
      hasQuestionnaire: Number(hasQuestionnaire.rows[0]?.n ?? '0') > 0,
    }
  })
  console.log(`resting at: ${info.state}`)

  const stage = info.states.find((s) => s.key === info.state)
  const waitsOnIntake = stage?.advances_to?.some((e) => e.on === 'intake.completed') ?? false
  if (waitsOnIntake && info.hasQuestionnaire) {
    console.log('stage waits on intake.completed and intake exists — dispatching the signal…')
    await submitAction(ctx, {
      actionKindName: 'event.record',
      intentKind: 'correction',
      payload: {
        event_kind_name: 'intake.completed',
        primary_entity_id: matterEntityId,
        data: { backfill: true, reason: 'matter.open pre-dated the intake.completed dispatch' },
        source_type: 'system',
      },
    })
    // event.record does not dispatch into the engine — drive it explicitly the way
    // the real handlers do, wrapped by a correction action.
    const probe = await submitAction(ctx, {
      actionKindName: 'event.record',
      intentKind: 'correction',
      payload: {
        event_kind_name: 'observation',
        primary_entity_id: matterEntityId,
        data: { kind: 'wffix_unstick_dispatch' },
        source_type: 'system',
      },
    })
    const { dispatchLifecycleEvent } = await import('../src/lifecycle/executor.js')
    await withActionContext(ctx, async (client) => {
      await dispatchLifecycleEvent(client, ctx, matterEntityId!, 'intake.completed', probe.actionId)
    })
  }

  const finalState = await withActionContext(ctx, async (client) => {
    const r = await client.query<{ current_state: string }>(
      `SELECT current_state FROM workflow_instance WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
      [tenantId, matterEntityId],
    )
    return r.rows[0]?.current_state ?? '(none)'
  })
  console.log(`final resting stage: ${finalState}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
