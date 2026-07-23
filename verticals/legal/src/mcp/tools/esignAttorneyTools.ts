import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  addNextSignerForAttorneyRequest,
  addSignerForAttorney,
  confirmNoMoreSignersForAttorneyRequest,
  finishSigningForAttorney,
  getEnvelopeStatus,
  listEnvelopes,
  resendEnvelope,
  voidEnvelope,
  listSignaturesAwaitingAttorney,
  loadSignableForAttorney,
  recordSignatureForAttorney,
  declineForAttorney,
  type AddSignerResult,
  type EnvelopeStatus,
  type EnvelopeListItem,
  type ResendResult,
  type VoidResult,
  type AwaitingAttorneySignature,
  type SignableDocument,
  type RecordSignatureResult,
} from '../../index.js'
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

// The whole eSign surface: every envelope in the tenant with its signers,
// document, matter, and derived bucket (action_needed / out / completed /
// declined / voided) — backs the stat cards, filter pills, and table (WP-N).
const listTool: Tool<Record<string, never>, { envelopes: EnvelopeListItem[] }> = {
  name: 'legal.esign.envelopes_list',
  description:
    'List every signature envelope in the firm (newest first) with its signers, document, matter, ' +
    'signed progress, and derived bucket: action_needed (out for signature, blocked on the FIRM), ' +
    'out (awaiting a client/external signer), completed, declined, or voided.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ envelopes: await listEnvelopes(ctx) }),
}

// Resend the current signing link to whoever is awaiting signature now.
const resendTool: Tool<{ envelopeId: string }, ResendResult> = {
  name: 'legal.esign.resend',
  description:
    'Re-send the secure signing link (or portal nudge) to the signer(s) whose turn is currently ' +
    'active on an out-for-signature envelope. Refused on completed / declined / voided envelopes.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => resendEnvelope(ctx, input.envelopeId),
}

// Firm-initiated void: close an active envelope so its links can no longer sign.
const voidTool: Tool<{ envelopeId: string; reason?: string }, VoidResult> = {
  name: 'legal.esign.void',
  description:
    'Void an active signature envelope (firm-initiated). Sets it to voided and closes every open ' +
    'signer request so its link can no longer be used. Refused once completed / declined / voided.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => voidEnvelope(ctx, input.envelopeId, input.reason),
}

// ESIGN-ATTORNEY-REVIEW-1 — the attorney's OWN signing surface: envelopes
// awaiting their countersignature (#476 lets an attorney add themselves as a
// signer), and the load/sign/decline actions to actually sign in-app. Mirrors
// the esignPortalTools.ts client tools, but authed as the attorney (no
// clientContactId stamping — the attorney route resolves ctx from the session).
const awaitingMeTool: Tool<Record<string, never>, { signatures: AwaitingAttorneySignature[] }> = {
  name: 'legal.esign.awaiting_me',
  description:
    'List envelopes where it is currently the signed-in attorney’s own turn to sign (they were ' +
    'added as a countersigner). Backs the Review Queue’s "Awaiting your signature" section.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({
    signatures: await listSignaturesAwaitingAttorney(ctx),
  }),
}

const signLoadTool: Tool<{ requestId: string; signerIp?: string | null }, SignableDocument> = {
  name: 'legal.esign.sign_load',
  description:
    'Load a document the signed-in attorney must sign (records that they opened it), plus their fields.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    loadSignableForAttorney(ctx, input.requestId, input.signerIp ?? null),
}

interface AttorneySignInput {
  requestId: string
  signatureName: string
  signatureData?: string | null
  consent: string
  fieldValues?: Record<string, string>
  signerIp?: string | null
}
const signSubmitTool: Tool<AttorneySignInput, RecordSignatureResult> = {
  name: 'legal.esign.sign_submit',
  description: 'Record the signed-in attorney’s signature on their own countersignature request.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    recordSignatureForAttorney(ctx, input.requestId, {
      signatureName: input.signatureName,
      signatureData: input.signatureData ?? null,
      consent: input.consent,
      fieldValues: input.fieldValues,
      signerIp: input.signerIp ?? null,
    }),
}

const signDeclineTool: Tool<
  { requestId: string; reason?: string; signerIp?: string | null },
  { ok: boolean; envelopeId: string }
> = {
  name: 'legal.esign.sign_decline',
  description:
    'Record that the signed-in attorney declined to sign their own countersignature request.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    declineForAttorney(ctx, {
      requestId: input.requestId,
      reason: input.reason,
      signerIp: input.signerIp ?? null,
    }),
}

// ADD-NEXT-SIGNER-1 — mirrors legal.esign.portal.add_signer/.finish, but for
// the attorney adding a signer after their OWN countersignature (the
// sign_load/sign_submit/sign_decline signing surface, not the envelope
// detail page's attorney-initiated add below).
interface AttorneySignAddSignerInput {
  requestId: string
  name: string
  email: string
  title?: string | null
}
const signAddSignerTool: Tool<AttorneySignAddSignerInput, AddSignerResult> = {
  name: 'legal.esign.sign_add_signer',
  description:
    'Insert the next signer after the signed-in attorney’s own countersignature, instead of finishing ' +
    'the envelope — offered when their signature would otherwise have completed it.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    addNextSignerForAttorneyRequest(ctx, {
      requestId: input.requestId,
      name: input.name,
      email: input.email,
      title: input.title,
    }),
}

const signFinishTool: Tool<{ requestId: string }, RecordSignatureResult> = {
  name: 'legal.esign.sign_finish',
  description:
    'The signed-in attorney confirms "no more signers" on their own countersignature — completes the ' +
    'envelope that held open awaiting their decision.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    confirmNoMoreSignersForAttorneyRequest(ctx, { requestId: input.requestId }),
}

// ADD-NEXT-SIGNER-1 — the attorney adds a signer to an in-flight envelope
// (no anchor request; the handler picks the current active group, or
// appends at the end if nothing is unresolved).
interface AttorneyAddSignerInput {
  envelopeId: string
  name: string
  email: string
  title?: string | null
}
const addSignerTool: Tool<AttorneyAddSignerInput, AddSignerResult> = {
  name: 'legal.esign.add_signer',
  description:
    'Add a signer to an in-flight envelope. Ordered right after whichever group is currently active ' +
    '(or appended at the end if nothing is unresolved) — refused once the envelope is completed / ' +
    'declined / voided.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    addSignerForAttorney(ctx, input.envelopeId, {
      name: input.name,
      email: input.email,
      title: input.title,
    }),
}

// ADD-NEXT-SIGNER-1 — fallback finish for an envelope stuck awaiting a
// signer's "add another / no more" decision (they never came back).
const finishTool: Tool<{ envelopeId: string }, RecordSignatureResult> = {
  name: 'legal.esign.finish',
  description:
    'Finish an envelope that is stuck awaiting a signer’s "add another signer / no more signers" ' +
    'decision. Refused unless the envelope is actually in that state.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => finishSigningForAttorney(ctx, input.envelopeId),
}

registerTool(statusTool)
registerTool(listTool)
registerTool(resendTool)
registerTool(voidTool)
registerTool(awaitingMeTool)
registerTool(signLoadTool)
registerTool(signSubmitTool)
registerTool(signDeclineTool)
registerTool(signAddSignerTool)
registerTool(signFinishTool)
registerTool(addSignerTool)
registerTool(finishTool)
