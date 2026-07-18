// LI calendar comp-fidelity: pure unit tests for the overlap-layout algorithm
// (events in → columns/widths out, no DOM/DB). Covers the cases the founder's
// ask names directly (a 9:00 + 9:15 pair rendering side-by-side, comp-style)
// plus the chain case that motivated a real cluster+column algorithm instead
// of the naive "pairwise overlap group" approach (uneven widths on a 3-event
// chain where the first and last don't overlap each other).
import { describe, it, expect } from 'vitest'
import {
  layoutOverlappingEvents,
  overlapResultToPct,
  type OverlapInput,
} from '@/lib/calendarOverlapLayout'

function byId(results: ReturnType<typeof layoutOverlappingEvents>, id: string) {
  const r = results.find((x) => x.id === id)
  if (!r) throw new Error(`missing result for ${id}`)
  return r
}

describe('layoutOverlappingEvents', () => {
  it('returns an empty array for no events', () => {
    expect(layoutOverlappingEvents([])).toEqual([])
  })

  it('gives a single event the full column', () => {
    const out = layoutOverlappingEvents([{ id: 'a', startMin: 540, endMin: 600 }])
    expect(out).toEqual([{ id: 'a', columnIndex: 0, columnCount: 1 }])
  })

  it('gives non-overlapping events each the full column', () => {
    const events: OverlapInput[] = [
      { id: 'a', startMin: 540, endMin: 600 }, // 9:00–10:00
      { id: 'b', startMin: 600, endMin: 660 }, // 10:00–11:00 (touches, doesn't overlap)
      { id: 'c', startMin: 720, endMin: 780 }, // 12:00–13:00
    ]
    const out = layoutOverlappingEvents(events)
    for (const r of out) {
      expect(r.columnIndex).toBe(0)
      expect(r.columnCount).toBe(1)
    }
  })

  it('splits a 9:00 + 9:15 overlapping pair into two equal side-by-side lanes (the comp example)', () => {
    const events: OverlapInput[] = [
      { id: 'nine', startMin: 540, endMin: 570 }, // 9:00–9:30
      { id: 'nine15', startMin: 555, endMin: 585 }, // 9:15–9:45
    ]
    const out = layoutOverlappingEvents(events)
    expect(byId(out, 'nine').columnCount).toBe(2)
    expect(byId(out, 'nine15').columnCount).toBe(2)
    expect(new Set(out.map((r) => r.columnIndex))).toEqual(new Set([0, 1]))
    // Widths derived correctly.
    expect(overlapResultToPct(byId(out, 'nine'))).toEqual({ leftPct: 0, widthPct: 50 })
    expect(overlapResultToPct(byId(out, 'nine15'))).toEqual({ leftPct: 50, widthPct: 50 })
  })

  it('gives three mutually-overlapping events three equal lanes', () => {
    const events: OverlapInput[] = [
      { id: 'a', startMin: 540, endMin: 600 },
      { id: 'b', startMin: 545, endMin: 605 },
      { id: 'c', startMin: 550, endMin: 610 },
    ]
    const out = layoutOverlappingEvents(events)
    for (const r of out) expect(r.columnCount).toBe(3)
    expect(new Set(out.map((r) => r.columnIndex))).toEqual(new Set([0, 1, 2]))
  })

  it('handles a chain (A overlaps B, B overlaps C, A does NOT overlap C) with a consistent cluster width', () => {
    // A: 9:00–9:40, B: 9:30–10:10, C: 10:00–10:40. A/C don't overlap, but the
    // whole trio is one connected cluster via B — the naive pairwise algorithm
    // gives A and C only 2 "neighbors" each while B sees 3, producing uneven
    // widths. The real algorithm keeps the cluster at a consistent column
    // count and reuses A's column for C once A has ended.
    const events: OverlapInput[] = [
      { id: 'a', startMin: 540, endMin: 580 },
      { id: 'b', startMin: 570, endMin: 610 },
      { id: 'c', startMin: 600, endMin: 640 },
    ]
    const out = layoutOverlappingEvents(events)
    const a = byId(out, 'a')
    const b = byId(out, 'b')
    const c = byId(out, 'c')
    // Same cluster ⇒ same column count for all three.
    expect(a.columnCount).toBe(2)
    expect(b.columnCount).toBe(2)
    expect(c.columnCount).toBe(2)
    // B can't share a column with either neighbor.
    expect(b.columnIndex).not.toBe(a.columnIndex)
    expect(b.columnIndex).not.toBe(c.columnIndex)
    // A has ended before C starts, so C is free to reuse A's column (classic
    // Google-Calendar-style column reuse, not a wasted extra lane).
    expect(c.columnIndex).toBe(a.columnIndex)
  })

  it('keeps unrelated clusters on the same day independent', () => {
    const events: OverlapInput[] = [
      { id: 'a', startMin: 540, endMin: 570 },
      { id: 'b', startMin: 550, endMin: 580 }, // overlaps a — cluster 1, 2 columns
      { id: 'c', startMin: 900, endMin: 930 }, // isolated — cluster 2, 1 column
    ]
    const out = layoutOverlappingEvents(events)
    expect(byId(out, 'a').columnCount).toBe(2)
    expect(byId(out, 'b').columnCount).toBe(2)
    expect(byId(out, 'c').columnCount).toBe(1)
    expect(byId(out, 'c').columnIndex).toBe(0)
  })

  it('preserves input order in the output array', () => {
    const events: OverlapInput[] = [
      { id: 'z', startMin: 700, endMin: 720 },
      { id: 'y', startMin: 540, endMin: 560 },
      { id: 'x', startMin: 545, endMin: 565 },
    ]
    const out = layoutOverlappingEvents(events)
    expect(out.map((r) => r.id)).toEqual(['z', 'y', 'x'])
  })

  it('clamps a zero-length/inverted event to a minimum span instead of breaking the sweep', () => {
    const events: OverlapInput[] = [
      { id: 'a', startMin: 540, endMin: 540 }, // zero-length
      { id: 'b', startMin: 541, endMin: 560 },
    ]
    const out = layoutOverlappingEvents(events)
    expect(out).toHaveLength(2)
    // The clamp makes `a` span [540, 541), which does not reach b's start (541).
    expect(byId(out, 'a').columnCount).toBe(1)
    expect(byId(out, 'b').columnCount).toBe(1)
  })
})
