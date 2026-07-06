// parseTimestamp/formatDateTime pin the fix for "every date on the review queue
// is showing invalid". Substrate reads serialize timestamps with Postgres
// `to_char(ts, '...SSOF')`, which emits a bare hour-only offset ("+00", "-05")
// that native `new Date()` rejects as Invalid Date. The helper normalizes it.
import { describe, it, expect } from 'vitest'
import { parseTimestamp, formatDateTime, formatDate } from '../lib/datetime'

describe('parseTimestamp', () => {
  it('parses the substrate SSOF format with a bare +00 hour offset', () => {
    const d = parseTimestamp('2026-06-23T00:13:00+00')
    expect(d).not.toBeNull()
    // 00:13 UTC is the instant regardless of the viewer's locale.
    expect(d!.toISOString()).toBe('2026-06-23T00:13:00.000Z')
  })

  it('parses a bare negative hour offset (-05)', () => {
    const d = parseTimestamp('2026-06-22T19:13:00-05')
    expect(d!.toISOString()).toBe('2026-06-23T00:13:00.000Z')
  })

  it('still parses fully-specified offsets and Z', () => {
    expect(parseTimestamp('2026-06-23T00:13:00+00:00')!.toISOString()).toBe(
      '2026-06-23T00:13:00.000Z',
    )
    expect(parseTimestamp('2026-06-23T00:13:00Z')!.toISOString()).toBe('2026-06-23T00:13:00.000Z')
  })

  it('leaves a half-hour offset (already has minutes) intact', () => {
    const d = parseTimestamp('2026-06-23T05:43:00+05:30')
    expect(d!.toISOString()).toBe('2026-06-23T00:13:00.000Z')
  })

  it('parses a date-only value as LOCAL midnight (a due date means that calendar day)', () => {
    const d = parseTimestamp('2026-07-06')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(6)
    expect(d!.getDate()).toBe(6) // local — never shifts to the previous day
    expect(d!.getHours()).toBe(0)
  })

  it('returns null for empty / nullish / unparseable input', () => {
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp(undefined)).toBeNull()
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('not a date')).toBeNull()
  })
})

describe('formatDateTime / formatDate', () => {
  it('never returns "Invalid Date" for the SSOF format', () => {
    expect(formatDateTime('2026-06-23T00:13:00+00')).not.toMatch(/invalid/i)
    expect(formatDate('2026-06-23T00:13:00+00')).not.toMatch(/invalid/i)
  })

  it('falls back to a dash (not "Invalid Date") on bad input', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDate('garbage')).toBe('—')
  })
})
