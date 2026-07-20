// PO-1 (Brief modal UX polish, product-walk 2026-07-20) — pins the
// status-vocabulary → chip-tone mapping brief tables/checklists use
// (BriefModal.tsx wires this into renderMarkdown's tdWrap hook). Deliberately
// narrow: only known status words get a chip; everything else passes through
// unwrapped, honest about not guessing.
import { describe, it, expect } from 'vitest'
import { briefStatusChipTone, wrapBriefStatusChip } from '@/lib/briefChips'

describe('briefStatusChipTone', () => {
  it('maps known-good statuses to "ok"', () => {
    expect(briefStatusChipTone('Complete')).toBe('ok')
    expect(briefStatusChipTone('On file')).toBe('ok')
    expect(briefStatusChipTone('complete')).toBe('ok') // case-insensitive
  })

  it('maps "Pending" to "warn"', () => {
    expect(briefStatusChipTone('Pending')).toBe('warn')
  })

  it('maps missing/gap statuses to "danger"', () => {
    expect(briefStatusChipTone('Not on file')).toBe('danger')
    expect(briefStatusChipTone('Gap — missing signature page')).toBe('danger')
    expect(briefStatusChipTone('Gap')).toBe('danger')
  })

  it('maps "Unknown" to "neutral"', () => {
    expect(briefStatusChipTone('Unknown')).toBe('neutral')
  })

  it('leaves free-text cell content unmatched (null), never guesses', () => {
    expect(briefStatusChipTone('See exhibit A')).toBeNull()
    expect(briefStatusChipTone('')).toBeNull()
    expect(briefStatusChipTone('Completed on 2026-07-01')).toBeNull() // not an exact match
  })

  it('trims surrounding whitespace before matching', () => {
    expect(briefStatusChipTone('  Pending  ')).toBe('warn')
  })
})

describe('wrapBriefStatusChip', () => {
  it('wraps recognized status text in a li-brief-chip span with the right tone class', () => {
    const html = wrapBriefStatusChip('Pending', 'Pending')
    expect(html).toBe('<span class="li-brief-chip li-brief-chip--warn">Pending</span>')
  })

  it('passes the already-formatted cell HTML through unchanged for unmatched text', () => {
    const html = wrapBriefStatusChip('See exhibit A', '<strong>See exhibit A</strong>')
    expect(html).toBe('<strong>See exhibit A</strong>')
  })
})
