// esign-executed-copy-complete — the pure attach-vs-fallback decision for the
// envelope-completion email (sendEnvelopeCompletionCopies, api/esign.ts). No
// DB, no Storage, no network: given the resolved candidate attachments (bytes
// already in memory — either the app-layer's stamped PDF bytes, Item 1, or a
// server-rendered draft PDF), decide whether to attach them or fall back to
// the existing view-link-only email. Pure module, same discipline as
// routing.ts/fields.ts/placements.ts — unit-testable without a live DB.
//
// Kept separate from routing.ts: this is a mail/attachment concern, not a
// signer-routing one.

export interface CompletionAttachmentCandidate {
  filename: string
  contentType: string
  bytes: Buffer
}

export interface CompletionEmailAttachment {
  filename: string
  contentType: string
  contentBase64: string
}

export interface CompletionAttachmentDecision {
  /** True when every candidate should ride the email as a real attachment.
   *  False ⇒ the caller sends the existing link-only email instead (no
   *  attachment resolved, or the total is over budget). Always all-or-nothing
   *  — a partial attachment set (e.g. one of three documents) would be a
   *  confusing "some documents missing" experience, so a caller must never
   *  see SOME of an envelope's documents attached and others silently
   *  dropped without saying so in the email body. */
  attach: boolean
  attachments: CompletionEmailAttachment[]
}

/** Gmail's hard cap is ~25 MB raw; the adapter's own send-time guard caps the
 *  whole MIME message around 18 MB. This decision is made BEFORE any Gmail
 *  call, so it stays comfortably under both — 15 MB total raw bytes across
 *  every document in the envelope. */
export const MAX_COMPLETION_ATTACHMENT_BYTES = 15 * 1024 * 1024

export function decideCompletionAttachment(
  candidates: CompletionAttachmentCandidate[],
  maxTotalBytes: number = MAX_COMPLETION_ATTACHMENT_BYTES,
): CompletionAttachmentDecision {
  if (candidates.length === 0) return { attach: false, attachments: [] }
  const total = candidates.reduce((n, c) => n + c.bytes.length, 0)
  if (total > maxTotalBytes) return { attach: false, attachments: [] }
  return {
    attach: true,
    attachments: candidates.map((c) => ({
      filename: c.filename,
      contentType: c.contentType,
      contentBase64: c.bytes.toString('base64'),
    })),
  }
}
