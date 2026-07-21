// PT-1 — portal side-nav item gating (lib/portalNav.ts).
//
// The Assistant section must appear ONLY when the firm enabled the portal
// assistant (WP-7: no empty/dead nav item), and the section order is fixed —
// the side rail renders exactly what this helper emits.
import { describe, expect, it } from 'vitest'
import { portalNavKinds } from '../lib/portalNav'

describe('portalNavKinds', () => {
  it('omits assistant when the firm has not enabled the portal assistant', () => {
    expect(portalNavKinds({ assistantEnabled: false })).toEqual([
      'home',
      'documents',
      'invoices',
      'signatures',
      'settings',
    ])
  })

  it('includes assistant (before settings) when enabled', () => {
    expect(portalNavKinds({ assistantEnabled: true })).toEqual([
      'home',
      'documents',
      'invoices',
      'signatures',
      'assistant',
      'settings',
    ])
  })
})
