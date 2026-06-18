// Contract J action — "Send via email". Emails the client a link to this
// document's client-facing view, through the attorney's Gmail. Routes via
// legal.email.send_draft_link, which records a mail.send action (provenance
// integration:gmail) so the send lands in the matter's communication history.
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { registerDocumentAction } from '@/lib/documentActions/registry'

registerDocumentAction({
  id: 'send-via-email',
  label: 'Send via email',
  order: 10,
  confirm: () => 'Email a link to this document to the client on file?',
  run: async (ctx) => {
    const result = await callAttorneyMcp<{ messageId: string; from: string; to: string }>({
      toolName: 'legal.email.send_draft_link',
      input: {
        matterEntityId: ctx.matterEntityId,
        documentVersionId: ctx.documentVersionId,
        shareUrl: ctx.shareUrl,
      },
    })
    return { ok: true, message: `Sent to ${result.to}` }
  },
})
