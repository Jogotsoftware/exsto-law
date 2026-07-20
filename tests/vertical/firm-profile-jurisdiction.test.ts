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

// WP FB-B (migration 0175, PLANNED) — assistant_instructions is a plain text
// field on the same singleton, so it goes through the generic trim/clear
// branch above like firm_name/attorney_name/etc. No special validation (unlike
// firm_jurisdiction); the 2,000-char cap is enforced at the UI/MCP-schema layer
// and defensively again at prompt-injection time (assistantPrompt.ts).
describe('normalizeFirmProfileFieldValue — assistant_instructions', () => {
  it('trims like any other text field', () => {
    expect(
      normalizeFirmProfileFieldValue('assistant_instructions', '  Always CC my paralegal.  '),
    ).toBe('Always CC my paralegal.')
  })

  it('empty/null/non-string clears to an empty string', () => {
    expect(normalizeFirmProfileFieldValue('assistant_instructions', '')).toBe('')
    expect(normalizeFirmProfileFieldValue('assistant_instructions', null)).toBe('')
    expect(normalizeFirmProfileFieldValue('assistant_instructions', undefined)).toBe('')
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
