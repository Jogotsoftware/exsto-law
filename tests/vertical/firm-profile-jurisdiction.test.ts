// WP A1 — legal.firm.set_profile field validation
// (verticals/legal/src/handlers/firmProfile.ts). normalizeFirmProfileFieldValue
// is PURE (no DB) — text fields trim/clear, practice_areas dedupes/cleans, and
// firm_jurisdiction must normalize to a canonical US state code or be rejected
// (never silently stored as garbage a resolver could never match).
import { describe, it, expect } from 'vitest'
import { normalizeFirmProfileFieldValue } from '../../verticals/legal/src/handlers/firmProfile.js'

describe('normalizeFirmProfileFieldValue — text fields', () => {
  it('trims a text field', () => {
    expect(normalizeFirmProfileFieldValue('firm_name', '  Pacheco Law  ')).toBe('Pacheco Law')
  })

  it('empty/null/non-string clears to an empty string', () => {
    expect(normalizeFirmProfileFieldValue('attorney_name', '')).toBe('')
    expect(normalizeFirmProfileFieldValue('attorney_name', null)).toBe('')
    expect(normalizeFirmProfileFieldValue('attorney_name', undefined)).toBe('')
  })
})

// ITEM-12 WP-2 — assistant_instructions / portal_assistant_instructions are no
// longer plain text: the Settings → Assistant editor now saves them as pills
// (one Enter-to-add instruction per array item), so they go through the same
// array-normalization discipline as practice_areas below — trim, drop empty,
// dedupe case-insensitively, non-array input fails safe to [] — PLUS a
// per-item cap (500 chars) and a total-list cap (20 items) practice_areas does
// not have, since an instruction pill is meant to stay short and scannable.
describe('normalizeFirmProfileFieldValue — assistant_instructions / portal_assistant_instructions', () => {
  it('trims, drops empties, and dedupes case-insensitively (both kinds)', () => {
    for (const kind of ['assistant_instructions', 'portal_assistant_instructions'] as const) {
      expect(
        normalizeFirmProfileFieldValue(kind, [
          '  Always CC my paralegal.  ',
          'Always CC My Paralegal.',
          '',
          '   ',
          'Mention office hours.',
        ]),
      ).toEqual(['Always CC my paralegal.', 'Mention office hours.'])
    }
  })

  it('drops non-string entries', () => {
    expect(
      normalizeFirmProfileFieldValue('assistant_instructions', ['keep this', 42, null, 'and this']),
    ).toEqual(['keep this', 'and this'])
  })

  it('a non-array input clears to an empty array (fails safe, matches practice_areas)', () => {
    expect(normalizeFirmProfileFieldValue('assistant_instructions', null)).toEqual([])
    expect(
      normalizeFirmProfileFieldValue('assistant_instructions', 'Always CC my paralegal.'),
    ).toEqual([])
    expect(normalizeFirmProfileFieldValue('assistant_instructions', undefined)).toEqual([])
    expect(normalizeFirmProfileFieldValue('portal_assistant_instructions', null)).toEqual([])
  })

  it('an already-empty array clears', () => {
    expect(normalizeFirmProfileFieldValue('assistant_instructions', [])).toEqual([])
    expect(normalizeFirmProfileFieldValue('portal_assistant_instructions', [])).toEqual([])
  })

  it('caps each item at 500 characters', () => {
    const long = 'x'.repeat(600)
    const result = normalizeFirmProfileFieldValue('assistant_instructions', [long]) as string[]
    expect(result).toEqual([long.slice(0, 500)])
    expect(result[0]).toHaveLength(500)
  })

  it('caps the whole list at 20 items', () => {
    const items = Array.from({ length: 25 }, (_, i) => `instruction ${i}`)
    const result = normalizeFirmProfileFieldValue('assistant_instructions', items) as string[]
    expect(result).toHaveLength(20)
    expect(result).toEqual(items.slice(0, 20))
  })
})

describe('normalizeFirmProfileFieldValue — firm_jurisdiction', () => {
  it('normalizes a code to itself (uppercased)', () => {
    expect(normalizeFirmProfileFieldValue('firm_jurisdiction', 'nc')).toBe('NC')
  })

  it('normalizes a display name to its code', () => {
    expect(normalizeFirmProfileFieldValue('firm_jurisdiction', 'North Carolina')).toBe('NC')
  })

  it('empty clears (no error)', () => {
    expect(normalizeFirmProfileFieldValue('firm_jurisdiction', '')).toBe('')
    expect(normalizeFirmProfileFieldValue('firm_jurisdiction', null)).toBe('')
  })

  it('rejects an unrecognized jurisdiction rather than storing it', () => {
    expect(() => normalizeFirmProfileFieldValue('firm_jurisdiction', 'Atlantis')).toThrow(
      /valid US state code or name/,
    )
  })
})

describe('normalizeFirmProfileFieldValue — practice_areas', () => {
  it('trims, drops empties, and dedupes case-insensitively', () => {
    expect(
      normalizeFirmProfileFieldValue('practice_areas', [
        ' business law ',
        'Business Law',
        '',
        '   ',
        'family law',
      ]),
    ).toEqual(['business law', 'family law'])
  })

  it('drops non-string entries', () => {
    expect(normalizeFirmProfileFieldValue('practice_areas', ['tax', 42, null, 'estate'])).toEqual([
      'tax',
      'estate',
    ])
  })

  it('a non-array input clears to an empty array (fails safe)', () => {
    expect(normalizeFirmProfileFieldValue('practice_areas', null)).toEqual([])
    expect(normalizeFirmProfileFieldValue('practice_areas', 'business law')).toEqual([])
    expect(normalizeFirmProfileFieldValue('practice_areas', undefined)).toEqual([])
  })

  it('an already-empty array clears', () => {
    expect(normalizeFirmProfileFieldValue('practice_areas', [])).toEqual([])
  })
})
