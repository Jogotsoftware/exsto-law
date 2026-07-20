// WP B3 — client WEBSITE field (founder-approved CRM comp parity). This module
// holds the one bit of PURE decision logic the create/update handlers
// (handlers/client.ts) share: what to do with a website input. Kept here
// (rather than inline in the handler) so it is unit-testable without a DB —
// handlers/*.ts are registered as side effects and intentionally not part of
// the package's public surface (see index.ts), but api/*.ts is.

export type WebsiteAttrOp = { op: 'skip' } | { op: 'set'; value: string } | { op: 'clear' }

/**
 * Mirrors client.ts's existing optional-field convention (billable_rate,
 * billing_type, ...): trim, and an absent field is always a no-op ("skip").
 * The difference is what an explicitly-blank value means:
 *   - On CREATE (`allowClear: false`) a blank value is also a no-op — there is
 *     nothing to clear yet.
 *   - On UPDATE (`allowClear: true`) a blank value is an explicit CLEAR — the
 *     same "set the attribute to empty" convention client.ts's update handler
 *     already uses for billable_rate/billing_type.
 */
export function resolveWebsiteOp(
  raw: string | null | undefined,
  allowClear: boolean,
): WebsiteAttrOp {
  if (raw == null) return { op: 'skip' }
  const trimmed = raw.trim()
  if (trimmed === '') return allowClear ? { op: 'clear' } : { op: 'skip' }
  return { op: 'set', value: trimmed }
}
