import type { ActionContext } from '@exsto/substrate'
import { enqueueClientEmail } from './mailWorkspace.js'
import { signDraftLinkToken } from './draftLinkToken.js'
import { getMatter } from '../queries/matters.js'
import { getDraftVersion } from '../queries/drafts.js'

export interface SendDraftLinkInput {
  matterEntityId: string
  documentVersionId: string
  shareUrl: string
  to?: string
}

export interface SendDraftLinkResult {
  messageId: string
  from: string
  to: string
}

// Send a Pacheco Law-branded email to the client with a link to the public
// draft view. Pulls the recipient from the matter's linked contact unless
// overridden. Pulls the document type from the draft for the subject line.
export async function sendDraftLinkEmail(
  ctx: ActionContext,
  input: SendDraftLinkInput,
): Promise<SendDraftLinkResult> {
  const matter = await getMatter(ctx, input.matterEntityId)
  if (!matter) throw new Error(`Matter not found: ${input.matterEntityId}`)

  const to = (input.to ?? matter.clientEmail ?? '').trim()
  if (!to) {
    throw new Error(
      'No client email on file for this matter. Add one to the contact, or pass `to` explicitly.',
    )
  }

  const draft = await getDraftVersion(ctx, input.documentVersionId)
  const docKind = draft?.documentKind ?? 'document'
  const docTitle = docKind.replace(/_/g, ' ')

  const firstName = matter.clientName?.split(' ')[0]?.trim() || ''
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,'

  // PORTAL-1 (WP2): the emailed link carries a SHORT-LIVED signed token — the
  // bare /d/<versionId> capability URL is no longer publicly readable. Signed-in
  // clients reach the same document through their portal session instead.
  const token = signDraftLinkToken({
    documentVersionId: input.documentVersionId,
    tenantId: ctx.tenantId,
  })
  const sep = input.shareUrl.includes('?') ? '&' : '?'
  const tokenizedUrl = `${input.shareUrl}${sep}t=${encodeURIComponent(token)}`

  const subject = `Your draft ${docTitle} — ${matter.matterNumber}`
  const body = [
    greeting,
    '',
    `Your draft ${docTitle} is ready for review:`,
    '',
    tokenizedUrl,
    '',
    'You can view it in your browser and download a PDF or Word copy from the page.',
    '',
    'Take a look at your convenience and let me know if you have questions.',
  ].join('\r\n')

  // Route through Contract B so the draft-link email is recorded as a mail.send
  // action and shows up in the matter's communication history (was previously a
  // raw send with no audit row).
  const { messageId, from } = await enqueueClientEmail(ctx, {
    to,
    subject,
    body,
    matterId: input.matterEntityId,
  })
  return { messageId, from, to }
}

// ───────────────────────────────────────────────────────────────────────────
// MACHINE-COMMS-1 (WP2) — send an APPROVED communication draft. Approve = send:
// api/reviewDraft.approveDraft calls this after draft.approve lands on a
// communication_draft. The attorney-approved BODY is the message (no /d link);
// delivery is Contract B (enqueueClientEmail) — the client-contact allow-list,
// send authz, firm signature, and the mail.send audit row all apply unchanged.
// ───────────────────────────────────────────────────────────────────────────

export interface SendCommunicationDraftResult {
  messageId: string
  from: string
  to: string
  subject: string
}

export async function sendCommunicationDraft(
  ctx: ActionContext,
  documentVersionId: string,
): Promise<SendCommunicationDraftResult> {
  const draft = await getDraftVersion(ctx, documentVersionId)
  if (!draft) throw new Error(`Draft version not found: ${documentVersionId}`)
  if (draft.channel !== 'communication') {
    throw new Error(`Version ${documentVersionId} is not a communication draft.`)
  }
  if (draft.status !== 'approved') {
    throw new Error('Only an APPROVED email draft can be sent — approve it in the review queue.')
  }
  if ((draft.emailToRole ?? 'client') !== 'client') {
    // Contract B is client-mail-only by discipline; a non-client recipient has no
    // authorized rail yet. Honest error, never a silent re-route.
    throw new Error(
      'This email draft is addressed to a non-client recipient — no authorized send rail exists for that yet. Copy the approved text and send it manually.',
    )
  }
  const matter = await getMatter(ctx, draft.matterEntityId)
  if (!matter) throw new Error(`Matter not found: ${draft.matterEntityId}`)
  const to = (matter.clientEmail ?? '').trim()
  if (!to) {
    throw new Error(
      'No client email on file for this matter — add one to the contact, then approve again to retry the send.',
    )
  }
  const subject = draft.emailSubject?.trim() || `Update on your matter ${matter.matterNumber}`
  const { messageId, from } = await enqueueClientEmail(ctx, {
    to,
    subject,
    body: draft.bodyMarkdown,
    matterId: draft.matterEntityId,
  })
  return { messageId, from, to, subject }
}
