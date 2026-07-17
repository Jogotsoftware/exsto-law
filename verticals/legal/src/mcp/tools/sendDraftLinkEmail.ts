import { registerTool, type Tool } from '@exsto/mcp-tools'
import { sendDraftLinkEmail, type SendDraftLinkResult } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

interface Input {
  matterEntityId: string
  documentVersionId: string
  shareUrl: string
  to?: string
  // Comma-separated Cc — FIRM STAFF ONLY (co-counsel or paralegal); validated
  // against the tenant's active human actors, refused otherwise.
  cc?: string
  // Attorney-composed subject/message (Send-to-client modal). Used verbatim; the
  // secure tokenized link block is always appended to the message body. Omit both
  // for the default composition.
  subject?: string
  message?: string
  // Which export the emailed link leads with ('pdf' default; 'word' appends
  // &fmt=word to the share URL).
  format?: 'pdf' | 'word'
}

const tool: Tool<Input, SendDraftLinkResult> = {
  name: 'legal.email.send_draft_link',
  description:
    "Send the client a Pacheco Law email containing a secure link to the document view. Uses the matter's linked contact email unless overridden. Optional cc (firm staff only), subject, message (used verbatim, secure link appended), and format ('pdf' | 'word'). Requires gmail.send scope on the attorney's Google OAuth.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => sendDraftLinkEmail(ctx, input),
}

registerTool(tool)
