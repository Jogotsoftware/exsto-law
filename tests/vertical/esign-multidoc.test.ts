// ES-MULTIDOC-1 — one envelope, many documents. Pure coverage of the two new
// contracts (no DB, no workspace build): (1) a placement is bound to (document,
// page) via docIndex, and the grouping helpers split a flat plan per document;
// (2) the executed-copy stamper draws EACH document's placement subset onto that
// document only — a field on doc 1 never lands on doc 0. Reuses the pdf-lib
// golden-fixture pattern from esign-stamp-pdf.test.ts.
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  groupPlacementsByDoc,
  maxPlacementDocIndex,
  parseEnvelopePlacements,
  placementDocIndex,
  placementsForDoc,
  type FieldPlacement,
} from '../../verticals/legal/src/esign/placements.js'
import { stampExecutedPdf } from '../../verticals/legal/src/esign/stampPdf.js'
import { extractPdfText } from '../../verticals/legal/src/api/pdfText.js'

// A single-document placement (no docIndex) — document 0 by convention.
const DOC0: FieldPlacement = {
  id: 'p0',
  type: 'sign',
  signerKey: 'client',
  required: true,
  source: 'placed',
  rect: { page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05 },
}
// A second-document placement (docIndex 1).
const DOC1: FieldPlacement = {
  id: 'p1',
  type: 'date',
  signerKey: 'client',
  required: false,
  docIndex: 1,
  source: 'placed',
  rect: { page: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.03 },
}

describe('placement-to-document binding (docIndex)', () => {
  it('placementDocIndex defaults absent/0 to document 0 and reads a positive index', () => {
    expect(placementDocIndex(DOC0)).toBe(0)
    expect(placementDocIndex({ ...DOC0, docIndex: 0 })).toBe(0)
    expect(placementDocIndex(DOC1)).toBe(1)
    expect(placementDocIndex({ ...DOC0, docIndex: 3 })).toBe(3)
    // Defensive: a negative/NaN docIndex collapses to 0, never a negative index.
    expect(placementDocIndex({ ...DOC0, docIndex: -2 })).toBe(0)
  })

  it('round-trips docIndex only when >= 1 (single-doc plans stay byte-identical)', () => {
    // Document 0 placement: NO docIndex key survives the parse — a single-doc or
    // pre-multidoc plan is unchanged (this is the zero-regression guarantee).
    expect(parseEnvelopePlacements([DOC0])).toEqual([DOC0])
    expect(parseEnvelopePlacements([{ ...DOC0, docIndex: 0 }])).toEqual([DOC0])
    // Document 1 placement: docIndex preserved.
    expect(parseEnvelopePlacements([DOC1])).toEqual([DOC1])
    // A fractional index floors to an integer.
    expect(parseEnvelopePlacements([{ ...DOC1, docIndex: 2.9 }])).toEqual([{ ...DOC1, docIndex: 2 }])
  })

  it('placementsForDoc / groupPlacementsByDoc / maxPlacementDocIndex split a flat plan', () => {
    const plan: FieldPlacement[] = [
      DOC0,
      DOC1,
      { ...DOC0, id: 'p2' }, // another doc-0 field
      { ...DOC1, id: 'p3', docIndex: 2 }, // a doc-2 field
    ]
    expect(placementsForDoc(plan, 0).map((p) => p.id)).toEqual(['p0', 'p2'])
    expect(placementsForDoc(plan, 1).map((p) => p.id)).toEqual(['p1'])
    expect(placementsForDoc(plan, 2).map((p) => p.id)).toEqual(['p3'])
    expect(placementsForDoc(plan, 3)).toEqual([])

    const grouped = groupPlacementsByDoc(plan)
    expect([...grouped.keys()].sort()).toEqual([0, 1, 2])
    expect(grouped.get(0)!.map((p) => p.id)).toEqual(['p0', 'p2'])

    expect(maxPlacementDocIndex(plan)).toBe(2)
    expect(maxPlacementDocIndex([DOC0])).toBe(0)
    expect(maxPlacementDocIndex([])).toBe(0)
  })
})

async function buildLabeledPdf(label: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText(label, { x: 72, y: 720, size: 16, font })
  return pdf.save()
}

describe('executed-copy stamping over 2 documents', () => {
  it('stamps each document with only its own placement subset', async () => {
    // A single flat plan spanning two documents (the envelope_placements shape).
    const plan: FieldPlacement[] = [
      {
        id: 'p0',
        type: 'sign',
        signerKey: 'client',
        required: true,
        source: 'placed',
        rect: { page: 0, x: 0.12, y: 0.4, w: 0.33, h: 0.06 },
        value: 'Ada Lovelace', // resolved by the send path in real flows
      },
      {
        id: 'p1',
        type: 'sign',
        signerKey: 'client',
        required: true,
        docIndex: 1,
        source: 'placed',
        rect: { page: 0, x: 0.12, y: 0.4, w: 0.33, h: 0.06 },
        value: 'Grace Hopper',
      },
    ]

    // Each document is stamped independently with placementsForDoc(plan, d) —
    // exactly what loadExecutedStampPlan produces and sign/submit executes.
    const doc0 = await buildLabeledPdf('AGREEMENT ONE')
    const doc1 = await buildLabeledPdf('AGREEMENT TWO')

    const stamped0 = await stampExecutedPdf({
      pdfBytes: doc0,
      fields: placementsForDoc(plan, 0).map((p) => ({ type: p.type, rect: p.rect, value: p.value })),
      certificate: null,
    })
    const stamped1 = await stampExecutedPdf({
      pdfBytes: doc1,
      fields: placementsForDoc(plan, 1).map((p) => ({ type: p.type, rect: p.rect, value: p.value })),
      certificate: null,
    })

    const t0 = await extractPdfText(Buffer.from(stamped0))
    const t1 = await extractPdfText(Buffer.from(stamped1))

    // Document 0 carries its own content + its own signer; NOT document 1's.
    expect(t0.text).toContain('AGREEMENT ONE')
    expect(t0.text).toContain('Ada Lovelace')
    expect(t0.text).not.toContain('Grace Hopper')

    // Document 1 carries its own content + its own signer; NOT document 0's.
    expect(t1.text).toContain('AGREEMENT TWO')
    expect(t1.text).toContain('Grace Hopper')
    expect(t1.text).not.toContain('Ada Lovelace')
  })
})
