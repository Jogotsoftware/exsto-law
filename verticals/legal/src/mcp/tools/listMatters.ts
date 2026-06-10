import { registerTool, type Tool } from '@exsto/mcp-tools'
import { listMatters, type MatterSummary } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

const tool: Tool<Record<string, never>, { matters: MatterSummary[] }> = {
  name: 'legal.matter.list',
  description: 'List all matters for the current tenant.',
  mode: 'read',
  handler: async (ctx: ActionContext) => {
    const matters = await listMatters(ctx)
    return { matters }
  },
}

registerTool(tool)
