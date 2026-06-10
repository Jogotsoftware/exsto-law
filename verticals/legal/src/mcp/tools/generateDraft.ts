import { registerTool, type Tool } from '@exsto/mcp-tools'
import { generateDraft, type GenerateDraftInput } from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

const tool: Tool<GenerateDraftInput, ActionResult> = {
  name: 'legal.draft.generate',
  description:
    "Run the Sage drafting agent (Claude) against the matter's questionnaire + transcript and produce a draft document.",
  mode: 'write',
  handler: (ctx: ActionContext, input) => generateDraft(ctx, input),
}

registerTool(tool)
