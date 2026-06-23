import { registerTool, type Tool } from '@exsto/mcp-tools'
import { submitAction, type ActionContext } from '@exsto/substrate'
import type { Lifecycle } from '../../index.js'

// legal.matter.set_workflow (ADR 0045 PR6) — the thin write adapter the matter
// Workflow window's "Edit steps for this matter" mode calls to customize ONE
// matter's lifecycle (add / reorder / remove a step). It delegates to the
// legal.matter.set_workflow action handler, which validates the graph (closed
// step-action vocabulary + linear), rejects a graph that would orphan the matter's
// current step, writes workflow_instance.states_override, and emits
// workflow.customized. The service's default lifecycle is NEVER touched.
//
// ATTORNEY-ONLY: like the other workflow-authoring tools it is deliberately NOT in
// CLIENT_PORTAL_TOOLS / CLIENT_PORTAL_AUTHED_TOOLS (clientPolicy.ts is default-deny,
// so leaving it out is sufficient — a client must never re-shape a matter's steps).
// This tool adds no logic; it only sets intent_kind 'adjustment' and forwards the
// camelCase input as the handler's snake_case payload. `states` is an open jsonb
// array (the handler validates it) so the tool schema need not re-declare the full
// LifecycleStage shape.
interface MatterSetWorkflowInput {
  matterEntityId: string
  states: Lifecycle
}

const tool: Tool<MatterSetWorkflowInput, { workflowInstanceId: string; stageCount: number }> = {
  name: 'legal.matter.set_workflow',
  description:
    "Customize ONE matter's workflow (add / reorder / remove a step) WITHOUT altering the service default. Writes the tailored graph to this matter's instance only; the new graph is validated (closed step-action vocabulary + linear) and rejected if it would orphan the matter's current step.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string', description: 'The matter whose workflow to customize.' },
      states: {
        type: 'array',
        description:
          "The full tailored lifecycle graph for this matter (an array of stages, same shape as a service's workflow). Must keep the matter's current step.",
        items: { type: 'object', additionalProperties: true },
      },
    },
    required: ['matterEntityId', 'states'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) =>
    submitAction(ctx, {
      actionKindName: 'legal.matter.set_workflow',
      intentKind: 'adjustment',
      payload: { matter_entity_id: input.matterEntityId, states: input.states },
    }).then((res) => res.effects[0] as { workflowInstanceId: string; stageCount: number }),
}

registerTool(tool)
