import { registerTool, type Tool } from '@exsto/mcp-tools'
import { getMatter, type MatterDetail } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

interface Input {
  matterEntityId: string
}

const tool: Tool<Input, { matter: MatterDetail | null }> = {
  name: 'legal.matter.get',
  description: 'Fetch a matter with its attributes, questionnaire, transcript, and latest draft.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    const matter = await getMatter(ctx, input.matterEntityId)
    return { matter }
  },
}

registerTool(tool)
