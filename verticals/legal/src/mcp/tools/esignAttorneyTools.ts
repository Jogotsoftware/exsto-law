import { registerTool, type Tool } from '@exsto/mcp-tools'
import { getEnvelopeStatus, type EnvelopeStatus } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Attorney-facing envelope status: per-signer delivered/opened/signed with order.
const statusTool: Tool<{ envelopeId: string }, EnvelopeStatus> = {
  name: 'legal.esign.status',
  description:
    'Get the status of a signature envelope: overall state plus each signer (name, title, order, ' +
    'channel) and their state — pending / delivered / opened / signed / declined.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => getEnvelopeStatus(ctx, input.envelopeId),
}

registerTool(statusTool)
