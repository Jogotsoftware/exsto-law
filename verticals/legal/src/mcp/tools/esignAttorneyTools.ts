import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getEnvelopeStatus,
  listEnvelopes,
  resendEnvelope,
  voidEnvelope,
  type EnvelopeStatus,
  type EnvelopeListItem,
  type ResendResult,
  type VoidResult,
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

registerTool(statusTool)
registerTool(listTool)
registerTool(resendTool)
registerTool(voidTool)
