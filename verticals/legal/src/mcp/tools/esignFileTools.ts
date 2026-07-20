import { registerTool, type Tool } from '@exsto/mcp-tools'
import { sendFileForSignature, type SendFileForSignatureResult } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// 0170 — send an UPLOADED PDF for e-signature (the "e-sign any document" path).
// The document was recorded by the /api/attorney/esign/upload route (standalone,
// or attached to a matter / contact); this creates the envelope, emails every
// signer a secure signing link, and saves any new recipient as a contact.
interface Input {
  documentVersionId: string
  signers: Array<{ email: string; name?: string; title?: string; order?: number }>
  subject?: string
}

const sendFileTool: Tool<Input, SendFileForSignatureResult> = {
  name: 'legal.esign.send_file',
  description:
    'Send an uploaded PDF document for e-signature (whole-document sign + signature certificate; ' +
    'no inline field tags). Works standalone or attached to a matter/contact. Every signer gets a ' +
    'secure email signing link; recipients not already in contacts are saved as new contacts.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => sendFileForSignature(ctx, input),
}

registerTool(sendFileTool)
