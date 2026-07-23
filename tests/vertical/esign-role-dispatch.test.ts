// ESIGN-UNIFY-1 (ES-1) — the role-aware dispatch/completion matrix (design
// §9.2), tested against the PURE planners the esign.send / esign.sign handlers
// execute (verticals/legal/src/esign/routing.ts). No DB needed: the handlers
// delegate every decision here.
import { describe, expect, it } from 'vitest'
import {
  completionRecipients,
  copyRecipients,
  nextInsertionOrder,
  normalizeRole,
  planInitialDispatch,
  planNextDelivery,
  shouldHoldForAddDecision,
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

describe('planInitialDispatch — PRESIGN-1 (pre-signed attorney)', () => {
  it('a pre-signed recipient starts "signed" (applied at send), never delivered', () => {
    expect(planInitialDispatch([{ role: 'needs_to_sign', order: 1, presigned: true }])).toEqual([
      'signed',
    ])
  })

  it('pre-signed attorney at order 1 → the client at order 2 is the first delivered turn', () => {
    expect(
      planInitialDispatch([
        { role: 'needs_to_sign', order: 1, presigned: true }, // attorney (auto)
        { role: 'needs_to_sign', order: 2 }, // client
      ]),
    ).toEqual(['signed', 'delivered'])
  })

  it('excludes the pre-signed signer from the first-group computation (client still delivered)', () => {
    // Attorney presigned at the SAME order as the client — the client must still
    // be delivered, not blocked behind a signer who already signed.
    expect(
      planInitialDispatch([
        { role: 'needs_to_sign', order: 1, presigned: true },
        { role: 'needs_to_sign', order: 1 },
        { role: 'needs_to_view', order: 2 },
      ]),
    ).toEqual(['signed', 'delivered', 'delivered'])
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

describe('nextInsertionOrder — ADD-NEXT-SIGNER-1', () => {
  it('appends at the end when nothing is queued past the anchor', () => {
    expect(nextInsertionOrder([1, 2], 2)).toBe(3)
    expect(nextInsertionOrder([], 1)).toBe(2)
  })

  it('slots between the anchor and the next-queued order', () => {
    // anchor=1, something already queued at order 3 (e.g. attorney countersign)
    // — the new signer goes between them, not after the countersign.
    expect(nextInsertionOrder([1, 3], 1)).toBe(2)
  })

  it('finds the NEAREST later order, not just any later order', () => {
    expect(nextInsertionOrder([1, 2, 5], 1)).toBe(1.5)
  })

  it('repeated insertion at the same anchor keeps halving toward it, never colliding', () => {
    const first = nextInsertionOrder([1, 2], 1) // 1.5
    const second = nextInsertionOrder([1, 1.5, 2], 1) // between 1 and 1.5
    expect(first).toBe(1.5)
    expect(second).toBeGreaterThan(1)
    expect(second).toBeLessThan(first)
  })
})

describe('shouldHoldForAddDecision — ADD-NEXT-SIGNER-1', () => {
  it('holds only when this signature would complete AND the role opted in', () => {
    expect(shouldHoldForAddDecision(true, true)).toBe(true)
  })

  it('never holds a completion the signer did not opt into', () => {
    expect(shouldHoldForAddDecision(false, true)).toBe(false)
  })

  it('never holds when the envelope would not complete anyway (others still pending)', () => {
    expect(shouldHoldForAddDecision(true, false)).toBe(false)
  })
})
