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
  // Optional Cc, comma-separated. FIRM STAFF ONLY — Contract B validates every
  // address against the tenant's active human actors and refuses others.
  cc?: string
  // Optional attorney-composed subject/message (the Send-to-client modal). Used
  // verbatim when provided; the secure tokenized link block is ALWAYS appended
  // to the message body. When omitted, the default composition below is used
  // unchanged (back-compat).
  subject?: string
  message?: string
  // Which export the emailed link should lead with. 'word' appends &fmt=word to
  // the share URL so the client view can preselect the Word download.
  format?: 'pdf' | 'word'
}

export interface SendDraftLinkResult {
  messageId: string
  from: string
  to: string
}

// Pure composition seam (unit-tested): the subject + plaintext body of a
// draft-link email. Two modes:
//   default  — no subject/message supplied: the original composition, unchanged.
//   composed — the Send-to-client modal supplies subject/message verbatim; the
//              secure tokenized link block is ALWAYS appended to the body, so an
//              attorney can never accidentally strip the client's access link.
export interface DraftLinkEmailParts {
  subject: string
  body: string
}

export function composeDraftLinkEmail(args: {
  docTitle: string
  matterNumber: string
  clientName: string | null
  tokenizedUrl: string
  subject?: string
  message?: string
  format?: 'pdf' | 'word'
}): DraftLinkEmailParts {
  const defaultSubject = `Your draft ${args.docTitle} — ${args.matterNumber}`
  const subject = args.subject?.trim() ? args.subject : defaultSubject

  if (args.message?.trim()) {
    const formatLabel = args.format === 'word' ? 'Word' : 'PDF'
    const body = [
      args.message.replace(/\s+$/, ''),
      '',
      `Your ${args.docTitle} (${formatLabel}) is ready to view and download securely:`,
      '',
      args.tokenizedUrl,
    ].join('\r\n')
    return { subject, body }
  }

  const firstName = args.clientName?.split(' ')[0]?.trim() || ''
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,'
  const body = [
    greeting,
    '',
    `Your draft ${args.docTitle} is ready for review:`,
    '',
    args.tokenizedUrl,
    '',
    'You can view it in your browser and download a PDF or Word copy from the page.',
    '',
    'Take a look at your convenience and let me know if you have questions.',
  ].join('\r\n')
  return { subject, body }
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

  // PORTAL-1 (WP2): the emailed link carries a SHORT-LIVED signed token — the
  // bare /d/<versionId> capability URL is no longer publicly readable. Signed-in
  // clients reach the same document through their portal session instead.
  const token = signDraftLinkToken({
    documentVersionId: input.documentVersionId,
    tenantId: ctx.tenantId,
  })
  const sep = input.shareUrl.includes('?') ? '&' : '?'
  let tokenizedUrl = `${input.shareUrl}${sep}t=${encodeURIComponent(token)}`
  if (input.format === 'word') tokenizedUrl += '&fmt=word'

  const { subject, body } = composeDraftLinkEmail({
    docTitle,
    matterNumber: matter.matterNumber,
    clientName: matter.clientName ?? null,
    tokenizedUrl,
    subject: input.subject,
    message: input.message,
    format: input.format,
  })

  // Route through Contract B so the draft-link email is recorded as a mail.send
  // action and shows up in the matter's communication history (was previously a
  // raw send with no audit row). Cc (firm staff only) is validated there.
  const { messageId, from } = await enqueueClientEmail(ctx, {
    to,
    cc: input.cc,
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
