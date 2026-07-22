// esign-executed-copy-complete — the pure attach-vs-fallback decision for the
// envelope-completion email (verticals/legal/src/esign/completionAttachment.ts).
// No DB, no Storage, no network: exercises the size-cap and empty-candidate
// rules that decide whether sendEnvelopeCompletionCopies (api/esign.ts)
// attaches the executed PDF(s) or falls back to the existing link-only email.
import { describe, expect, it } from 'vitest'
import {
  decideCompletionAttachment,
  MAX_COMPLETION_ATTACHMENT_BYTES,
  type CompletionAttachmentCandidate,
} from '../../verticals/legal/src/esign/completionAttachment.js'

function candidate(filename: string, sizeBytes: number): CompletionAttachmentCandidate {
  return { filename, contentType: 'application/pdf', bytes: Buffer.alloc(sizeBytes, 1) }
}

describe('decideCompletionAttachment', () => {
  it('does not attach when there are no candidates (falls back to the link-only email)', () => {
    const decision = decideCompletionAttachment([])
    expect(decision.attach).toBe(false)
    expect(decision.attachments).toEqual([])
  })

  it('attaches a single small candidate, base64-encoded', () => {
    const decision = decideCompletionAttachment([candidate('agreement.pdf', 1024)])
    expect(decision.attach).toBe(true)
    expect(decision.attachments).toHaveLength(1)
    expect(decision.attachments[0]!.filename).toBe('agreement.pdf')
    expect(decision.attachments[0]!.contentType).toBe('application/pdf')
    // base64 round-trips back to the original byte count.
    expect(Buffer.from(decision.attachments[0]!.contentBase64, 'base64').length).toBe(1024)
  })

  it('sums multiple candidates (ES-MULTIDOC-1) toward the cap', () => {
    const decision = decideCompletionAttachment([
      candidate('a.pdf', 1000),
      candidate('b.pdf', 2000),
    ])
    expect(decision.attach).toBe(true)
    expect(decision.attachments).toHaveLength(2)
  })

  it('falls back (all-or-nothing) when the total exceeds the cap', () => {
    const decision = decideCompletionAttachment([
      candidate('big.pdf', MAX_COMPLETION_ATTACHMENT_BYTES + 1),
    ])
    expect(decision.attach).toBe(false)
    expect(decision.attachments).toEqual([])
  })

  it('attaches exactly at the cap boundary', () => {
    const decision = decideCompletionAttachment([
      candidate('exact.pdf', MAX_COMPLETION_ATTACHMENT_BYTES),
    ])
    expect(decision.attach).toBe(true)
  })

  it('never attaches a partial set — one oversized document drops ALL attachments', () => {
    const decision = decideCompletionAttachment([
      candidate('small.pdf', 100),
      candidate('huge.pdf', MAX_COMPLETION_ATTACHMENT_BYTES),
    ])
    expect(decision.attach).toBe(false)
    expect(decision.attachments).toEqual([])
  })

  it('honors a caller-supplied cap override', () => {
    expect(decideCompletionAttachment([candidate('a.pdf', 500)], 400).attach).toBe(false)
    expect(decideCompletionAttachment([candidate('a.pdf', 500)], 500).attach).toBe(true)
  })
})
