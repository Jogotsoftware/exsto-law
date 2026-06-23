// Per-matter workflow API (ADR 0045, PR6) — the thin write adapter the matter
// Workflow window calls to customize ONE matter's lifecycle graph. It submits
// legal.matter.set_workflow, which validates the graph (closed step-action
// vocabulary + linear), rejects a graph that would orphan the matter's current
// step, writes workflow_instance.states_override, and emits workflow.customized —
// see handlers/matterWorkflow.ts. The service's default lifecycle is never touched.
//
// intentKind 'adjustment' — tailoring an existing matter's steps (set by THIS
// adapter, not the handler, exactly as the advance/set_lifecycle adapters do).
import { submitAction, type ActionContext } from '@exsto/substrate'
import type { Lifecycle } from '../lifecycle/index.js'

export async function setMatterWorkflow(
  ctx: ActionContext,
  matterEntityId: string,
  graph: Lifecycle,
): Promise<{ workflowInstanceId: string; stageCount: number }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.matter.set_workflow',
    intentKind: 'adjustment',
    payload: { matter_entity_id: matterEntityId, states: graph },
  })
  return res.effects[0] as { workflowInstanceId: string; stageCount: number }
}
