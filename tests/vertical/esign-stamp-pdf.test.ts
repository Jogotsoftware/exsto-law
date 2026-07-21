// ESIGN-UNIFY-1 ES-2 — executed-copy stamping (§5.4) golden test: build a
// known one-page PDF, stamp a full placement plan (typed signature, image
// signature, auto-date, data fields, checkbox) plus the certificate page, and
// assert the OUTPUT's extracted text and structure. Also the legacy fallback:
// an empty field plan stamps nothing and preserves the page count.
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  placementsToStampFields,
  stampExecutedPdf,
} from '../../verticals/legal/src/esign/stampPdf.js'
import type { FieldPlacement } from '../../verticals/legal/src/esign/placements.js'
import { extractPdfText } from '../../verticals/legal/src/api/pdfText.js'

// A 1×1 transparent PNG (data URL) — the smallest valid image signature.
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

async function buildOriginalPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('CONSULTING AGREEMENT', { x: 72, y: 720, size: 16, font })
  page.drawText('The parties agree to the terms above.', { x: 72, y: 680, size: 11, font })
  return pdf.save()
}

const CERT = {
  envelopeId: 'env-123',
  filename: 'consulting.pdf',
  contentType: 'application/pdf',
  sizeBytes: 12345,
  sha256Hex: 'abc123def456',
  signers: [
    {
      name: 'Maria Alvarez',
      email: 'maria@client.test',
      title: 'Managing Member',
      signed_at: '2026-07-20T15:00:00Z',
      consent: 'I agree to sign electronically.',
    },
  ],
}

describe('stampExecutedPdf — golden (§5.4)', () => {
  it('stamps every field kind and appends the certificate page', async () => {
    const original = await buildOriginalPdf()
    const stamped = await stampExecutedPdf({
      pdfBytes: original,
      fields: [
        // typed signature → oblique text + baseline rule
        {
          type: 'sign',
          rect: { page: 0, x: 0.12, y: 0.75, w: 0.33, h: 0.06 },
          value: 'Maria Alvarez',
        },
        // image signature → embedded PNG (asserted structurally below)
        {
          type: 'sign',
          rect: { page: 0, x: 0.55, y: 0.75, w: 0.33, h: 0.06 },
          signatureDataUrl: PNG_1PX,
        },
        { type: 'date', rect: { page: 0, x: 0.12, y: 0.84, w: 0.2, h: 0.04 }, value: '2026-07-20' },
        {
          type: 'company',
          rect: { page: 0, x: 0.12, y: 0.9, w: 0.3, h: 0.035 },
          value: 'Alvarez Holdings LLC',
        },
        { type: 'check', rect: { page: 0, x: 0.8, y: 0.9, w: 0.03, h: 0.025 }, checked: true },
      ],
      certificate: CERT,
    })

    const out = await PDFDocument.load(stamped)
    expect(out.getPageCount()).toBe(2) // original + certificate page

    const { text, pageCount } = await extractPdfText(Buffer.from(stamped))
    expect(pageCount).toBe(2)
    // original content survives
    expect(text).toContain('CONSULTING AGREEMENT')
    // stamped values landed
    expect(text).toContain('Maria Alvarez')
    expect(text).toContain('2026-07-20')
    expect(text).toContain('Alvarez Holdings LLC')
    // certificate content (fileCertificate.ts text lines)
    expect(text).toContain('Signature Certificate')
    expect(text).toContain('abc123def456')
    expect(text).toContain('env-123')
    expect(text).toContain('Managing Member')
  })

  it('deterministic layout: identical inputs stamp identical text', async () => {
    const original = await buildOriginalPdf()
    const input = {
      fields: [
        {
          type: 'sign' as const,
          rect: { page: 0, x: 0.12, y: 0.75, w: 0.33, h: 0.06 },
          value: 'Maria Alvarez',
        },
      ],
      certificate: CERT,
    }
    const a = await stampExecutedPdf({ pdfBytes: original, ...input })
    const b = await stampExecutedPdf({ pdfBytes: original, ...input })
    const [ta, tb] = [await extractPdfText(Buffer.from(a)), await extractPdfText(Buffer.from(b))]
    expect(ta.text).toBe(tb.text)
  })

  it('legacy fallback: no fields + no certificate → page count preserved, nothing added', async () => {
    const original = await buildOriginalPdf()
    const stamped = await stampExecutedPdf({ pdfBytes: original, fields: [], certificate: null })
    const out = await PDFDocument.load(stamped)
    expect(out.getPageCount()).toBe(1)
    const { text } = await extractPdfText(Buffer.from(stamped))
    expect(text).toContain('CONSULTING AGREEMENT')
    expect(text).not.toContain('Signature Certificate')
  })

  it('a placement on a page the PDF does not have is skipped, never fatal', async () => {
    const original = await buildOriginalPdf()
    const stamped = await stampExecutedPdf({
      pdfBytes: original,
      fields: [
        { type: 'sign', rect: { page: 7, x: 0.1, y: 0.1, w: 0.3, h: 0.05 }, value: 'Ghost' },
      ],
      certificate: null,
    })
    const { text, pageCount } = await extractPdfText(Buffer.from(stamped))
    expect(pageCount).toBe(1)
    expect(text).not.toContain('Ghost')
  })
})

describe('placementsToStampFields — plan adapter', () => {
  it('maps values/signatures/checkbox state by placement id', () => {
    const placements: FieldPlacement[] = [
      {
        id: 'p0',
        type: 'sign',
        signerKey: 's1',
        required: true,
        source: 'placed',
        rect: { page: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.06 },
      },
      {
        id: 'p1',
        type: 'check',
        signerKey: 's1',
        required: false,
        source: 'placed',
        rect: { page: 0, x: 0.5, y: 0.1, w: 0.03, h: 0.03 },
      },
    ]
    const fields = placementsToStampFields(placements, { p0: 'Maria', p1: 'true' }, { p0: PNG_1PX })
    expect(fields[0]).toMatchObject({ type: 'sign', value: 'Maria', signatureDataUrl: PNG_1PX })
    expect(fields[1]).toMatchObject({ type: 'check', checked: true })
  })
})
