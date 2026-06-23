// ADR 0045 PR2 — PURE unit tests (no DB, always run) for the lifecycle resolver and
// structural validity rules. These guard the engine the editor (PR4) and the
// status-advance guard (PR3) will rely on.
import { describe, it, expect } from 'vitest'
import {
  deriveLifecycleFromService,
  validateLifecycle,
  stageByKey,
  entryStage,
  edgesFrom,
  allowedTransitions,
  type Lifecycle,
} from '@exsto/legal'

const VARIANTS = [
  { route: 'auto', bookingEnabled: true },
  { route: 'auto', bookingEnabled: false },
  { route: 'manual', bookingEnabled: true },
  { route: 'manual', bookingEnabled: false },
] as const

describe('validateLifecycle — derived graphs are valid', () => {
  for (const v of VARIANTS) {
    it(`derived lifecycle is valid for route=${v.route} booking=${v.bookingEnabled}`, () => {
      const lc = deriveLifecycleFromService(v)
      const res = validateLifecycle(lc)
      expect(res.errors).toEqual([])
      expect(res.ok).toBe(true)
    })
  }
})

describe('validateLifecycle — catches malformed graphs', () => {
  it('rejects an empty graph', () => {
    expect(validateLifecycle([]).ok).toBe(false)
  })

  it('rejects no entry stage', () => {
    const lc: Lifecycle = [
      { key: 'a', label: 'A', advances_to: [{ to: 'b', gate: 'attorney' }] },
      { key: 'b', label: 'B', terminal: true, advances_to: [] },
    ]
    expect(validateLifecycle(lc).errors.join(' ')).toMatch(/exactly one entry/)
  })

  it('rejects two entry stages', () => {
    const lc: Lifecycle = [
      { key: 'a', label: 'A', entry: true, advances_to: [{ to: 'b', gate: 'attorney' }] },
      { key: 'b', label: 'B', entry: true, terminal: true, advances_to: [] },
    ]
    expect(validateLifecycle(lc).errors.join(' ')).toMatch(/exactly one entry/)
  })

  it('rejects no terminal stage', () => {
    const lc: Lifecycle = [
      { key: 'a', label: 'A', entry: true, advances_to: [{ to: 'b', gate: 'attorney' }] },
      { key: 'b', label: 'B', advances_to: [{ to: 'a', gate: 'attorney' }] },
    ]
    expect(validateLifecycle(lc).errors.join(' ')).toMatch(/terminal/)
  })

  it('rejects an edge to an unknown stage', () => {
    const lc: Lifecycle = [
      { key: 'a', label: 'A', entry: true, advances_to: [{ to: 'ghost', gate: 'attorney' }] },
      { key: 'b', label: 'B', terminal: true, advances_to: [] },
    ]
    const errs = validateLifecycle(lc).errors.join(' ')
    expect(errs).toMatch(/unknown stage "ghost"/)
  })

  it('rejects an invalid gate kind', () => {
    const lc = [
      { key: 'a', label: 'A', entry: true, advances_to: [{ to: 'b', gate: 'magic' }] },
      { key: 'b', label: 'B', terminal: true, advances_to: [] },
    ] as unknown as Lifecycle
    expect(validateLifecycle(lc).errors.join(' ')).toMatch(/invalid gate/)
  })

  it('rejects a terminal stage with outgoing edges', () => {
    const lc: Lifecycle = [
      { key: 'a', label: 'A', entry: true, advances_to: [{ to: 'b', gate: 'attorney' }] },
      { key: 'b', label: 'B', terminal: true, advances_to: [{ to: 'a', gate: 'attorney' }] },
    ]
    expect(validateLifecycle(lc).errors.join(' ')).toMatch(
      /terminal stage "b" must have no outgoing/,
    )
  })

  it('rejects an unreachable stage', () => {
    const lc: Lifecycle = [
      { key: 'a', label: 'A', entry: true, advances_to: [{ to: 'b', gate: 'attorney' }] },
      { key: 'b', label: 'B', terminal: true, advances_to: [] },
      { key: 'orphan', label: 'Orphan', advances_to: [{ to: 'b', gate: 'attorney' }] },
    ]
    expect(validateLifecycle(lc).errors.join(' ')).toMatch(/"orphan" is unreachable/)
  })
})

describe('resolver helpers', () => {
  const lc = deriveLifecycleFromService({ route: 'auto', bookingEnabled: true })

  it('entryStage is inquiry', () => {
    expect(entryStage(lc)?.key).toBe('inquiry')
  })

  it('stageByKey finds and misses correctly', () => {
    expect(stageByKey(lc, 'in_review')?.label).toBe('Attorney review')
    expect(stageByKey(lc, 'nope')).toBeNull()
  })

  it('edgesFrom returns the outgoing edges', () => {
    expect(edgesFrom(lc, 'in_review')).toEqual([
      { to: 'approved', gate: 'attorney', via: 'draft.approve' },
    ])
  })

  it('allowedTransitions filters by gate', () => {
    // From intake_submitted only the client edges are allowed for a client actor.
    const clientEdges = allowedTransitions(lc, 'intake_submitted', ['client'])
    expect(clientEdges.every((e) => e.gate === 'client')).toBe(true)
    expect(clientEdges.length).toBeGreaterThan(0)
    // The worker (automatic only) has nothing to do from intake_submitted.
    expect(allowedTransitions(lc, 'intake_submitted', ['automatic'])).toEqual([])
  })
})
