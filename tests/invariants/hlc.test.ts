// Invariant 15 — Hybrid logical clocks. Pure unit test (no DB): every HLC from
// a process is monotonically non-decreasing and shares one source_id, so
// causally-related events order deterministically even at equal wall-clock ms.
import { describe, it, expect } from 'vitest'
import { nextHlc } from '@exsto/substrate'

function compare(a: ReturnType<typeof nextHlc>, b: ReturnType<typeof nextHlc>): number {
  if (a.physical_time !== b.physical_time) return a.physical_time < b.physical_time ? -1 : 1
  return a.logical_counter - b.logical_counter
}

describe('invariant 15: hybrid logical clocks', () => {
  it('produces a strictly ordered sequence', () => {
    const seq = Array.from({ length: 1000 }, () => nextHlc())
    for (let i = 1; i < seq.length; i++) {
      expect(compare(seq[i - 1]!, seq[i]!)).toBeLessThan(0)
    }
  })

  it('shares a single source_id across the process', () => {
    const ids = new Set(Array.from({ length: 50 }, () => nextHlc().source_id))
    expect(ids.size).toBe(1)
  })

  it('advances the logical counter when wall-clock ms collide', () => {
    const a = nextHlc()
    const b = nextHlc()
    // Two calls in the same ms must differ by the logical counter.
    if (a.physical_time === b.physical_time) {
      expect(b.logical_counter).toBeGreaterThan(a.logical_counter)
    } else {
      expect(b.physical_time > a.physical_time).toBe(true)
    }
  })
})
