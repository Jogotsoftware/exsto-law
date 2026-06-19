import type { ActionContext } from '@exsto/substrate'
import { enqueueClientEmail } from './mailWorkspace.js'
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

  const subject = `Your draft ${docTitle} — ${matter.matterNumber}`
  const body = [
    greeting,
    '',
    `Your draft ${docTitle} is ready for review:`,
    '',
    input.shareUrl,
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
