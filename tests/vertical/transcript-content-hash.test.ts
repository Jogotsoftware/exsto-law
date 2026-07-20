// WP B2 — content-keyed transcript dedupe. PURE unit tests (no DB) for the hash
// normalization contract: transcriptContentHash must be CONSERVATIVE (whitespace
// runs collapsed to a single space, trimmed — nothing else) so genuinely
// different transcripts never collide, while purely cosmetic whitespace
// differences (CRLF vs LF, re-wrapped lines, trailing spaces) DO collide, since
// those are exactly the shape of variance a copy-paste re-submission introduces.
import { describe, it, expect } from 'vitest'
import { transcriptContentHash } from '../../verticals/legal/src/handlers/call.js'

describe('transcriptContentHash — whitespace-only normalization', () => {
  const base = 'The client discussed the lease terms. Rent is $1,850 per month.'

  it('is deterministic for identical input', () => {
    expect(transcriptContentHash(base)).toBe(transcriptContentHash(base))
  })

  it('looks like a sha256 hex digest', () => {
    expect(transcriptContentHash(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('CRLF vs LF line endings collide', () => {
    const crlf = base.replace(/\n/g, '\r\n')
    const withNewlines = `Paragraph one.\nParagraph two.`
    const crlfVariant = `Paragraph one.\r\nParagraph two.`
    expect(transcriptContentHash(base)).toBe(transcriptContentHash(crlf))
    expect(transcriptContentHash(withNewlines)).toBe(transcriptContentHash(crlfVariant))
  })

  it('extra internal whitespace (re-wrapped lines, double spaces, tabs) collides', () => {
    const spaced = 'The client   discussed\tthe lease terms.\n\nRent is $1,850  per month.'
    const rewrapped = 'The client discussed\nthe lease\nterms. Rent is $1,850\nper month.'
    expect(transcriptContentHash(base)).toBe(transcriptContentHash(spaced))
    expect(transcriptContentHash(base)).toBe(transcriptContentHash(rewrapped))
  })

  it('leading/trailing whitespace is trimmed away', () => {
    const padded = `   \n\n${base}   \n  `
    expect(transcriptContentHash(base)).toBe(transcriptContentHash(padded))
  })

  it('genuinely different content does NOT collide', () => {
    const different = 'The client discussed the lease terms. Rent is $1,950 per month.'
    expect(transcriptContentHash(base)).not.toBe(transcriptContentHash(different))
  })

  it('is conservative: does not fold case or strip punctuation', () => {
    const upper = base.toUpperCase()
    const noPunct = base.replace(/[.,$]/g, '')
    expect(transcriptContentHash(base)).not.toBe(transcriptContentHash(upper))
    expect(transcriptContentHash(base)).not.toBe(transcriptContentHash(noPunct))
  })

  it('empty and whitespace-only text hash consistently (both normalize to the empty string)', () => {
    expect(transcriptContentHash('')).toBe(transcriptContentHash('   \n\t  '))
  })
})
