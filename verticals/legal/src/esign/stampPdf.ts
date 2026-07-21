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

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
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

// ─────────────────────────────────────────────────────────────────────────
// ESIGN-ROTATE-FIX — honor each page's /Rotate when stamping (design §5.4).
//
// THE STORAGE-SPACE DECISION (shared with placements.ts): a placement rect is
// stored normalized in the ROTATED, VISUAL page space — exactly what the human
// saw and dropped the box onto in the placement canvas. pdfjs's default
// `getViewport` already bakes in /Rotate (90/270 swap width & height), so the
// canvas, the signer overlay and the stored rect all live in that one visual
// space. This keeps zero-rotation envelopes byte-compatible (visual == MediaBox
// when /Rotate is 0) and needs NO migration — legacy rects are already valid.
//
// pdf-lib, by contrast, draws in UNROTATED MediaBox coordinates (bottom-left
// origin, y up) and its `page.getSize()` reports the MediaBox, NOT the visual
// box. So the executed-copy stamper must convert the visual rect back to
// MediaBox points AND pre-rotate the drawn content so it reads upright once the
// viewer applies /Rotate. Without this, on a rotated page every signature/date
// landed in the diagonally-opposite corner, un-rotated — a wrong-corner
// signature on a legal document. The two conversions below are the exact
// inverse of pdfjs's viewport transform for each rotation (verified: /Rotate
// 180 → transform [-1,0,0,1,W,0]; 90/270 → axes swapped), so a box stamps at
// the identical spot the attorney placed it.
//
// CROPBOX-FIX (defensive hardening, not the ESIGN-ROTATE-FIX bug above): the
// "visual box" pdfjs lays out is actually the page's CropBox (getViewport's
// dims come from it), which is not always the MediaBox — a PDF can crop
// smaller than its media, and a MediaBox's lower-left corner need not be
// (0,0). page.getSize()/getMediaBox() ignore that: they're right on SCALE
// (same width/height as the CropBox for the common no-crop case) but wrong on
// ORIGIN whenever CropBox ≠ MediaBox. Reading page.getCropBox() and adding its
// (x, y) back onto the rotation-mapped point keeps capture (pdfjs) and stamp
// (pdf-lib) in agreement in both cases. getCropBox() falls back to the
// MediaBox at the MediaBox's own origin when no CropBox is set, so an
// origin-0, CropBox-equals-MediaBox page — every envelope stamped before this
// fix — computes byte-identically to the old getSize()-keyed math.
// ─────────────────────────────────────────────────────────────────────────

export type PageRotation = 0 | 90 | 180 | 270

/** Normalize any pdf-lib rotation angle (any multiple of 90, possibly negative)
 *  to one of 0/90/180/270. */
export function normalizePageRotation(angle: number): PageRotation {
  const a = (((Math.round(angle / 90) * 90) % 360) + 360) % 360
  return a as PageRotation
}

/** The VISUAL (on-screen, rotation-honored) page size given the UNROTATED
 *  MediaBox size. 90/270 swap width and height — the canvas lays the page out
 *  this way and placement rects are normalized against THIS size. */
export function visualPageSize(
  mediaW: number,
  mediaH: number,
  rot: PageRotation,
): { w: number; h: number } {
  return rot === 90 || rot === 270 ? { w: mediaH, h: mediaW } : { w: mediaW, h: mediaH }
}

/** Map a point in VISUAL space (origin top-left, y DOWN, in visual points) to a
 *  point in pdf-lib MediaBox space (origin bottom-left, y UP, unrotated). This
 *  is the exact inverse of pdfjs's default `getViewport` transform for each
 *  /Rotate value. */
export function visualToMediaPoint(
  px: number,
  py: number,
  mediaW: number,
  mediaH: number,
  rot: PageRotation,
): { x: number; y: number } {
  switch (rot) {
    case 90:
      return { x: py, y: px }
    case 180:
      return { x: mediaW - px, y: py }
    case 270:
      return { x: mediaW - py, y: mediaH - px }
    default:
      return { x: px, y: mediaH - py }
  }
}

/** A normalized (visual-space) placement rect → the axis-aligned pdf-lib
 *  MediaBox box (bottom-left origin, unrotated) plus the counter-clockwise
 *  degrees to rotate drawn content so it reads upright once /Rotate is applied.
 *  Pure — unit-tested for all four rotations. For /Rotate 0 this reduces exactly
 *  to the previous `rectToBox` (x = rect.x·W, y = H − rect.y·H − rect.h·H).
 *
 *  `boxW`/`boxH` must be the CROP box's width/height — what pdfjs actually
 *  rendered and what placement rects are normalized against (usePdfDocument.ts
 *  bakes `getViewport({scale:1})`'s dims, which come from the CropBox, not the
 *  MediaBox). `origin` is that CropBox's lower-left corner in the page's
 *  default user space — pd-lib draws in that absolute space, not relative to
 *  the crop box, so a page whose CropBox doesn't start at (0,0) needs the
 *  offset added back after the rotation math. Defaults to (0,0) so callers
 *  passing MediaBox-equals-CropBox, origin-0 dimensions (the regression bar)
 *  get byte-identical output to before this parameter existed (CROPBOX-FIX). */
export function placementRectToMediaBox(
  rect: PlacementRect,
  boxW: number,
  boxH: number,
  rot: PageRotation,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number; w: number; h: number; rotate: PageRotation } {
  const vis = visualPageSize(boxW, boxH, rot)
  const vx = rect.x * vis.w
  const vy = rect.y * vis.h
  const vw = rect.w * vis.w
  const vh = rect.h * vis.h
  const a = visualToMediaPoint(vx, vy, boxW, boxH, rot)
  const b = visualToMediaPoint(vx + vw, vy + vh, boxW, boxH, rot)
  return {
    x: Math.min(a.x, b.x) + origin.x,
    y: Math.min(a.y, b.y) + origin.y,
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
    rotate: rot,
  }
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
  // CROPBOX-FIX: pdfjs renders (and usePdfDocument.ts normalizes placement
  // rects against) the page's CropBox, not its MediaBox — page.getViewport()
  // bakes in the CropBox dims. page.getSize() reports the MediaBox instead, so
  // for an upload whose CropBox is smaller than its MediaBox, or whose
  // MediaBox doesn't start at (0,0), the old getSize()-keyed math agreed with
  // pdfjs on SCALE but not on ORIGIN — every field landed at a uniform offset
  // from where the attorney placed it. page.getCropBox() falls back to the
  // MediaBox (at the MediaBox's own origin) when no CropBox is set, so this is
  // byte-identical to the old page.getSize() path for that common case — the
  // regression bar.
  const cropBox = page.getCropBox()
  const { width, height } = cropBox
  const rot = normalizePageRotation(page.getRotation().angle)
  const vis = visualPageSize(width, height, rot)
  const vx = field.rect.x * vis.w
  const vy = field.rect.y * vis.h
  const vw = field.rect.w * vis.w
  const vh = field.rect.h * vis.h
  // Visual point (top-left origin, y down) → point relative to the CropBox's
  // own bottom-left corner (y up) → shifted by the CropBox's origin into the
  // page's absolute default user space, which is what pdf-lib's drawing calls
  // expect (NOT relative to the crop box).
  const toMedia = (px: number, py: number) => {
    const m = visualToMediaPoint(px, py, width, height, rot)
    return { x: m.x + cropBox.x, y: m.y + cropBox.y }
  }
  // Only carry a rotate option when the page is actually rotated, so unrotated
  // pages emit byte-identical draw calls.
  const rotateOpt = rot === 0 ? {} : { rotate: degrees(rot) }

  if (field.type === 'check') {
    if (field.checked) {
      const s = Math.min(vw, vh)
      const m = toMedia(vx + s * 0.2, vy + vh - s * 0.15)
      page.drawText('X', { x: m.x, y: m.y, size: s * 0.8, font, color: TEXT_COLOR, ...rotateOpt })
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
      const scale = Math.min(vw / img.width, vh / img.height)
      const w = img.width * scale
      const h = img.height * scale
      // Image anchor = its VISUAL bottom-left corner (left of box, vertically
      // centered); pdf-lib's drawImage origin + rotate then fills up-and-right
      // in the visual frame.
      const m = toMedia(vx, vy + (vh + h) / 2)
      page.drawImage(img, { x: m.x, y: m.y, width: w, height: h, ...rotateOpt })
      return
    }
  }

  // Text-bearing field (typed signature, name, date, data field). A ruled
  // baseline under signatures reads as a signature line, not a plain string.
  const text = (field.value ?? '').trim()
  if (!text) return
  const isSig = field.type === 'sign' || field.type === 'initial'
  const usedFont = isSig ? sigFont : font
  const size = fitFontSize(usedFont, text, vw - 4, isSig ? 20 : 11)
  const pad = Math.max(3, (vh - size) / 2)
  // Baseline-left anchor in the visual box (2pt in from the left, `pad` up from
  // the visual bottom edge), mapped to MediaBox with the content pre-rotated.
  const t = toMedia(vx + 2, vy + vh - pad)
  page.drawText(text, { x: t.x, y: t.y, size, font: usedFont, color: TEXT_COLOR, ...rotateOpt })
  if (isSig) {
    // The signature baseline rule runs along the visual box bottom edge — two
    // endpoints mapped to MediaBox (a line needs no per-glyph rotation).
    const start = toMedia(vx, vy + vh)
    const end = toMedia(vx + vw, vy + vh)
    page.drawLine({ start, end, thickness: 0.75, color: RULE_COLOR })
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
