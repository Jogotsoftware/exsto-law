// ESIGN-UNIFY-1 (ES-1) — the FieldPlacement storage model (design §5.1):
// schema parse of well-formed plans and DEFENSIVE reads of everything a legacy
// or hand-mangled envelope_placements attribute can throw at it. Legacy
// envelopes (pre-0186) have NO placements attribute at all — that read must
// degrade to [] so the whole-line envelope_fields flow keeps rendering.
import { describe, expect, it } from 'vitest'
import {
  isPlacementFieldType,
  parseEnvelopePlacements,
  serializeEnvelopePlacements,
  type FieldPlacement,
} from '../../verticals/legal/src/esign/placements.js'

const GOOD: FieldPlacement = {
  id: 'p0',
  type: 'sign',
  signerKey: 'client',
  required: true,
  label: 'Signature',
  source: 'anchor',
  anchor: { type: 'sign', key: 'client', occurrence: 0 },
  rect: { page: 1, x: 0.1, y: 0.82, w: 0.3, h: 0.05 },
}

describe('parseEnvelopePlacements — schema parse', () => {
  it('round-trips a well-formed plan', () => {
    const parsed = parseEnvelopePlacements([GOOD])
    expect(parsed).toEqual([GOOD])
  })

  it('accepts data-bound types (email/company/phone/address) and free placement', () => {
    const placed: FieldPlacement = {
      id: 'p1',
      type: 'email',
      signerKey: 's2',
      required: false,
      source: 'placed',
      rect: { page: 2, x: 0.5, y: 0.5, w: 0.25, h: 0.03 },
    }
    expect(parseEnvelopePlacements([placed])).toEqual([placed])
  })

  it('serialize is a stable passthrough (one seam for future normalization)', () => {
    expect(serializeEnvelopePlacements([GOOD])).toEqual([GOOD])
  })
})

describe('parseEnvelopePlacements — defensive read of legacy envelopes', () => {
  it('degrades non-array / missing values to an empty list (pre-0186 envelopes)', () => {
    expect(parseEnvelopePlacements(null)).toEqual([])
    expect(parseEnvelopePlacements(undefined)).toEqual([])
    expect(parseEnvelopePlacements({})).toEqual([])
    expect(parseEnvelopePlacements('[]')).toEqual([])
    expect(parseEnvelopePlacements(42)).toEqual([])
  })

  it('drops malformed entries without poisoning the rest of the list', () => {
    const parsed = parseEnvelopePlacements([
      GOOD,
      null,
      'junk',
      { id: 'p9' }, // missing everything
      { ...GOOD, id: 'p2', type: 'hologram' }, // unknown type
      { ...GOOD, id: 'p3', rect: { page: 1, x: 'left' } }, // bad rect
      { ...GOOD, id: 'p4', signerKey: '' }, // empty signer key
    ])
    expect(parsed.map((p) => p.id)).toEqual(['p0'])
  })

  it('a malformed anchor is dropped but the placement survives (rect is the truth)', () => {
    const parsed = parseEnvelopePlacements([
      { ...GOOD, id: 'p5', anchor: { type: 'sign' } }, // anchor missing key/occurrence
    ])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.anchor).toBeUndefined()
    expect(parsed[0]!.rect).toEqual(GOOD.rect)
  })

  it('unknown source values collapse to "placed"', () => {
    const parsed = parseEnvelopePlacements([{ ...GOOD, id: 'p6', source: 'wormhole' }])
    expect(parsed[0]!.source).toBe('placed')
  })
})

describe('isPlacementFieldType', () => {
  it('accepts the marker grammar plus the data-bound extension, rejects others', () => {
    for (const t of ['sign', 'initial', 'name', 'date', 'title', 'text', 'check']) {
      expect(isPlacementFieldType(t)).toBe(true)
    }
    for (const t of ['email', 'company', 'phone', 'address']) {
      expect(isPlacementFieldType(t)).toBe(true)
    }
    expect(isPlacementFieldType('stamp')).toBe(false)
    expect(isPlacementFieldType(3)).toBe(false)
  })
})
