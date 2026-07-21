// ESIGN-UNIFY-1 ES-2 (§5.4) — stamp the EXECUTED copy of an uploaded-PDF
// envelope. Given the original PDF bytes and the resolved placement values, draw
// each field into its rect (typed signature / signature PNG / dates / data
// fields / checkboxes), then append the signature certificate as a final page
// (fileCertificate.ts is the one source of the certificate text). Produces a new
// PDF the completion path records as an immutable executed document_version —
// the same doctrine as the markdown path's resolveExecutedMarkdown.
//
// pdf-lib runs server-side (the vertical). It's NOT wired to Storage here (CI
// vertical-storage-guard): a byte-having caller (a Next route or worker) reads
// the original bytes, calls stampExecutedPdf, and writes the result back — this
// module is pure over bytes-in → bytes-out so it unit-tests against a golden.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { FieldPlacement, PlacementFieldType, PlacementRect } from './placements.js'
import { isSignatureImageDataUrl } from './fields.js'
import { buildCertificateTextLines, type FileCertInput } from './fileCertificate.js'

/** One field to stamp: its placement plus the resolved value / signature. */
export interface StampField {
  type: PlacementFieldType
  rect: PlacementRect
  /** Resolved text (name/date/email/company/phone/title/text). */
  value?: string | null
  /** A PNG/JPEG data-URL signature (sign/initial), when the signer drew/typed one. */
  signatureDataUrl?: string | null
  /** For `check` fields. */
  checked?: boolean
}

export interface StampInput {
  pdfBytes: Uint8Array | ArrayBuffer
  fields: StampField[]
  /** Appended as a final certificate page; omit to skip. */
  certificate?: FileCertInput | null
}

const TEXT_COLOR = rgb(0.106, 0.165, 0.29) // LI navy #1b2a4a
const RULE_COLOR = rgb(0.7, 0.7, 0.7)

// data:[mime];base64,<payload> → Uint8Array (browser-free; the vertical has no atob).
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!m) return null
  return { bytes: new Uint8Array(Buffer.from(m[2]!, 'base64')), mime: m[1]! }
}

/** Normalized top-left rect → pdf-lib bottom-left box in page points. */
function rectToBox(
  rect: PlacementRect,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; w: number; h: number } {
  const w = rect.w * pageWidth
  const h = rect.h * pageHeight
  const x = rect.x * pageWidth
  const yTop = rect.y * pageHeight
  return { x, y: pageHeight - yTop - h, w, h }
}

// Fit a font size so `text` fits `maxWidth` at up to `maxSize`, floor 6pt.
function fitFontSize(font: PDFFont, text: string, maxWidth: number, maxSize: number): number {
  let size = maxSize
  while (size > 6 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5
  return size
}

async function stampOne(
  pdf: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  sigFont: PDFFont,
  field: StampField,
): Promise<void> {
  const { width, height } = page.getSize()
  const box = rectToBox(field.rect, width, height)

  if (field.type === 'check') {
    if (field.checked) {
      const s = Math.min(box.w, box.h)
      page.drawText('X', {
        x: box.x + s * 0.2,
        y: box.y + s * 0.15,
        size: s * 0.8,
        font,
        color: TEXT_COLOR,
      })
    }
    return
  }

  const sig = field.signatureDataUrl
  if ((field.type === 'sign' || field.type === 'initial') && sig && isSignatureImageDataUrl(sig)) {
    const decoded = dataUrlToBytes(sig)
    if (decoded) {
      const img =
        decoded.mime === 'image/png'
          ? await pdf.embedPng(decoded.bytes)
          : await pdf.embedJpg(decoded.bytes)
      const scale = Math.min(box.w / img.width, box.h / img.height)
      const w = img.width * scale
      const h = img.height * scale
      page.drawImage(img, { x: box.x, y: box.y + (box.h - h) / 2, width: w, height: h })
      return
    }
  }

  // Text-bearing field (typed signature, name, date, data field). A ruled
  // baseline under signatures reads as a signature line, not a plain string.
  const text = (field.value ?? '').trim()
  if (!text) return
  const isSig = field.type === 'sign' || field.type === 'initial'
  const usedFont = isSig ? sigFont : font
  const size = fitFontSize(usedFont, text, box.w - 4, isSig ? 20 : 11)
  page.drawText(text, {
    x: box.x + 2,
    y: box.y + Math.max(3, (box.h - size) / 2),
    size,
    font: usedFont,
    color: TEXT_COLOR,
  })
  if (isSig) {
    page.drawLine({
      start: { x: box.x, y: box.y },
      end: { x: box.x + box.w, y: box.y },
      thickness: 0.75,
      color: RULE_COLOR,
    })
  }
}

// Append a plain-text certificate page (LETTER). fileCertificate.ts owns the
// text; here we just flow the lines with simple wrapping.
function appendCertificatePage(
  pdf: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  cert: FileCertInput,
) {
  const page = pdf.addPage([612, 792])
  const margin = 56
  const maxWidth = 612 - margin * 2
  let y = 792 - margin
  const heading = 'Signature Certificate'
  page.drawText(heading, { x: margin, y, size: 16, font: bold, color: TEXT_COLOR })
  y -= 26
  for (const line of buildCertificateTextLines(cert)) {
    for (const wrapped of wrapLine(line, font, 10, maxWidth)) {
      if (y < margin) {
        y = 792 - margin
        pdf.addPage([612, 792])
      }
      page.drawText(wrapped, { x: margin, y, size: 10, font, color: TEXT_COLOR })
      y -= 15
    }
  }
}

function wrapLine(line: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!line) return ['']
  const words = line.split(/\s+/)
  const out: string[] = []
  let cur = ''
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
      out.push(cur)
      cur = word
    } else {
      cur = next
    }
  }
  if (cur) out.push(cur)
  return out
}

/**
 * Stamp resolved field values onto a copy of the original PDF and append the
 * certificate page. Returns the new PDF bytes. Deterministic given its inputs
 * except for pdf-lib's own document metadata timestamps.
 */
export async function stampExecutedPdf(input: StampInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.pdfBytes)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const sigFont = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const pages = pdf.getPages()

  for (const field of input.fields) {
    const page = pages[field.rect.page]
    if (!page) continue // a placement on a page the PDF doesn't have — skip, never throw
    await stampOne(pdf, page, font, sigFont, field)
  }

  if (input.certificate) appendCertificatePage(pdf, font, bold, input.certificate)
  return pdf.save()
}

/** Adapt an envelope's placements + resolved values into StampFields — the
 *  shape the completion path passes. `values` keyed by placement id, signatures
 *  keyed by placement id (sign/initial). */
export function placementsToStampFields(
  placements: FieldPlacement[],
  values: Record<string, string | null | undefined>,
  signatures: Record<string, string | null | undefined>,
): StampField[] {
  return placements.map((p) => ({
    type: p.type,
    rect: p.rect,
    value: values[p.id] ?? null,
    signatureDataUrl: signatures[p.id] ?? null,
    checked: (values[p.id] ?? '').toLowerCase() === 'true',
  }))
}
