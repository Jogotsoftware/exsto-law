import { registerTool, type Tool } from '@exsto/mcp-tools'
import { listPendingDraftVersions, type PendingDraftSummary } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

const tool: Tool<Record<string, never>, { drafts: PendingDraftSummary[] }> = {
  name: 'legal.draft.list_pending',
  description: 'List all draft document versions awaiting attorney review.',
  mode: 'read',
  handler: async (ctx: ActionContext) => {
    const drafts = await listPendingDraftVersions(ctx)
    return { drafts }
  },
}

registerTool(tool)
