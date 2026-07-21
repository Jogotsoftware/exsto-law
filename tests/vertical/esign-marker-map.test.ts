// ESIGN-UNIFY-1 ES-2 — the anchor→rect bridge (§5.2) and the normalized-
// coordinate contract (§5.1): deriveMarkerMap walks a markdown body and yields
// one normalized rect per WHOLE-LINE marker with (type,key,occurrence)
// provenance; markerMapToPlacements turns those into anchor-sourced
// FieldPlacements; normalizeRect/denormalizeRect are exact inverses so a box
// placed on any rendered size stamps at the identical PDF spot.
import { describe, expect, it } from 'vitest'
import {
  deriveMarkerMap,
  markerMapToPlacements,
} from '../../verticals/legal/src/esign/markerMap.js'
import {
  clampRect,
  defaultRectForType,
  denormalizeRect,
  normalizeRect,
  DEFAULT_FIELD_POINTS,
  LETTER_POINTS,
} from '../../verticals/legal/src/esign/placements.js'

const BODY = [
  '# Agreement',
  '',
  'Some prose about the deal.',
  '',
  '**Accepted and Agreed:**',
  '',
  '{{sign:client}}',
  'Name: {{name:client}}',
  '{{date:client}}',
  '',
  '{{sign:attorney}}',
  '{{date:attorney}}',
].join('\n')

describe('deriveMarkerMap (§5.2)', () => {
  it('yields one entry per whole-line marker, in appearance order, with provenance', () => {
    const map = deriveMarkerMap(BODY)
    expect(map.map((m) => `${m.anchor.type}:${m.anchor.key}`)).toEqual([
      'sign:client',
      'name:client',
      'date:client',
      'sign:attorney',
      'date:attorney',
    ])
    // occurrence counts repeat markers per (type,key)
    expect(map.every((m) => m.anchor.occurrence === 0)).toBe(true)
  })

  it('tracks occurrence for repeated markers of the same (type,key)', () => {
    const map = deriveMarkerMap('{{initial:client}}\n\ntext\n\n{{initial:client}}')
    expect(map.map((m) => m.anchor.occurrence)).toEqual([0, 1])
  })

  it('rects are normalized, ordered down the page, and inside the page box', () => {
    const map = deriveMarkerMap(BODY)
    for (const m of map) {
      expect(m.rect.x).toBeGreaterThanOrEqual(0)
      expect(m.rect.y).toBeGreaterThanOrEqual(0)
      expect(m.rect.x + m.rect.w).toBeLessThanOrEqual(1)
      expect(m.rect.y + m.rect.h).toBeLessThanOrEqual(1)
    }
    // strictly increasing y for same-page entries (reading order)
    for (let i = 1; i < map.length; i++) {
      if (map[i]!.rect.page === map[i - 1]!.rect.page) {
        expect(map[i]!.rect.y).toBeGreaterThan(map[i - 1]!.rect.y)
      }
    }
  })

  it('wraps to the next page when the flow runs past the bottom margin', () => {
    const long = Array.from({ length: 60 }, (_, i) => `{{sign:s${i}}}`).join('\n\n')
    const map = deriveMarkerMap(long)
    expect(map[0]!.rect.page).toBe(0)
    expect(map[map.length - 1]!.rect.page).toBeGreaterThan(0)
  })

  it('skips inline markers mid-sentence (prose stays prose)', () => {
    const map = deriveMarkerMap('please sign {{sign:client}} here')
    expect(map).toEqual([])
  })

  it('marker default sizes come from DEFAULT_FIELD_POINTS', () => {
    const map = deriveMarkerMap('{{sign:client}}')
    const rect = map[0]!.rect
    expect(rect.w).toBeCloseTo(DEFAULT_FIELD_POINTS.sign.w / LETTER_POINTS.w, 6)
    expect(rect.h).toBeCloseTo(DEFAULT_FIELD_POINTS.sign.h / LETTER_POINTS.h, 6)
  })
})

describe('markerMapToPlacements (§5.2)', () => {
  it('produces anchor-sourced placements with stable positional ids', () => {
    const placements = markerMapToPlacements(deriveMarkerMap(BODY))
    expect(placements.map((p) => p.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
    expect(placements.every((p) => p.source === 'anchor' && p.anchor)).toBe(true)
    // sign/initial default required; data/date fields do not
    expect(placements.find((p) => p.type === 'sign')!.required).toBe(true)
    expect(placements.find((p) => p.type === 'date')!.required).toBe(false)
  })

  it('startIndex offsets ids so anchor + free-placed plans can merge', () => {
    const placements = markerMapToPlacements(deriveMarkerMap('{{sign:c}}'), { startIndex: 3 })
    expect(placements[0]!.id).toBe('p3')
  })

  it('signerKeyFor remaps template role keys onto recipient keys', () => {
    const placements = markerMapToPlacements(deriveMarkerMap('{{sign:client}}'), {
      signerKeyFor: () => 's1',
    })
    expect(placements[0]!.signerKey).toBe('s1')
    // provenance keeps the ORIGINAL marker key
    expect(placements[0]!.anchor!.key).toBe('client')
  })
})

describe('normalized-coords round-trip (§5.1)', () => {
  it('normalizeRect ∘ denormalizeRect is identity (any render size)', () => {
    for (const [w, h] of [
      [612, 792],
      [900, 1165],
      [412.5, 534],
    ] as const) {
      const px = { x: 101.25, y: 250.5, w: 200, h: 48 }
      const norm = normalizeRect(px, 0, w, h)
      const back = denormalizeRect(norm, w, h)
      expect(back.x).toBeCloseTo(px.x, 6)
      expect(back.y).toBeCloseTo(px.y, 6)
      expect(back.w).toBeCloseTo(px.w, 6)
      expect(back.h).toBeCloseTo(px.h, 6)
    }
  })

  it('a rect authored at one zoom lands at the same PDF points at another', () => {
    const atFit = normalizeRect({ x: 90, y: 300, w: 180, h: 45 }, 0, 900, 1165)
    const pdfPts = denormalizeRect(atFit, LETTER_POINTS.w, LETTER_POINTS.h)
    const at150 = denormalizeRect(atFit, 900 * 1.5, 1165 * 1.5)
    const backToPts = normalizeRect(at150, 0, 900 * 1.5, 1165 * 1.5)
    const pdfPts2 = denormalizeRect(backToPts, LETTER_POINTS.w, LETTER_POINTS.h)
    expect(pdfPts2.x).toBeCloseTo(pdfPts.x, 4)
    expect(pdfPts2.y).toBeCloseTo(pdfPts.y, 4)
    expect(pdfPts2.w).toBeCloseTo(pdfPts.w, 4)
    expect(pdfPts2.h).toBeCloseTo(pdfPts.h, 4)
  })

  it('clampRect keeps a box inside the page and is idempotent', () => {
    const clamped = clampRect({ page: 0, x: 0.95, y: 1.4, w: 0.3, h: 0.1 })
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(1)
    expect(clamped.y + clamped.h).toBeLessThanOrEqual(1)
    expect(clampRect(clamped)).toEqual(clamped)
  })

  it('defaultRectForType clamps a drop near the page edge', () => {
    const rect = defaultRectForType('sign', 0, { x: 0.98, y: 0.99 })
    expect(rect.x + rect.w).toBeLessThanOrEqual(1)
    expect(rect.y + rect.h).toBeLessThanOrEqual(1)
  })
})

// ES-2 — the fields.ts grammar extension: the four data-bound marker kinds
// parse, label, and stay whole-line-detectable exactly like the original seven
// (single-sourced MARKER_TYPE_PATTERN — parser/labels/executionBlock share it).
describe('fields.ts grammar extension (email/company/phone/address)', () => {
  it('parses the new marker kinds with positional ids', async () => {
    const { parseFields, labelFor } = await import('../../verticals/legal/src/esign/fields.js')
    const fields = parseFields(
      '{{email:client}} {{company:client}} {{phone:client}} {{address:client}}',
    )
    expect(fields.map((f) => f.type)).toEqual(['email', 'company', 'phone', 'address'])
    expect(fields.map((f) => f.id)).toEqual(['f0', 'f1', 'f2', 'f3'])
    expect(labelFor('email')).toBe('Email')
    expect(labelFor('company')).toBe('Company')
    expect(labelFor('phone')).toBe('Phone')
    expect(labelFor('address')).toBe('Address')
  })

  it('whole-line detection covers the new kinds (marker map picks them up)', () => {
    const map = deriveMarkerMap('Company: {{company:client}}\n\n{{email:client}}')
    expect(map.map((m) => m.anchor.type)).toEqual(['company', 'email'])
    expect(map[0]!.label).toBe('Company')
  })
})
