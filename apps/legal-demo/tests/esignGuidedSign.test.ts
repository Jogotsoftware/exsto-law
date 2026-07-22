// ESIGN-GUIDED-1 — pure logic tests for the guided click-to-sign walk, pinned
// against apps/legal-demo/lib/esignGuidedSign.ts. Mirrors esignStepFooter's
// pattern: exercise the pure predicate directly, no rendering.
import { describe, expect, it } from 'vitest'
import type { FieldPlacement } from '@exsto/legal/esign'
import {
  guidedCtaLabel,
  guidedFieldsOf,
  guidedProgress,
  guidedProgressLabel,
  isGuidedField,
  isPlacementFilled,
  nextIncompleteField,
  orderGuidedFields,
} from '../lib/esignGuidedSign'

function placement(
  overrides: Partial<FieldPlacement> & Pick<FieldPlacement, 'id' | 'type'>,
): FieldPlacement {
  return {
    signerKey: 's1',
    required: true,
    source: 'placed',
    rect: { page: 0, x: 0, y: 0, w: 0.2, h: 0.05 },
    ...overrides,
  }
}

describe('orderGuidedFields — reading order across a multi-document envelope', () => {
  it('sorts by document, then page, then top-to-bottom, then left-to-right', () => {
    const fields = [
      placement({
        id: 'doc1-p0-y-high',
        type: 'text',
        docIndex: 1,
        rect: { page: 0, x: 0, y: 0.5, w: 0.1, h: 0.05 },
      }),
      placement({
        id: 'doc0-p1-first',
        type: 'text',
        docIndex: 0,
        rect: { page: 1, x: 0, y: 0, w: 0.1, h: 0.05 },
      }),
      placement({
        id: 'doc0-p0-right',
        type: 'text',
        docIndex: 0,
        rect: { page: 0, x: 0.6, y: 0.1, w: 0.1, h: 0.05 },
      }),
      placement({
        id: 'doc0-p0-left',
        type: 'text',
        docIndex: 0,
        rect: { page: 0, x: 0.1, y: 0.1, w: 0.1, h: 0.05 },
      }),
      placement({
        id: 'doc1-p0-y-low',
        type: 'text',
        docIndex: 1,
        rect: { page: 0, x: 0, y: 0.1, w: 0.1, h: 0.05 },
      }),
    ]
    const ordered = orderGuidedFields(fields).map((f) => f.id)
    expect(ordered).toEqual([
      'doc0-p0-left',
      'doc0-p0-right',
      'doc0-p1-first',
      'doc1-p0-y-low',
      'doc1-p0-y-high',
    ])
  })

  it('treats an absent docIndex as document 0 — byte-compatible with pre-multidoc envelopes', () => {
    const fields = [
      placement({
        id: 'explicit-0',
        type: 'text',
        docIndex: 0,
        rect: { page: 0, x: 0, y: 0, w: 0.1, h: 0.05 },
      }),
      placement({
        id: 'implicit-0',
        type: 'text',
        rect: { page: 0, x: 0, y: 0.2, w: 0.1, h: 0.05 },
      }),
    ]
    expect(orderGuidedFields(fields).map((f) => f.id)).toEqual(['explicit-0', 'implicit-0'])
  })
})

describe('isGuidedField — what the signer walks through', () => {
  it('sign, initial, and signer-fillable data fields are guided', () => {
    for (const type of [
      'sign',
      'initial',
      'text',
      'title',
      'email',
      'company',
      'phone',
      'address',
      'check',
    ] as const) {
      expect(isGuidedField(placement({ id: `f-${type}`, type }))).toBe(true)
    }
  })

  it('date and name always auto-derive — never guided, regardless of value', () => {
    expect(isGuidedField(placement({ id: 'd1', type: 'date' }))).toBe(false)
    expect(isGuidedField(placement({ id: 'n1', type: 'name' }))).toBe(false)
  })

  it('a placement resolved at send time (has a value) is inert, not guided', () => {
    expect(isGuidedField(placement({ id: 'e1', type: 'email', value: 'joe@example.com' }))).toBe(
      false,
    )
  })

  it('a value that is only whitespace does not count as resolved', () => {
    expect(isGuidedField(placement({ id: 'e2', type: 'email', value: '   ' }))).toBe(true)
  })
})

describe('isPlacementFilled', () => {
  const emptyCtx = { fieldValues: {}, appliedIds: new Set<string>() }

  it('sign/initial are filled only once applied (click-to-apply — never merely "adopted")', () => {
    const sign = placement({ id: 'sig1', type: 'sign' })
    expect(isPlacementFilled(sign, emptyCtx)).toBe(false)
    expect(isPlacementFilled(sign, { ...emptyCtx, appliedIds: new Set(['sig1']) })).toBe(true)
  })

  it('check is filled only when explicitly checked ("true")', () => {
    const check = placement({ id: 'c1', type: 'check' })
    expect(isPlacementFilled(check, emptyCtx)).toBe(false)
    expect(isPlacementFilled(check, { ...emptyCtx, fieldValues: { c1: '' } })).toBe(false)
    expect(isPlacementFilled(check, { ...emptyCtx, fieldValues: { c1: 'true' } })).toBe(true)
  })

  it('text-ish fields are filled once a non-blank value is typed', () => {
    const text = placement({ id: 't1', type: 'text' })
    expect(isPlacementFilled(text, { ...emptyCtx, fieldValues: { t1: '  ' } })).toBe(false)
    expect(isPlacementFilled(text, { ...emptyCtx, fieldValues: { t1: 'Acme LLC' } })).toBe(true)
  })

  it('a resolved value (send-time auto-fill) always reads filled', () => {
    const resolved = placement({ id: 'r1', type: 'company', value: 'Acme LLC' })
    expect(isPlacementFilled(resolved, emptyCtx)).toBe(true)
  })
})

describe('nextIncompleteField', () => {
  const fields = [
    placement({ id: 'p0', type: 'sign', rect: { page: 0, x: 0, y: 0, w: 0.2, h: 0.05 } }),
    placement({ id: 'p1', type: 'text', rect: { page: 0, x: 0, y: 0.1, w: 0.2, h: 0.05 } }),
    placement({ id: 'p2', type: 'initial', rect: { page: 0, x: 0, y: 0.2, w: 0.2, h: 0.05 } }),
  ]

  it('with no afterId, starts from the first field ("Start")', () => {
    const ctx = { fieldValues: {}, appliedIds: new Set<string>() }
    expect(nextIncompleteField(fields, ctx)?.id).toBe('p0')
  })

  it('skips a field already applied and returns the next incomplete one ("Next")', () => {
    const ctx = { fieldValues: {}, appliedIds: new Set(['p0']) }
    expect(nextIncompleteField(fields, ctx, 'p0')?.id).toBe('p1')
  })

  it('advancing past the last field wraps around to an earlier incomplete field', () => {
    const ctx = { fieldValues: { p1: 'filled' }, appliedIds: new Set(['p0']) }
    // p2 (initial) is still incomplete; asking after p1 should wrap forward to it.
    expect(nextIncompleteField(fields, ctx, 'p1')?.id).toBe('p2')
  })

  it('returns null once every field is complete', () => {
    const ctx = { fieldValues: { p1: 'filled' }, appliedIds: new Set(['p0', 'p2']) }
    expect(nextIncompleteField(fields, ctx, 'p2')).toBeNull()
  })

  it('returns null for an empty field list', () => {
    expect(nextIncompleteField([], { fieldValues: {}, appliedIds: new Set() })).toBeNull()
  })
})

describe('guidedFieldsOf — end-to-end filter + order', () => {
  it('drops date/name/resolved placements and orders the rest', () => {
    const placements = [
      placement({ id: 'date1', type: 'date', rect: { page: 0, x: 0, y: 0, w: 0.1, h: 0.05 } }),
      placement({ id: 'name1', type: 'name', rect: { page: 0, x: 0, y: 0.05, w: 0.1, h: 0.05 } }),
      placement({
        id: 'resolved',
        type: 'email',
        value: 'a@b.com',
        rect: { page: 0, x: 0, y: 0.1, w: 0.1, h: 0.05 },
      }),
      placement({ id: 'sign1', type: 'sign', rect: { page: 0, x: 0, y: 0.2, w: 0.1, h: 0.05 } }),
      placement({ id: 'text1', type: 'text', rect: { page: 0, x: 0, y: 0.15, w: 0.1, h: 0.05 } }),
    ]
    expect(guidedFieldsOf(placements).map((f) => f.id)).toEqual(['text1', 'sign1'])
  })
})

describe('guidedProgress + guidedProgressLabel', () => {
  it('counts only required guided fields', () => {
    const fields = [
      placement({ id: 'req1', type: 'sign', required: true }),
      placement({ id: 'req2', type: 'text', required: true }),
      placement({ id: 'opt1', type: 'text', required: false }),
    ]
    const ctx = { fieldValues: { req2: 'x' }, appliedIds: new Set<string>() }
    expect(guidedProgress(fields, ctx)).toEqual({ completed: 1, total: 2 })
    expect(guidedProgressLabel({ completed: 1, total: 2 })).toBe('1 of 2 required fields complete')
  })

  it('handles the singular case', () => {
    expect(guidedProgressLabel({ completed: 0, total: 1 })).toBe('0 of 1 required field complete')
  })

  it('reads as ready-to-finish when there are no required guided fields', () => {
    expect(guidedProgress([], { fieldValues: {}, appliedIds: new Set() })).toEqual({
      completed: 0,
      total: 0,
    })
    expect(guidedProgressLabel({ completed: 0, total: 0 })).toBe(
      'No required fields — ready to finish',
    )
  })
})

describe('guidedCtaLabel — Start → Next → Finish', () => {
  it('reads Start before the walk begins', () => {
    expect(guidedCtaLabel(false, false)).toBe('Start')
  })
  it('reads Next once started with fields remaining', () => {
    expect(guidedCtaLabel(true, false)).toBe('Next')
  })
  it('reads Finish once every required field is complete, started or not', () => {
    expect(guidedCtaLabel(true, true)).toBe('Finish')
    expect(guidedCtaLabel(false, true)).toBe('Finish')
  })
})
