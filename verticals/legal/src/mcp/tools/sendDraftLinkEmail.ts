import { registerTool, type Tool } from '@exsto/mcp-tools'
import { sendDraftLinkEmail, type SendDraftLinkResult } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

interface Input {
  matterEntityId: string
  documentVersionId: string
  shareUrl: string
  to?: string
}

const tool: Tool<Input, SendDraftLinkResult> = {
  name: 'legal.email.send_draft_link',
  description:
    "Send the client a Pacheco Law email containing a link to the public draft view. Uses the matter's linked contact email unless overridden. Requires gmail.send scope on the attorney's Google OAuth.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => sendDraftLinkEmail(ctx, input),
}

registerTool(tool)
