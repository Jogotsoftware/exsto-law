import { registerTool, type Tool } from '@exsto/mcp-tools'
import { createMatter, type CreateMatterInput } from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

const tool: Tool<CreateMatterInput, ActionResult> = {
  name: 'legal.matter.create',
  description: 'Open a new legal matter and create the client_contact entity.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => createMatter(ctx, input),
}

registerTool(tool)
