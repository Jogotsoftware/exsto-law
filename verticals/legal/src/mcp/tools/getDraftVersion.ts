import { registerTool, type Tool } from '@exsto/mcp-tools'
import { getDraftVersion, type DraftDetail } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

interface Input {
  documentVersionId: string
}

const tool: Tool<Input, { draft: DraftDetail | null }> = {
  name: 'legal.draft.get',
  description: 'Fetch a draft document version with body, reasoning trace, and metadata.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    const draft = await getDraftVersion(ctx, input.documentVersionId)
    return { draft }
  },
}

registerTool(tool)
