// Contract J action — "Send for signature" (Session 5). Opens the prepare screen
// where the attorney adds signers (name/email/title/signing order) and places
// signature fields, then sends. Auto-discovered by the action bar registry; sits
// beside "Send via email".
import { registerDocumentAction } from '@/lib/documentActions/registry'

registerDocumentAction({
  id: 'send-for-signature',
  label: 'Send for signature',
  order: 20,
  run: async (ctx) => {
    // Navigate to the prepare flow (field placement + signers + order live there).
    if (typeof window !== 'undefined') {
      window.location.assign(`/attorney/sign/prepare/${ctx.documentVersionId}`)
    }
    return { ok: true, message: 'Opening signature preparation…' }
  },
})
