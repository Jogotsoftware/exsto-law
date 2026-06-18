// Contract M (getBusyIntervals): mergeBusyIntervals is the pure core that turns
// raw Google freebusy blocks into the minimal disjoint busy set S5's availability
// engine consumes. It must clamp to the queried window, drop empties, sort, and
// coalesce overlapping OR touching intervals (adjacency is not free time).
// Pure (no DB / no Google).
import { describe, it, expect } from 'vitest'

const T = (iso: string) => new Date(iso).getTime()
const FROM = T('2026-06-19T00:00:00.000Z')
const TO = T('2026-06-20T00:00:00.000Z')

describe('mergeBusyIntervals (pure)', () => {
  it('sorts, coalesces overlapping intervals, and clamps to the window', async () => {
    const { mergeBusyIntervals } = await import('@exsto/legal')
    const merged = mergeBusyIntervals(
      [
        // out of order; the second overlaps the first → one merged block
        { start: T('2026-06-19T10:00:00.000Z'), end: T('2026-06-19T11:00:00.000Z') },
        { start: T('2026-06-19T09:00:00.000Z'), end: T('2026-06-19T10:30:00.000Z') },
        // a separate, later block
        { start: T('2026-06-19T14:00:00.000Z'), end: T('2026-06-19T15:00:00.000Z') },
        // starts before the window → clamped to FROM
        { start: T('2026-06-18T23:00:00.000Z'), end: T('2026-06-19T00:30:00.000Z') },
      ],
      FROM,
      TO,
    )
    expect(merged).toEqual([
      { startIso: '2026-06-19T00:00:00.000Z', endIso: '2026-06-19T00:30:00.000Z' },
      { startIso: '2026-06-19T09:00:00.000Z', endIso: '2026-06-19T11:00:00.000Z' },
      { startIso: '2026-06-19T14:00:00.000Z', endIso: '2026-06-19T15:00:00.000Z' },
    ])
  })

  it('merges touching intervals (end === next.start) — adjacency is not free time', async () => {
    const { mergeBusyIntervals } = await import('@exsto/legal')
    const merged = mergeBusyIntervals(
      [
        { start: T('2026-06-19T09:00:00.000Z'), end: T('2026-06-19T10:00:00.000Z') },
        { start: T('2026-06-19T10:00:00.000Z'), end: T('2026-06-19T11:00:00.000Z') },
      ],
      FROM,
      TO,
    )
    expect(merged).toEqual([
      { startIso: '2026-06-19T09:00:00.000Z', endIso: '2026-06-19T11:00:00.000Z' },
    ])
  })

  it('drops zero-length, fully-out-of-window, and NaN blocks', async () => {
    const { mergeBusyIntervals } = await import('@exsto/legal')
    const merged = mergeBusyIntervals(
      [
        { start: T('2026-06-19T12:00:00.000Z'), end: T('2026-06-19T12:00:00.000Z') }, // zero-length
        { start: T('2026-06-21T09:00:00.000Z'), end: T('2026-06-21T10:00:00.000Z') }, // after window
        { start: NaN, end: T('2026-06-19T09:00:00.000Z') }, // unparseable
      ],
      FROM,
      TO,
    )
    expect(merged).toEqual([])
  })

  it('returns [] for no input', async () => {
    const { mergeBusyIntervals } = await import('@exsto/legal')
    expect(mergeBusyIntervals([], FROM, TO)).toEqual([])
  })
})
