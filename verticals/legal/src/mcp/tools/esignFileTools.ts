import { registerTool, type Tool } from '@exsto/mcp-tools'
import { sendFileForSignature, type SendFileForSignatureResult } from '../../index.js'
import type { FieldPlacement } from '../../esign/placements.js'
import type { RecipientRole } from '../../api/esignSend.js'
import type { ActionContext } from '@exsto/substrate'

// 0170 — send an UPLOADED PDF for e-signature (the "e-sign any document" path).
// The document was recorded by the /api/attorney/esign/upload route (standalone,
// or attached to a matter / contact); this creates the envelope, emails every
// signer a secure signing link, and saves any new recipient as a contact.
//
// ESIGN-UNIFY-1 (ES-1, §5.5): the payload gains per-recipient `role`,
// `placements` (the composer's coordinate plan — all source:'placed' for a
// file), and `message`. All optional — pre-ES-1 callers are unchanged.
interface Input {
  documentVersionId: string
  signers: Array<{
    email: string
    name?: string
    title?: string
    order?: number
    /** ES-2: the signer key the envelope's placements reference. */
    key?: string
    role?: RecipientRole
  }>
  subject?: string
  placements?: FieldPlacement[]
  message?: string
}

const sendFileTool: Tool<Input, SendFileForSignatureResult> = {
  name: 'legal.esign.send_file',
  description:
    'Send an uploaded PDF document for e-signature (visual field placements when provided, else ' +
    'whole-document sign + signature certificate). Works standalone or attached to a matter/contact. Every signer gets a ' +
    'secure email signing link; recipients not already in contacts are saved as new contacts. ' +
    'Each recipient may carry a role: needs_to_sign (default), needs_to_view (read-only link), or ' +
    'receives_copy (executed copy on completion). Optional `placements` stores the field-placement ' +
    "plan; optional `message` is the sender's personal note for the signing email.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => sendFileForSignature(ctx, input),
}

registerTool(sendFileTool)
