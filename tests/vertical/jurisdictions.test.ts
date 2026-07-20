// WP A1 — jurisdiction reference data (verticals/legal/src/api/jurisdictions.ts).
// Pure, no DB: normalize accepts a code or a display name case-insensitively and
// always returns the canonical code; displayName is its inverse. Also proves the
// closed 50-states + DC set (the founder's ask: no hardcoded short list).
import { describe, it, expect } from 'vitest'
import {
  US_STATES,
  US_STATE_ENTRIES,
  US_STATE_NAMES_ES,
  normalizeJurisdiction,
  jurisdictionDisplayName,
} from '../../verticals/legal/src/api/jurisdictions.js'
import {
  GOVERNING_JURISDICTION_FIELD,
  GOVERNING_JURISDICTION_FIELD_ID,
} from '../../verticals/legal/src/api/intakeFieldLibrary.js'

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

// WP A2b — every US_STATES code has a Spanish display name (the reusable
// governing_jurisdiction field's options_i18n depends on this being complete;
// a missing/extra key would silently misalign the parallel options array).
describe('US_STATE_NAMES_ES', () => {
  it('has exactly the same key set as US_STATES', () => {
    expect(Object.keys(US_STATE_NAMES_ES).sort()).toEqual(Object.keys(US_STATES).sort())
  })

  it('every value is a non-empty string', () => {
    for (const [code, name] of Object.entries(US_STATE_NAMES_ES)) {
      expect(typeof name, code).toBe('string')
      expect(name.trim().length, code).toBeGreaterThan(0)
    }
  })
})

// WP A2b — the reusable governing_jurisdiction field (intakeFieldLibrary.ts).
// options / options_i18n.es must stay index-paired (apps/legal-demo/app/book/
// page.tsx's optionLabelOf looks up the Spanish label by the English option's
// index) and the stored option values must always be answers
// normalizeJurisdiction actually recognizes.
describe('GOVERNING_JURISDICTION_FIELD', () => {
  it('has id governing_jurisdiction, is a select, and allows "I\'m not sure"', () => {
    expect(GOVERNING_JURISDICTION_FIELD.id).toBe(GOVERNING_JURISDICTION_FIELD_ID)
    expect(GOVERNING_JURISDICTION_FIELD.type).toBe('select')
    expect(GOVERNING_JURISDICTION_FIELD.allow_unknown).toBe(true)
  })

  it('options are exactly the 51 US_STATE_ENTRIES display names, in order', () => {
    expect(GOVERNING_JURISDICTION_FIELD.options).toEqual(US_STATE_ENTRIES.map(([, name]) => name))
  })

  it('every option normalizes back to its own code (round-trips)', () => {
    for (const [code, name] of US_STATE_ENTRIES) {
      expect(normalizeJurisdiction(name)).toBe(code)
    }
  })

  it('options_i18n.es is index-paired with options (same length)', () => {
    const es = GOVERNING_JURISDICTION_FIELD.options_i18n?.es
    expect(es).toHaveLength(GOVERNING_JURISDICTION_FIELD.options?.length ?? -1)
  })
})
