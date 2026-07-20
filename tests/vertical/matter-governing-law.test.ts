// WP A1 — legal.matter.set_governing_law value validation
// (verticals/legal/src/handlers/matterJurisdiction.ts). PURE, no DB: normalizes
// to the canonical US state code or rejects an unrecognized value; empty clears.
import { describe, it, expect } from 'vitest'
import { normalizeGoverningLawValue } from '../../verticals/legal/src/handlers/matterJurisdiction.js'

describe('normalizeGoverningLawValue', () => {
  it('normalizes a code', () => {
    expect(normalizeGoverningLawValue('nc')).toBe('NC')
  })

  it('normalizes a legacy display-string value (matches intake.ts seed)', () => {
    expect(normalizeGoverningLawValue('North Carolina')).toBe('NC')
  })

  it('empty / whitespace / nullish clears to an empty string', () => {
    expect(normalizeGoverningLawValue('')).toBe('')
    expect(normalizeGoverningLawValue('   ')).toBe('')
    expect(normalizeGoverningLawValue(null)).toBe('')
    expect(normalizeGoverningLawValue(undefined)).toBe('')
  })

  it('rejects an unrecognized value rather than storing it', () => {
    expect(() => normalizeGoverningLawValue('Narnia')).toThrow(/valid US state code or name/)
  })
})
