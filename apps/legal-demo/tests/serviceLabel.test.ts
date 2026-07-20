// FB-C — the one shared serviceKey → label resolver (lib/serviceLabel) collapses
// 5 copies of the same function that each hardcoded
// `if (key === 'llc_formation') return 'NC LLC formation'`. This suite locks in
// the two contract points that matter: no hardcoded firm/jurisdiction-specific
// label ever comes out of the generic fallback, and a resolved catalog
// displayName always wins when one is available.

import { describe, it, expect } from 'vitest'
import { humanizeServiceKey, serviceLabel } from '@/lib/serviceLabel'

describe('humanizeServiceKey — generic fallback only, never a hardcoded firm label', () => {
  it('never returns the old hardcoded "NC LLC formation" literal for llc_formation', () => {
    expect(humanizeServiceKey('llc_formation')).not.toContain('NC LLC formation')
    expect(humanizeServiceKey('llc_formation')).not.toMatch(/Pacheco/i)
  })

  it('never returns the old hardcoded "NC LLC formation" literal for business_formation', () => {
    expect(humanizeServiceKey('business_formation')).not.toContain('NC LLC formation')
  })

  it('humanizes an arbitrary key generically (underscores → spaces)', () => {
    expect(humanizeServiceKey('llc_formation')).toBe('llc formation')
    expect(humanizeServiceKey('trademark_registration')).toBe('trademark registration')
  })

  it('keeps the "other" → "Custom" sentinel (not a firm-specific literal)', () => {
    expect(humanizeServiceKey('other')).toBe('Custom')
  })

  it('degrades honestly on an empty key', () => {
    expect(humanizeServiceKey('')).toBe('—')
  })
})

describe('serviceLabel — prefers the resolved catalog displayName over the fallback', () => {
  it('uses the provided displayName when the key resolves in the catalog', () => {
    const catalog = { llc_formation: 'Business Formation Package' }
    expect(serviceLabel('llc_formation', catalog)).toBe('Business Formation Package')
  })

  it('falls back to the generic humanization when the key is absent from the catalog', () => {
    expect(serviceLabel('llc_formation', {})).toBe('llc formation')
  })

  it('falls back to the generic humanization when no catalog is supplied', () => {
    expect(serviceLabel('llc_formation')).toBe('llc formation')
    expect(serviceLabel('llc_formation', null)).toBe('llc formation')
  })

  it('never surfaces a hardcoded firm/jurisdiction label regardless of catalog state', () => {
    expect(serviceLabel('llc_formation', null)).not.toMatch(/Pacheco|^NC LLC formation$/)
  })
})
