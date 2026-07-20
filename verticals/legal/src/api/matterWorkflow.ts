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

// MACHINE-COMMS-1 (WP0) — the REPAIR control: stand up the workflow instance for
// an existing matter that has none (the silent-skip class), instantiating from the
// matter's service current lifecycle. intent 'correction': the instance should
// have existed from matter.open; this records that it now does.
export async function startMatterWorkflow(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<{ workflowInstanceId: string; started: boolean; startState: string }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.matter.set_workflow',
    intentKind: 'correction',
    payload: { matter_entity_id: matterEntityId, start: true },
  })
  return res.effects[0] as { workflowInstanceId: string; started: boolean; startState: string }
}

// WF-FIX-1 (WP4) — move ONE in-flight matter to its service's LATEST workflow
// version (successor-instance repin; see handlers/matterRepin.ts). intent
// 'correction': the pin should reflect the firm's current process.
export interface RepinMatterWorkflowResult {
  repinned: boolean
  workflowInstanceId: string
  supersededInstanceId?: string
  version: number
  state: string
  stateMapped?: boolean
  overrideCleared?: boolean
  summary?: string
}

export async function repinMatterWorkflow(
  ctx: ActionContext,
  matterEntityId: string,
  opts?: { targetState?: string; clearOverride?: boolean },
): Promise<RepinMatterWorkflowResult> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.matter.repin_workflow',
    intentKind: 'correction',
    payload: {
      matter_entity_id: matterEntityId,
      ...(opts?.targetState ? { target_state: opts.targetState } : {}),
      ...(opts?.clearOverride ? { clear_override: true } : {}),
    },
  })
  return res.effects[0] as RepinMatterWorkflowResult
}
