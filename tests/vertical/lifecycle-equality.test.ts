// ADR 0045 PR2 — THE equality invariant. Proves the derived lifecycle data
// reproduces today's hardcoded behavior, so PR3 can flip the engine to read data
// with zero behavior change. PURE (no DB, always runs).
//
// The engine's ENTIRE automatic behavior today is one line in api/granolaIngestion.ts:
//   if (matterRoute?.route !== 'auto') return   // else auto-draft on transcript ingest
// i.e. the only thing that advances a matter without a human/external trigger is
// auto-route drafting. So the test of "data == behavior" is exactly:
//   automatic edges in the derived graph  ==  { consulted → in_review, iff route=auto }
import { describe, it, expect } from 'vitest'
import {
  deriveLifecycleFromService,
  automaticEdges,
  hasAutomaticTransition,
  edgesFrom,
  stageByKey,
  WRITTEN_STATUSES,
  FORWARD_TERMINAL,
} from '@exsto/legal'

describe('equality invariant: automatic edges == the engine’s one auto transition', () => {
  it('auto route ⇒ exactly one automatic edge: consulted → in_review', () => {
    for (const bookingEnabled of [true, false]) {
      const lc = deriveLifecycleFromService({ route: 'auto', bookingEnabled })
      expect(automaticEdges(lc)).toEqual([{ from: 'consulted', to: 'in_review' }])
      expect(hasAutomaticTransition(lc, 'consulted')).toBe(true)
    }
  })

  it('manual route ⇒ NO automatic edges (matches `route !== "auto"` → return)', () => {
    for (const bookingEnabled of [true, false]) {
      const lc = deriveLifecycleFromService({ route: 'manual', bookingEnabled })
      expect(automaticEdges(lc)).toEqual([])
      // The drafting transition still exists, but it is attorney-gated, not automatic.
      const draftingEdge = edgesFrom(lc, 'consulted').find((e) => e.to === 'in_review')
      expect(draftingEdge?.gate).toBe('attorney')
    }
  })
})

describe('vocabulary faithfulness: only real statuses appear', () => {
  const allowed = new Set<string>([...WRITTEN_STATUSES, FORWARD_TERMINAL])

  it('every stage key is a status handlers actually write (+ the forward terminal)', () => {
    for (const v of [
      { route: 'auto', bookingEnabled: true },
      { route: 'manual', bookingEnabled: false },
    ] as const) {
      const lc = deriveLifecycleFromService(v)
      for (const s of lc) expect(allowed.has(s.key)).toBe(true)
    }
  })

  it('the core happy-path statuses are all present', () => {
    const lc = deriveLifecycleFromService({ route: 'auto', bookingEnabled: false })
    const keys = lc.map((s) => s.key)
    for (const k of ['inquiry', 'intake_submitted', 'consulted', 'in_review', 'approved']) {
      expect(keys).toContain(k)
    }
  })
})

describe('handler-faithful gates on the human transitions', () => {
  const lc = deriveLifecycleFromService({ route: 'auto', bookingEnabled: true })

  it('in_review → approved is attorney-gated via draft.approve (matches handler)', () => {
    expect(edgesFrom(lc, 'in_review')).toContainEqual({
      to: 'approved',
      gate: 'attorney',
      via: 'draft.approve',
    })
  })

  it('inquiry → intake_submitted is client-gated via matter.open', () => {
    expect(edgesFrom(lc, 'inquiry')).toContainEqual({
      to: 'intake_submitted',
      gate: 'client',
      via: 'matter.open',
    })
  })

  it('approved rests (its only edge is non-automatic, so a matter stops here like today)', () => {
    expect(hasAutomaticTransition(lc, 'approved')).toBe(false)
  })
})

describe('booking branch toggles with the service', () => {
  it('booking enabled ⇒ consultation_booked + consultation_cancelled stages exist', () => {
    const lc = deriveLifecycleFromService({ route: 'auto', bookingEnabled: true })
    expect(stageByKey(lc, 'consultation_booked')).not.toBeNull()
    expect(stageByKey(lc, 'consultation_cancelled')).not.toBeNull()
  })

  it('booking disabled ⇒ those stages are absent (no dead branch)', () => {
    const lc = deriveLifecycleFromService({ route: 'auto', bookingEnabled: false })
    expect(stageByKey(lc, 'consultation_booked')).toBeNull()
    expect(stageByKey(lc, 'consultation_cancelled')).toBeNull()
  })
})
