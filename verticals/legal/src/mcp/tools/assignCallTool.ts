import { registerTool, type Tool } from '@exsto/mcp-tools'
import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'

// Route a call from the review queue (legal.call.list_unmatched) to a matter.
// Thin write adapter over the legal.call.assign action — the handler validates
// the call + matter and adds the call_of link with human provenance.
interface AssignCallInput {
  callEntityId: string
  matterEntityId: string
}

const tool: Tool<AssignCallInput, ActionResult> = {
  name: 'legal.call.assign',
  description:
    'Attach an unmatched call to a matter (from the review queue). The call then appears on that matter and its contact. Idempotent: a call already on a matter is left as-is.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      callEntityId: { type: 'string', description: 'The call_session to route.' },
      matterEntityId: { type: 'string', description: 'The matter to attach it to.' },
    },
    required: ['callEntityId', 'matterEntityId'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) =>
    submitAction(ctx, {
      actionKindName: 'legal.call.assign',
      intentKind: 'adjustment',
      payload: {
        call_entity_id: input.callEntityId,
        matter_entity_id: input.matterEntityId,
      },
    }),
}

registerTool(tool)
