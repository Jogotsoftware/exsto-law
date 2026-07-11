// UI-BUILDER-FIX-1 Phase 2 — pure doctrine checks for client tile copy. No DB.
//   capClientCopy: the upsert handler's last-resort server-side cap
//     (truncate-and-flag at 70 chars, word boundary + ellipsis).
//   clientCopyViolation: the propose_service capture-time gate (hard 70-char
//     budget + no jurisdiction), which makes the model REWRITE instead of chop.
import { describe, it, expect } from 'vitest'
import { capClientCopy } from '../../verticals/legal/src/handlers/serviceLibrary.js'
import { clientCopyViolation } from '../../verticals/legal/src/api/serviceAuthoringTools.js'

describe('capClientCopy (server-side 70-char cap)', () => {
  it('passes short copy through untouched', () => {
    expect(capClientCopy('Last Will & Testament')).toEqual({
      value: 'Last Will & Testament',
      truncated: false,
    })
  })
  it('normalizes empty/whitespace to null', () => {
    expect(capClientCopy('   ')).toEqual({ value: null, truncated: false })
    expect(capClientCopy(null)).toEqual({ value: null, truncated: false })
    expect(capClientCopy(undefined)).toEqual({ value: null, truncated: false })
  })
  it('truncates over-70 copy at a word boundary with an ellipsis and flags it', () => {
    const long =
      'A very long client description that keeps going well past the seventy character tile budget'
    const r = capClientCopy(long)
    expect(r.truncated).toBe(true)
    expect(r.value!.length).toBeLessThanOrEqual(70)
    expect(r.value!.endsWith('…')).toBe(true)
    expect(r.value!).not.toMatch(/\s…$/) // cut lands on a word boundary
  })
})

describe('clientCopyViolation (capture-time doctrine gate)', () => {
  it('accepts outcome-only copy', () => {
    expect(clientCopyViolation('client_display_name', 'Last Will & Testament')).toBeNull()
    expect(clientCopyViolation('client_description', 'A will that protects your family')).toBeNull()
  })
  it('rejects copy over 70 characters', () => {
    const long = 'x'.repeat(71)
    expect(clientCopyViolation('client_description', long)).toMatch(/70/)
  })
  it('rejects jurisdiction by state name and by standalone uppercase code', () => {
    expect(clientCopyViolation('client_display_name', 'North Carolina Will Drafting')).toMatch(
      /jurisdiction/,
    )
    expect(clientCopyViolation('client_display_name', 'NC Will Drafting')).toMatch(/jurisdiction/)
  })
  it('does not false-positive lowercase words that look like state codes', () => {
    expect(clientCopyViolation('client_description', 'Help me in or out of a lease')).toBeNull()
  })
})
