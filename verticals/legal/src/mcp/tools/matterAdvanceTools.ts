import { registerTool, type Tool } from '@exsto/mcp-tools'
import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'

// legal.matter.advance (ADR 0045 PR3) — the thin write adapter the matter Workflow
// window calls to move ONE matter one step through its bound lifecycle. It delegates
// to the legal.matter.advance action handler (handlers/workflow.ts), which guards the
// transition against the bound graph, advances the instance, mirrors matter_status,
// and emits workflow.advanced. This tool adds no logic — it only maps the window's
// camelCase input to the handler's snake_case payload and picks the intent_kind by
// gate (system/automatic = automatic_sync; attorney/client = adjustment), per the
// convention the handler's header documents. The handler still rejects a human
// firing a system/automatic gate, so this mapping cannot forge the audit trail.
interface MatterAdvanceInput {
  matterEntityId: string
  toState: string
  gate: 'automatic' | 'attorney' | 'client' | 'system'
  trigger?: string
}

const tool: Tool<MatterAdvanceInput, ActionResult> = {
  name: 'legal.matter.advance',
  description:
    "Advance a matter one step through its bound workflow lifecycle (ADR 0045). The graph decides legality — a to_state not reachable from the current state via an edge of this gate is rejected. Idempotent: advancing to the state the matter is already in is a no-op.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string', description: 'The matter to advance.' },
      toState: { type: 'string', description: 'The target lifecycle stage key.' },
      gate: {
        type: 'string',
        enum: ['automatic', 'attorney', 'client', 'system'],
        description:
          'Which gate fires the transition. attorney/client are the manual "Continue"/approve gates; system/automatic may only be fired by a system actor.',
      },
      trigger: {
        type: 'string',
        description:
          'Optional label for what triggered the advance (e.g. "continue"), recorded on the workflow.advanced event.',
      },
    },
    required: ['matterEntityId', 'toState', 'gate'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) =>
    submitAction(ctx, {
      actionKindName: 'legal.matter.advance',
      intentKind: input.gate === 'system' || input.gate === 'automatic' ? 'automatic_sync' : 'adjustment',
      payload: {
        matter_entity_id: input.matterEntityId,
        to_state: input.toState,
        gate: input.gate,
        trigger: input.trigger,
      },
    }),
}

registerTool(tool)
