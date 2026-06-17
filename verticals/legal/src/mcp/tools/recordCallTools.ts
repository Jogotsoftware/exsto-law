import { registerTool, type Tool } from '@exsto/mcp-tools'
import { recordManualCall, type RecordManualCallInput } from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

// Record a real consultation call against a matter from a transcript the attorney
// provides — the manual counterpart to the Granola webhook. Replaces the removed
// `legal.call.simulate` synthetic-data tool: a production pilot records real calls.
const tool: Tool<RecordManualCallInput, ActionResult> = {
  name: 'legal.call.record_manual',
  description:
    'Record a consultation call on a matter from a real transcript the attorney provides (paste/upload). Runs through the same projection as Granola, with manual transcript source and human provenance.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string', description: 'The matter the call belongs to.' },
      transcriptText: { type: 'string', description: 'The real call transcript text.' },
      summary: {
        type: 'object',
        description: 'Optional structured summary / notes for the call.',
        additionalProperties: true,
      },
      startedAtIso: { type: 'string', description: 'Optional ISO start time.' },
      endedAtIso: { type: 'string', description: 'Optional ISO end time.' },
    },
    required: ['matterEntityId', 'transcriptText'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) => recordManualCall(ctx, input),
}

registerTool(tool)
