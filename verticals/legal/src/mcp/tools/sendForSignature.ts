import { registerTool, type Tool } from '@exsto/mcp-tools'
import { sendForSignature, type SendForSignatureResult } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// The "Send for signature" action — sits beside legal.email.send_draft_link.
// Creates a signature envelope linked to the document/matter through the
// operation core and, by default, emails each signer a secure native signing
// link (substrate sign-by-link — no external host). An external provider can be
// selected via `provider`, behind the connection gate.
interface Input {
  documentVersionId: string
  /** Document with field tags inserted by the prepare UI (a new version is saved). */
  preparedMarkdown?: string
  signers?: Array<{ email: string; name?: string; title?: string; order?: number; key?: string }>
  subject?: string
  provider?: string
}

const tool: Tool<Input, SendForSignatureResult> = {
  name: 'legal.esign.send_for_signature',
  description:
    'Send an approved document for e-signature. Creates a signature envelope (one request per signer) ' +
    'linked to the document and matter, and emails each signer a secure native signing link by default ' +
    "(no external provider/host needed). Defaults the signer to the matter's client contact.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => sendForSignature(ctx, input),
}

registerTool(tool)
