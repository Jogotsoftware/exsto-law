// Contract J action — "eSign" (Session 5, labeled "Send for signature" until
// WF-RUNNER-TOOLBAR-1 shortened it to match the review toolbar's other one-word
// labels — the flow itself is unchanged). Opens the prepare screen where the
// attorney adds signers (name/email/title/signing order) and places signature
// fields, then sends. Auto-discovered by the action bar registry; sits beside
// "Send via email".
import { registerDocumentAction } from '@/lib/documentActions/registry'

registerDocumentAction({
  id: 'send-for-signature',
  label: 'eSign',
  order: 20,
  run: async (ctx) => {
    // Navigate to the prepare flow (field placement + signers + order live there).
    if (typeof window !== 'undefined') {
      window.location.assign(`/attorney/sign/prepare/${ctx.documentVersionId}`)
    }
    return { ok: true, message: 'Opening signature preparation…' }
  },
})
