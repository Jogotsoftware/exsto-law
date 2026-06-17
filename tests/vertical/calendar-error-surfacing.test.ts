// The dashboard/calendar used to swallow ANY Google read failure as an empty
// "disconnected" calendar, hiding real causes (e.g. the Calendar API not being
// enabled in the Cloud project). cleanGoogleError turns a raw provider error into
// a concise, secret-safe message the UI can show. Pure — no DB, no Google.
import { describe, it, expect } from 'vitest'
import { cleanGoogleError } from '@exsto/legal'

describe('cleanGoogleError (no DB)', () => {
  it('surfaces the actionable Google message (the disabled-API hint) collapsed to one line', () => {
    const msg = cleanGoogleError(
      new Error(
        'Google Calendar API has not been used in project 824250861095 before\n or it is disabled.',
      ),
    )
    expect(msg).toContain('Google Calendar API has not been used in project 824250861095')
    expect(msg).not.toContain('\n') // whitespace collapsed to single spaces
  })

  it('scrubs token-like substrings so a leaked credential never reaches the UI', () => {
    const msg = cleanGoogleError(new Error('auth failed for Bearer ya29.A0ARrdaM-secrettoken123'))
    expect(msg).not.toContain('ya29.A0ARrdaM-secrettoken123')
    expect(msg).toContain('***')
  })

  it('truncates very long errors and accepts non-Error throwables', () => {
    expect(cleanGoogleError('x'.repeat(900)).length).toBeLessThanOrEqual(400)
    expect(cleanGoogleError({ weird: true })).toBe('[object Object]')
  })
})
