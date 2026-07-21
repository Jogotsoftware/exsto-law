import { registerTool, type Tool } from '@exsto/mcp-tools'
import { sendForSignature, type SendForSignatureResult } from '../../index.js'
import type { FieldPlacement } from '../../esign/placements.js'
import type { RecipientRole } from '../../api/esignSend.js'
import type { ActionContext } from '@exsto/substrate'

// The "eSign" send action for drafts — sits beside legal.email.send_draft_link.
// Creates a signature envelope linked to the document/matter through the
// operation core and, by default, emails each signer a secure native signing
// link (substrate sign-by-link — no external host). An external provider can be
// selected via `provider`, behind the connection gate.
//
// ESIGN-UNIFY-1 (ES-1, §5.5): the payload gains per-recipient `role`
// (needs_to_sign | needs_to_view | receives_copy), `placements` (the composer's
// resolved coordinate plan), and `message` (the sender's personal note for the
// branded signing email). All optional — pre-ES-1 callers are unchanged.
interface Input {
  documentVersionId: string
  /** Document with field tags inserted by the prepare UI (a new version is saved). */
  preparedMarkdown?: string
  signers?: Array<{
    email: string
    name?: string
    title?: string
    order?: number
    key?: string
    role?: RecipientRole
  }>
  subject?: string
  provider?: string
  placements?: FieldPlacement[]
  message?: string
}

const tool: Tool<Input, SendForSignatureResult> = {
  name: 'legal.esign.send_for_signature',
  description:
    'Send an approved document for e-signature. Creates a signature envelope (one request per signer) ' +
    'linked to the document and matter, and emails each signer a secure native signing link by default ' +
    "(no external provider/host needed). Defaults the signer to the matter's client contact. " +
    'Each recipient may carry a role: needs_to_sign (default), needs_to_view (gets a read-only link ' +
    'with the first signing group), or receives_copy (gets the executed copy on completion). ' +
    'Optional `placements` stores the resolved field-placement plan; optional `message` is the ' +
    "sender's personal note included in the signing email.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => sendForSignature(ctx, input),
}

registerTool(tool)
