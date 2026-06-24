import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listPendingDraftVersions,
  listMatterDraftVersions,
  type PendingDraftSummary,
} from '../../index.js'
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

// One row per draft document of a matter (latest version each, any status) — the
// signature-task document picker offers these to attach for signing.
const forMatterTool: Tool<{ matterEntityId: string }, { drafts: PendingDraftSummary[] }> = {
  name: 'legal.draft.list_for_matter',
  description: "List a matter's draft documents (latest version of each) for attaching or signing.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    drafts: await listMatterDraftVersions(ctx, input.matterEntityId),
  }),
}

registerTool(tool)
registerTool(forMatterTool)
