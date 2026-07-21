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
  /** The uploaded PDF to send. Ignored when `documents` is provided (multi-doc);
   *  kept for single-document callers. */
  documentVersionId: string
  /** ES-MULTIDOC-1: the FULL ordered set of uploaded PDFs for a multi-document
   *  envelope — one envelope carrying many documents. Absent ⇒ the single
   *  `documentVersionId`. */
  documents?: Array<{ documentVersionId: string }>
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
    'Send one or more uploaded PDF documents as a single e-signature envelope (visual field ' +
    'placements when provided, else whole-document sign + signature certificate). Pass `documents` ' +
    '(ordered) for a multi-document envelope, or a single `documentVersionId`. Works standalone or ' +
    'attached to a matter/contact. Every signer gets a secure email signing link; recipients not ' +
    'already in contacts are saved as new contacts. Each recipient may carry a role: needs_to_sign ' +
    '(default), needs_to_view (read-only link), or receives_copy (executed copy on completion). ' +
    'Optional `placements` stores the field-placement plan across all documents (each placement’s ' +
    "docIndex binds it to a document); optional `message` is the sender's personal note.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => sendFileForSignature(ctx, input),
}

registerTool(sendFileTool)
