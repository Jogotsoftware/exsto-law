// WP A2b — governing jurisdiction gathered from the client's intake
// (verticals/legal/src/handlers/intake.ts, matter.open). PURE unit test (no
// DB): resolveGoverningLawStamp projects the intake's raw answers onto the
// governing_law stamp value the handler writes — a real answer normalizes, no
// answer (or an unnormalizable/junk answer, including the "I don't know"
// sentinel) stamps nothing (an honest unset, never a hardcoded default and
// never a guess).
import { describe, it, expect } from 'vitest'
import { resolveGoverningLawStamp } from '../../verticals/legal/src/handlers/intake.js'

describe('resolveGoverningLawStamp', () => {
  it('normalizes a real governing_jurisdiction answer to the canonical code', () => {
    expect(resolveGoverningLawStamp({ governing_jurisdiction: 'North Carolina' })).toBe('NC')
    expect(resolveGoverningLawStamp({ governing_jurisdiction: 'ca' })).toBe('CA')
  })

  it('stamps nothing when the intake carried no such answer', () => {
    expect(resolveGoverningLawStamp({})).toBeNull()
    expect(resolveGoverningLawStamp({ company_name: 'Sunrise Ventures' })).toBeNull()
    expect(resolveGoverningLawStamp(null)).toBeNull()
    expect(resolveGoverningLawStamp(undefined)).toBeNull()
  })

  it('stamps nothing for a junk/unrecognized answer — never a guess', () => {
    expect(resolveGoverningLawStamp({ governing_jurisdiction: 'Narnia' })).toBeNull()
    expect(resolveGoverningLawStamp({ governing_jurisdiction: '' })).toBeNull()
  })

  it('stamps nothing for the WP2.4 "I don\'t know" sentinel (allow_unknown)', () => {
    expect(resolveGoverningLawStamp({ governing_jurisdiction: '__unknown__' })).toBeNull()
  })

  it('ignores a non-string answer shape rather than throwing', () => {
    expect(resolveGoverningLawStamp({ governing_jurisdiction: ['NC'] })).toBeNull()
    expect(resolveGoverningLawStamp({ governing_jurisdiction: 42 })).toBeNull()
  })
})
