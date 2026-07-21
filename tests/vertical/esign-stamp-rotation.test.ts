// ESIGN-ROTATE-FIX — the executed-copy stamper must honor each page's /Rotate.
//
// Placement rects are stored in the ROTATED, VISUAL page space (what the human
// dropped the box onto on the rotation-honoring canvas). pdf-lib draws in the
// UNROTATED MediaBox, so the stamper maps visual → MediaBox with the exact
// inverse of pdfjs's viewport transform. These tests pin that transform for all
// four rotations, prove it is the exact inverse of pdfjs's REAL transforms
// (hard-coded from pdfjs 4.10 `getViewport({ scale: 1 })`), and stamp a real
// 180°/90° page end-to-end.
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import {
  normalizePageRotation,
  visualPageSize,
  visualToMediaPoint,
  placementRectToMediaBox,
  stampExecutedPdf,
  type PageRotation,
} from '../../verticals/legal/src/esign/stampPdf.js'
import type { PlacementRect } from '../../verticals/legal/src/esign/placements.js'
import { extractPdfText } from '../../verticals/legal/src/api/pdfText.js'

const W = 612
const H = 792

// pdfjs 4.10 `page.getViewport({ scale: 1 }).transform` for a 612×792 page at
// each /Rotate — the source of truth this fix inverts. Maps MediaBox (mx,my,
// bottom-left) → device/visual (vx,vy, top-left): vx=a·mx+c·my+e, vy=b·mx+d·my+f.
const PDFJS_TRANSFORM: Record<PageRotation, [number, number, number, number, number, number]> = {
  0: [1, 0, 0, -1, 0, 792],
  90: [0, 1, 1, 0, 0, 0],
  180: [-1, 0, 0, 1, 612, 0],
  270: [0, -1, -1, 0, 792, 612],
}
function pdfjsForward(rot: PageRotation, mx: number, my: number): { vx: number; vy: number } {
  const [a, b, c, d, e, f] = PDFJS_TRANSFORM[rot]
  return { vx: a * mx + c * my + e, vy: b * mx + d * my + f }
}

describe('normalizePageRotation', () => {
  it('snaps any multiple of 90 (incl. negative / >360) to 0/90/180/270', () => {
    expect(normalizePageRotation(0)).toBe(0)
    expect(normalizePageRotation(90)).toBe(90)
    expect(normalizePageRotation(180)).toBe(180)
    expect(normalizePageRotation(270)).toBe(270)
    expect(normalizePageRotation(360)).toBe(0)
    expect(normalizePageRotation(-90)).toBe(270)
    expect(normalizePageRotation(450)).toBe(90)
    expect(normalizePageRotation(-180)).toBe(180)
  })
})

describe('visualPageSize', () => {
  it('keeps dims for 0/180 and swaps width/height for 90/270', () => {
    expect(visualPageSize(W, H, 0)).toEqual({ w: W, h: H })
    expect(visualPageSize(W, H, 180)).toEqual({ w: W, h: H })
    expect(visualPageSize(W, H, 90)).toEqual({ w: H, h: W })
    expect(visualPageSize(W, H, 270)).toEqual({ w: H, h: W })
  })
})

describe('visualToMediaPoint — exact inverse of pdfjs getViewport', () => {
  // Sample MediaBox points; each must round-trip MediaBox → visual (pdfjs) →
  // MediaBox (our inverse) to itself, for every rotation.
  const samples: Array<[number, number]> = [
    [0, 0],
    [100, 200],
    [612, 792],
    [300, 50],
    [12, 700],
  ]
  for (const rot of [0, 90, 180, 270] as PageRotation[]) {
    it(`/Rotate ${rot} inverts pdfjs's transform`, () => {
      for (const [mx, my] of samples) {
        const { vx, vy } = pdfjsForward(rot, mx, my)
        const back = visualToMediaPoint(vx, vy, W, H, rot)
        expect(back.x).toBeCloseTo(mx, 6)
        expect(back.y).toBeCloseTo(my, 6)
      }
    })
  }
})

describe('placementRectToMediaBox — all four rotations', () => {
  const rect: PlacementRect = { page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }

  it('/Rotate 0 reduces exactly to the legacy rectToBox formula', () => {
    const box = placementRectToMediaBox(rect, W, H, 0)
    // legacy: x = rect.x·W ; y = H − rect.y·H − rect.h·H ; w = rect.w·W ; h = rect.h·H
    expect(box.x).toBeCloseTo(rect.x * W, 6)
    expect(box.y).toBeCloseTo(H - rect.y * H - rect.h * H, 6)
    expect(box.w).toBeCloseTo(rect.w * W, 6)
    expect(box.h).toBeCloseTo(rect.h * H, 6)
    expect(box.rotate).toBe(0)
  })

  it('/Rotate 180 mirrors the box into the diagonally-opposite corner', () => {
    const box = placementRectToMediaBox(rect, W, H, 180)
    expect(box.x).toBeCloseTo(367.2, 4) // W − rect.x·W − rect.w·W
    expect(box.y).toBeCloseTo(158.4, 4) // rect.y·H
    expect(box.w).toBeCloseTo(183.6, 4)
    expect(box.h).toBeCloseTo(79.2, 4)
    expect(box.rotate).toBe(180)
  })

  it('/Rotate 90 swaps width/height (visual space is landscape)', () => {
    const box = placementRectToMediaBox(rect, W, H, 90)
    expect(box.x).toBeCloseTo(122.4, 4)
    expect(box.y).toBeCloseTo(79.2, 4)
    expect(box.w).toBeCloseTo(61.2, 4) // was rect.h, now along MediaBox x
    expect(box.h).toBeCloseTo(237.6, 4) // was rect.w, now along MediaBox y
    expect(box.rotate).toBe(90)
  })

  it('/Rotate 270 swaps width/height into the opposite corner', () => {
    const box = placementRectToMediaBox(rect, W, H, 270)
    expect(box.x).toBeCloseTo(428.4, 4)
    expect(box.y).toBeCloseTo(475.2, 4)
    expect(box.w).toBeCloseTo(61.2, 4)
    expect(box.h).toBeCloseTo(237.6, 4)
    expect(box.rotate).toBe(270)
  })

  it('every rotation keeps the stamped box fully inside the MediaBox', () => {
    for (const rot of [0, 90, 180, 270] as PageRotation[]) {
      const box = placementRectToMediaBox(rect, W, H, rot)
      expect(box.x).toBeGreaterThanOrEqual(-0.001)
      expect(box.y).toBeGreaterThanOrEqual(-0.001)
      expect(box.x + box.w).toBeLessThanOrEqual(W + 0.001)
      expect(box.y + box.h).toBeLessThanOrEqual(H + 0.001)
    }
  })
})

describe('stampExecutedPdf — real rotated pages (end-to-end)', () => {
  async function rotatedOriginal(rot: PageRotation): Promise<Uint8Array> {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([W, H])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    page.drawText('ROTATED DOCUMENT', { x: 72, y: 700, size: 14, font })
    page.setRotation(degrees(rot))
    return pdf.save()
  }

  for (const rot of [90, 180, 270] as PageRotation[]) {
    it(`stamps a field onto a /Rotate ${rot} page and preserves the page's rotation`, async () => {
      const original = await rotatedOriginal(rot)
      const stamped = await stampExecutedPdf({
        pdfBytes: original,
        fields: [
          {
            type: 'name',
            rect: { page: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.05 },
            value: `SIGNER ${rot}`,
          },
        ],
        certificate: null,
      })
      const out = await PDFDocument.load(stamped)
      expect(out.getPageCount()).toBe(1)
      // The original /Rotate survives the stamp (we draw into it, never strip it).
      expect(out.getPage(0).getRotation().angle).toBe(rot)
      const { text } = await extractPdfText(Buffer.from(stamped))
      expect(text).toContain('ROTATED DOCUMENT')
      expect(text).toContain(`SIGNER ${rot}`)
    })
  }
})
