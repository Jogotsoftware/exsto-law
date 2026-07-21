// CROPBOX-FIX — the executed-copy stamper must key off the page's CropBox
// (what pdfjs actually renders and what usePdfDocument.ts normalizes
// placement rects against), not its MediaBox, and must offset the result by
// the CropBox's own origin in the page's default user space. The existing
// stamp-rotation suite (esign-stamp-rotation.test.ts) only exercises
// synthetic origin-0 LETTER pages where CropBox == MediaBox == [0,0,612,792]
// — a shape where the bug is invisible — which is why it stayed green.
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  placementRectToMediaBox,
  stampExecutedPdf,
} from '../../verticals/legal/src/esign/stampPdf.js'
import type { PlacementRect } from '../../verticals/legal/src/esign/placements.js'
import { extractPdfText } from '../../verticals/legal/src/api/pdfText.js'

// A page whose MediaBox does NOT start at (0,0) (MediaBox: [50,30,750,930])
// and whose CropBox is a smaller, differently-offset rectangle inside it
// (CropBox: [100,80,700,860]) — the shape that exposed the bug. Before this
// fix, page.getSize() (== MediaBox width/height, 700×900) agreed with pdfjs
// on SCALE — MediaBox and CropBox both have the same aspect here — but
// ignored both origins entirely, so every stamped field landed at a uniform
// diagonal offset from where the attorney placed it in the preview.
const MEDIA = { x: 50, y: 30, width: 700, height: 900 }
const CROP = { x: 100, y: 80, width: 600, height: 780 }

async function fixturePage(): Promise<{ pdf: PDFDocument; bytes: Uint8Array }> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([MEDIA.width, MEDIA.height])
  page.setMediaBox(MEDIA.x, MEDIA.y, MEDIA.width, MEDIA.height)
  page.setCropBox(CROP.x, CROP.y, CROP.width, CROP.height)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  // Marker text placed inside the CropBox so extraction isn't a variable.
  page.drawText('CROPBOX FIXTURE', { x: CROP.x + 20, y: CROP.y + CROP.height - 40, size: 12, font })
  const bytes = await pdf.save()
  return { pdf, bytes }
}

describe('placementRectToMediaBox — CropBox origin offset (CROPBOX-FIX)', () => {
  const rect: PlacementRect = { page: 0, x: 0.25, y: 0.25, w: 0.1, h: 0.05 }

  it('scales against CropBox dims and offsets the result by the CropBox origin', () => {
    const box = placementRectToMediaBox(rect, CROP.width, CROP.height, 0, { x: CROP.x, y: CROP.y })
    // Hand-derived expected anchor: visual space = CropBox dims (rot 0, no
    // axis swap), then the rot-0 flip (y = boxH - vy - vh), then + CropBox origin.
    const vx = rect.x * CROP.width // 150
    const vy = rect.y * CROP.height // 195
    const vw = rect.w * CROP.width // 60
    const vh = rect.h * CROP.height // 39
    const expectedX = vx + CROP.x // 250
    const expectedY = CROP.height - vy - vh + CROP.y // 626
    expect(box.x).toBeCloseTo(expectedX, 6)
    expect(box.y).toBeCloseTo(expectedY, 6)
    expect(box.w).toBeCloseTo(vw, 6)
    expect(box.h).toBeCloseTo(vh, 6)
  })

  it('defaults origin to (0,0) — origin-0 CropBox==MediaBox pages compute byte-identically to pre-fix (regression bar)', () => {
    const W = 612
    const H = 792
    const withDefault = placementRectToMediaBox(rect, W, H, 0)
    const withExplicitZero = placementRectToMediaBox(rect, W, H, 0, { x: 0, y: 0 })
    expect(withDefault).toEqual(withExplicitZero)
  })

  it('agrees with a real pdf-lib page whose getCropBox() differs from getMediaBox()', async () => {
    const { pdf } = await fixturePage()
    const page = pdf.getPages()[0]!
    const cropBox = page.getCropBox()
    // Sanity: the fixture really has CropBox != MediaBox and a non-zero MediaBox origin.
    expect(cropBox).toEqual(CROP)
    expect(page.getMediaBox()).toEqual(MEDIA)
    const box = placementRectToMediaBox(rect, cropBox.width, cropBox.height, 0, {
      x: cropBox.x,
      y: cropBox.y,
    })
    // The placed box must land fully inside the CropBox the attorney saw —
    // not merely inside the (differently-offset) MediaBox.
    expect(box.x).toBeGreaterThanOrEqual(CROP.x - 0.001)
    expect(box.y).toBeGreaterThanOrEqual(CROP.y - 0.001)
    expect(box.x + box.w).toBeLessThanOrEqual(CROP.x + CROP.width + 0.001)
    expect(box.y + box.h).toBeLessThanOrEqual(CROP.y + CROP.height + 0.001)
  })
})

describe('stampExecutedPdf — CropBox ≠ MediaBox, non-zero MediaBox origin (end-to-end)', () => {
  it('stamps without throwing, never rewrites the page geometry, and the value renders', async () => {
    const { bytes } = await fixturePage()
    const stamped = await stampExecutedPdf({
      pdfBytes: bytes,
      fields: [
        {
          type: 'name',
          rect: { page: 0, x: 0.25, y: 0.25, w: 0.3, h: 0.06 },
          value: 'CROPBOX SIGNER',
        },
      ],
      certificate: null,
    })
    const out = await PDFDocument.load(stamped)
    expect(out.getPageCount()).toBe(1)
    const outPage = out.getPage(0)
    // Stamping must never rewrite the original page's boxes.
    expect(outPage.getMediaBox()).toEqual(MEDIA)
    expect(outPage.getCropBox()).toEqual(CROP)
    const { text } = await extractPdfText(Buffer.from(stamped))
    expect(text).toContain('CROPBOX FIXTURE')
    expect(text).toContain('CROPBOX SIGNER')
  })
})
