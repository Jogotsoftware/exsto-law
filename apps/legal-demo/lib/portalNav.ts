// PT-1 — client-portal side-nav item model (pure, testable).
//
// The portal's primary nav (the old horizontal tab band, now the side rail)
// shows a fixed set of sections; Assistant appears ONLY for clients whose firm
// enabled the portal assistant (WP-7: no empty/dead nav item). This helper owns
// that gating so the component stays a dumb renderer and the rule is unit-
// testable without a DOM.

export type PortalNavKind =
  | 'home'
  | 'documents'
  | 'invoices'
  | 'signatures'
  | 'assistant'
  | 'settings'

export function portalNavKinds(opts: { assistantEnabled: boolean }): PortalNavKind[] {
  return [
    'home',
    'documents',
    'invoices',
    'signatures',
    ...(opts.assistantEnabled ? (['assistant'] as const) : []),
    'settings',
  ]
}
