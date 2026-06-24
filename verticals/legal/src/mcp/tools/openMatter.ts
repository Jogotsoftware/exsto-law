import { registerTool, type Tool } from '@exsto/mcp-tools'
import { openMatter, type OpenMatterInput } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Manual matter creation (the Matters page "New matter" button). Opens a matter
// for an offered service without a booked consultation — intake.submit +
// matter.open under the hood (the dead legal.matter.create path is unregistered).
const tool: Tool<OpenMatterInput, { matterEntityId: string; matterNumber: string }> = {
  name: 'legal.matter.open',
  description:
    'Open a matter manually (attorney-initiated, no booked consultation): creates the client_contact and the matter for the given serviceKey. Input: { clientFullName, clientEmail, clientCompanyName?, serviceKey }. Returns the new matter id + number.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => openMatter(ctx, input),
}

registerTool(tool)
