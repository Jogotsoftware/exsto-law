// AUTH MICRO-STAMP — a signature/initials field carries a tiny "name · date"
// caption on the face of the executed PDF, drawn strictly inside the field's
// box. It must appear on a normal-size signature box and be skipped on a box
// too short to fit both the signature and the caption. Using an IMAGE
// signature (not a typed name) isolates the caption: the signer's NAME text can
// only reach the page through the caption, never through the signature glyphs.
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { stampExecutedPdf, type StampField } from '../../verticals/legal/src/esign/stampPdf.js'
import { extractPdfText } from '../../verticals/legal/src/api/pdfText.js'

// 1x1 transparent PNG — a real embeddable image so the sign branch draws the
// picture (and only the caption carries text).
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const SIGNER = 'Jordan Signer'

async function letterBytes(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([612, 792])
  return pdf.save()
}

async function stampedText(rectH: number): Promise<string> {
  const field: StampField = {
    type: 'sign',
    rect: { page: 0, x: 0.2, y: 0.5, w: 0.25, h: rectH },
    signatureDataUrl: PNG_1PX,
    signerName: SIGNER,
    signedAt: '2026-07-21T14:00:00Z',
  }
  const out = await stampExecutedPdf({
    pdfBytes: await letterBytes(),
    fields: [field],
    certificate: null, // no cert page → the caption is the ONLY place the name appears
  })
  const { text } = await extractPdfText(Buffer.from(out))
  return text
}

describe('auth micro-stamp caption (stampPdf)', () => {
  it('draws the signer-name caption on a normal-size signature box', async () => {
    // h=0.05 → ~39.6pt tall, well above the 16pt band threshold.
    const text = await stampedText(0.05)
    expect(text).toContain(SIGNER)
    expect(text).toContain('2026-07-21')
  })

  it('skips the caption on a box too short to fit signature + caption', async () => {
    // h=0.015 → ~11.9pt tall, below the 16pt threshold → no caption.
    const text = await stampedText(0.015)
    expect(text).not.toContain(SIGNER)
  })
})
