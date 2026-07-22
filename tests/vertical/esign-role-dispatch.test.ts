// ESIGN-UNIFY-1 (ES-1) — the role-aware dispatch/completion matrix (design
// §9.2), tested against the PURE planners the esign.send / esign.sign handlers
// execute (verticals/legal/src/esign/routing.ts). No DB needed: the handlers
// delegate every decision here.
import { describe, expect, it } from 'vitest'
import {
  completionRecipients,
  copyRecipients,
  normalizeRole,
  planInitialDispatch,
  planNextDelivery,
  type RoutingRequestState,
} from '../../verticals/legal/src/esign/routing.js'

function req(
  requestId: string,
  role: RoutingRequestState['role'],
  order: number,
  status: string,
): RoutingRequestState {
  return { requestId, role, order, status }
}

describe('normalizeRole (defensive default)', () => {
  it('reads absent/unknown roles as needs_to_sign — every pre-0186 request', () => {
    expect(normalizeRole(null)).toBe('needs_to_sign')
    expect(normalizeRole(undefined)).toBe('needs_to_sign')
    expect(normalizeRole('')).toBe('needs_to_sign')
    expect(normalizeRole('something_else')).toBe('needs_to_sign')
    expect(normalizeRole('needs_to_view')).toBe('needs_to_view')
    expect(normalizeRole('receives_copy')).toBe('receives_copy')
  })
})

describe('planInitialDispatch — send-time matrix (role × order)', () => {
  it('legacy shape (no roles): first order delivered, later orders pending', () => {
    expect(planInitialDispatch([{ order: 1 }, { order: 2 }, { order: 1 }])).toEqual([
      'delivered',
      'pending',
      'delivered',
    ])
  })

  it('defaults orders 1-based by position when absent (parallel stays all-delivered)', () => {
    expect(planInitialDispatch([{}, {}])).toEqual(['delivered', 'pending'])
    expect(planInitialDispatch([{ order: 1 }, { order: 1 }])).toEqual(['delivered', 'delivered'])
  })

  it('needs_to_view is delivered WITH the first group regardless of its own order', () => {
    expect(
      planInitialDispatch([
        { role: 'needs_to_sign', order: 1 },
        { role: 'needs_to_view', order: 99 },
      ]),
    ).toEqual(['delivered', 'delivered'])
  })

  it('receives_copy is NEVER delivered at send', () => {
    expect(
      planInitialDispatch([
        { role: 'needs_to_sign', order: 1 },
        { role: 'receives_copy', order: 1 },
      ]),
    ).toEqual(['delivered', 'pending'])
  })

  it('viewer/copy orders never define the first signing group', () => {
    // The viewer holds order 1; the first SIGNING order is 2 — the signer at
    // order 2 must still be delivered at send.
    expect(
      planInitialDispatch([
        { role: 'needs_to_view', order: 1 },
        { role: 'needs_to_sign', order: 2 },
        { role: 'needs_to_sign', order: 3 },
      ]),
    ).toEqual(['delivered', 'delivered', 'pending'])
  })

  it('full matrix: sign/view/copy × sequential orders', () => {
    expect(
      planInitialDispatch([
        { role: 'needs_to_sign', order: 2 },
        { role: 'needs_to_sign', order: 1 },
        { role: 'needs_to_view', order: 2 },
        { role: 'receives_copy', order: 1 },
      ]),
    ).toEqual(['pending', 'delivered', 'delivered', 'pending'])
  })
})

describe('planNextDelivery — completion ignores viewers/copy recipients', () => {
  it('completes when every needs_to_sign request signed, viewer still open', () => {
    const plan = planNextDelivery([
      req('a', 'needs_to_sign', 1, 'signed'),
      req('b', 'needs_to_view', 1, 'delivered'),
      req('c', 'receives_copy', 1, 'pending'),
    ])
    expect(plan.completed).toBe(true)
    expect(plan.deliver).toEqual([])
  })

  it('does not complete while a signer is unresolved', () => {
    const plan = planNextDelivery([
      req('a', 'needs_to_sign', 1, 'signed'),
      req('b', 'needs_to_sign', 2, 'pending'),
      req('c', 'needs_to_view', 1, 'opened'),
    ])
    expect(plan.completed).toBe(false)
    expect(plan.deliver).toEqual(['b'])
  })

  it('delivers the whole next parallel group of signers, never viewers', () => {
    const plan = planNextDelivery([
      req('a', 'needs_to_sign', 1, 'signed'),
      req('b', 'needs_to_sign', 2, 'pending'),
      req('c', 'needs_to_sign', 2, 'pending'),
      req('d', 'needs_to_view', 2, 'delivered'),
    ])
    expect(plan.deliver.sort()).toEqual(['b', 'c'])
  })

  it('declined counts as resolved for group advancement', () => {
    const plan = planNextDelivery([
      req('a', 'needs_to_sign', 1, 'declined'),
      req('b', 'needs_to_sign', 2, 'pending'),
    ])
    expect(plan.completed).toBe(false)
    expect(plan.deliver).toEqual(['b'])
  })

  it('an envelope with no signing requests never reports completed', () => {
    const plan = planNextDelivery([
      req('a', 'needs_to_view', 1, 'delivered'),
      req('b', 'receives_copy', 1, 'pending'),
    ])
    expect(plan.completed).toBe(false)
    expect(plan.deliver).toEqual([])
  })
})

describe('copyRecipients', () => {
  it('returns only receives_copy request ids', () => {
    expect(
      copyRecipients([
        req('a', 'needs_to_sign', 1, 'signed'),
        req('b', 'receives_copy', 1, 'pending'),
        req('c', 'needs_to_view', 1, 'delivered'),
        req('d', 'receives_copy', 3, 'pending'),
      ]),
    ).toEqual(['b', 'd'])
  })
})

// esign-executed-copy-complete — every signer AND copy recipient gets the
// executed document once the envelope completes; needs_to_view is excluded
// (they never sign and already got a view link at send).
describe('completionRecipients', () => {
  it('includes needs_to_sign and receives_copy, excludes needs_to_view', () => {
    expect(
      completionRecipients([
        req('a', 'needs_to_sign', 1, 'signed'),
        req('b', 'receives_copy', 1, 'pending'),
        req('c', 'needs_to_view', 1, 'delivered'),
      ]),
    ).toEqual(['a', 'b'])
  })

  it('returns every signer when there are no copy recipients', () => {
    expect(
      completionRecipients([
        req('a', 'needs_to_sign', 1, 'signed'),
        req('b', 'needs_to_sign', 2, 'signed'),
      ]),
    ).toEqual(['a', 'b'])
  })

  it('returns empty for an envelope with only viewers', () => {
    expect(completionRecipients([req('a', 'needs_to_view', 1, 'delivered')])).toEqual([])
  })

  it('preserves input order (not send order — the caller does not re-sort)', () => {
    expect(
      completionRecipients([
        req('b', 'receives_copy', 3, 'pending'),
        req('a', 'needs_to_sign', 1, 'signed'),
      ]),
    ).toEqual(['b', 'a'])
  })
})
