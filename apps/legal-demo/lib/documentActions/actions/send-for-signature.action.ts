// Contract J action — "eSign". ESIGN-UNIFY-1 (ES-5, design §8): the review
// reader's + runner review modal's toolbar action opens the ONE unified
// EsignComposer in document mode — the version is locked, the matter
// pre-attaches (pre-filling the client as recipient 1), and field placement
// happens on the real rendered PDF. Auto-discovered by the action bar registry.
import { registerDocumentAction } from '@/lib/documentActions/registry'

// "attorney_letter" → "Attorney Letter" — seeds the composer's subject.
function humanizeKind(kind: string): string {
  const s = kind.replace(/_/g, ' ').trim()
  return s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Document'
}

registerDocumentAction({
  id: 'send-for-signature',
  label: 'eSign',
  order: 20,
  run: async (ctx) => {
    // Navigate to the unified composer (recipients + roles + field placement
    // + review live there), document pre-attached, matter context carried.
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams({
        documentVersionId: ctx.documentVersionId,
        documentEntityId: ctx.documentEntityId,
        matterEntityId: ctx.matterEntityId,
        title: humanizeKind(ctx.documentKind),
      })
      window.location.assign(`/attorney/esign/compose?${params.toString()}`)
    }
    return { ok: true, message: 'Opening eSign…' }
  },
})
