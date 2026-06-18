import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import {
  declineForClient,
  listClientSignatures,
  loadClientContactEmail,
  loadSignableForClient,
  recordSignatureForClient,
  resolveClientMatterIds,
  type ClientPrincipal,
  type PendingSignature,
  type RecordSignatureResult,
  type SignableDocument,
} from '../../index.js'

// Authed client-portal e-sign tools. The authed portal route (/api/client/portal/
// mcp) verifies the session cookie and STAMPS clientContactId into the input; we
// derive the rest of the signing principal (email + the client's matter ids) from
// it server-side, then the API authorizes that the client owns the request.
async function principal(ctx: ActionContext, clientContactId: string): Promise<ClientPrincipal> {
  const [matterIds, email] = await Promise.all([
    resolveClientMatterIds(ctx.tenantId, clientContactId),
    loadClientContactEmail(ctx.tenantId, clientContactId),
  ])
  if (!email) throw new Error('Could not resolve your account.')
  return { tenantId: ctx.tenantId, clientContactId, email, matterIds }
}

interface WithClient {
  clientContactId: string
}

const listTool: Tool<WithClient, { signatures: PendingSignature[] }> = {
  name: 'legal.esign.portal.list',
  description: 'List the signed-in client’s documents awaiting their signature.',
  mode: 'read',
  handler: async (ctx, input) => ({
    signatures: await listClientSignatures(await principal(ctx, input.clientContactId)),
  }),
}

const loadTool: Tool<WithClient & { requestId: string }, { document: SignableDocument }> = {
  name: 'legal.esign.portal.load',
  description:
    'Load a document the signed-in client must sign (records that they opened it) plus their fields.',
  mode: 'write',
  handler: async (ctx, input) => ({
    document: await loadSignableForClient(
      await principal(ctx, input.clientContactId),
      input.requestId,
    ),
  }),
}

interface SignInput extends WithClient {
  requestId: string
  signatureName: string
  signatureData?: string | null
  consent: string
  fieldValues?: Record<string, string>
}
const signTool: Tool<SignInput, RecordSignatureResult> = {
  name: 'legal.esign.portal.sign',
  description: 'Record the signed-in client’s signature on one of their documents.',
  mode: 'write',
  handler: async (ctx, input) =>
    recordSignatureForClient(await principal(ctx, input.clientContactId), {
      requestId: input.requestId,
      signatureName: input.signatureName,
      signatureData: input.signatureData ?? null,
      consent: input.consent,
      fieldValues: input.fieldValues,
    }),
}

const declineTool: Tool<
  WithClient & { requestId: string; reason?: string },
  { ok: boolean; envelopeId: string }
> = {
  name: 'legal.esign.portal.decline',
  description: 'Record that the signed-in client declined to sign one of their documents.',
  mode: 'write',
  handler: async (ctx, input) =>
    declineForClient(await principal(ctx, input.clientContactId), {
      requestId: input.requestId,
      reason: input.reason,
    }),
}

registerTool(listTool)
registerTool(loadTool)
registerTool(signTool)
registerTool(declineTool)
