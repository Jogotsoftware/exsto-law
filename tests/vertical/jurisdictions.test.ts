// WP A1 — jurisdiction reference data (verticals/legal/src/api/jurisdictions.ts).
// Pure, no DB: normalize accepts a code or a display name case-insensitively and
// always returns the canonical code; displayName is its inverse. Also proves the
// closed 50-states + DC set (the founder's ask: no hardcoded short list).
import { describe, it, expect } from 'vitest'
import {
  US_STATES,
  US_STATE_ENTRIES,
  normalizeJurisdiction,
  jurisdictionDisplayName,
} from '../../verticals/legal/src/api/jurisdictions.js'

describe('US_STATES', () => {
  it('has exactly 51 entries (50 states + DC)', () => {
    expect(Object.keys(US_STATES)).toHaveLength(51)
    expect(US_STATE_ENTRIES).toHaveLength(51)
  })

  it('includes DC and every code is uppercase 2 letters', () => {
    expect(US_STATES.DC).toBe('District of Columbia')
    for (const code of Object.keys(US_STATES)) {
      expect(code).toMatch(/^[A-Z]{2}$/)
    }
  })
})

describe('normalizeJurisdiction', () => {
  it('accepts an uppercase code', () => {
    expect(normalizeJurisdiction('NC')).toBe('NC')
  })

  it('accepts a lowercase code', () => {
    expect(normalizeJurisdiction('nc')).toBe('NC')
  })

  it('accepts a display name, case-insensitively', () => {
    expect(normalizeJurisdiction('North Carolina')).toBe('NC')
    expect(normalizeJurisdiction('north carolina')).toBe('NC')
    expect(normalizeJurisdiction('NORTH CAROLINA')).toBe('NC')
  })

  it('trims whitespace', () => {
    expect(normalizeJurisdiction('  NC  ')).toBe('NC')
    expect(normalizeJurisdiction('  North Carolina  ')).toBe('NC')
  })

  it('resolves DC by name and code', () => {
    expect(normalizeJurisdiction('DC')).toBe('DC')
    expect(normalizeJurisdiction('District of Columbia')).toBe('DC')
  })

  it('returns null for empty, whitespace-only, or nullish input', () => {
    expect(normalizeJurisdiction('')).toBeNull()
    expect(normalizeJurisdiction('   ')).toBeNull()
    expect(normalizeJurisdiction(null)).toBeNull()
    expect(normalizeJurisdiction(undefined)).toBeNull()
  })

  it('returns null for an unrecognized value (never a guess)', () => {
    expect(normalizeJurisdiction('Ontario')).toBeNull()
    expect(normalizeJurisdiction('ZZ')).toBeNull()
    expect(normalizeJurisdiction('somewhere')).toBeNull()
  })
})

describe('jurisdictionDisplayName', () => {
  it('returns the full name for a code, case-insensitively', () => {
    expect(jurisdictionDisplayName('NC')).toBe('North Carolina')
    expect(jurisdictionDisplayName('nc')).toBe('North Carolina')
  })

  it('returns null for an unrecognized code', () => {
    expect(jurisdictionDisplayName('ZZ')).toBeNull()
    expect(jurisdictionDisplayName('')).toBeNull()
    expect(jurisdictionDisplayName(null)).toBeNull()
  })
})
