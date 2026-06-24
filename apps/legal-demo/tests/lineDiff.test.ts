import { describe, it, expect } from 'vitest'
import { lineDiff, diffStats } from '../lib/lineDiff'

describe('lineDiff', () => {
  it('marks identical documents as all-same', () => {
    const ops = lineDiff('a\nb\nc', 'a\nb\nc')
    expect(ops.every((o) => o.type === 'same')).toBe(true)
    expect(diffStats(ops)).toEqual({ added: 0, removed: 0 })
  })

  it('detects a changed line as one del + one add', () => {
    const ops = lineDiff('a\nb\nc', 'a\nB\nc')
    expect(diffStats(ops)).toEqual({ added: 1, removed: 1 })
    expect(ops).toEqual([
      { type: 'same', line: 'a' },
      { type: 'del', line: 'b' },
      { type: 'add', line: 'B' },
      { type: 'same', line: 'c' },
    ])
  })

  it('detects a pure insertion', () => {
    const ops = lineDiff('a\nc', 'a\nb\nc')
    expect(diffStats(ops)).toEqual({ added: 1, removed: 0 })
    expect(ops.find((o) => o.type === 'add')?.line).toBe('b')
  })

  it('detects a pure deletion', () => {
    const ops = lineDiff('a\nb\nc', 'a\nc')
    expect(diffStats(ops)).toEqual({ added: 0, removed: 1 })
    expect(ops.find((o) => o.type === 'del')?.line).toBe('b')
  })

  it('preserves common lines around an edit (LCS, not naive zip)', () => {
    // Inserting a paragraph at the top must not mark everything after as changed.
    const ops = lineDiff('intro\nbody', 'new heading\nintro\nbody')
    expect(diffStats(ops)).toEqual({ added: 1, removed: 0 })
    expect(ops.filter((o) => o.type === 'same').map((o) => o.line)).toEqual(['intro', 'body'])
  })

  it('handles empty base (all added)', () => {
    const ops = lineDiff('', 'a\nb')
    expect(diffStats(ops).added).toBeGreaterThanOrEqual(2)
    expect(diffStats(ops).removed).toBe(0)
  })
})
