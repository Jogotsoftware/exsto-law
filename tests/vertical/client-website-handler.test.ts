// WP B3 — client website field: the trim/skip/clear decision handlers/client.ts's
// create and update handlers share (resolveWebsiteOp, exported from
// api/clientWebsite.ts precisely so this is testable without a DB). Mirrors
// client.ts's existing optional-field convention for billable_rate/
// billing_type: CREATE only writes a truthy value; UPDATE also accepts an
// explicit blank as a clear. The DB-touching half — trySetClientAttr's
// tolerant "client_website kind not found yet" degrade (migration 0172 is
// PLANNED, not applied) — is a thin wrapper around this and is exercised for
// real once the invariant suite runs against a DB with the migration applied;
// this file pins the decidable, DB-free half.
import { describe, expect, it } from 'vitest'
import { resolveWebsiteOp } from '@exsto/legal'

describe('resolveWebsiteOp', () => {
  it('skips when the field is absent, regardless of allowClear', () => {
    expect(resolveWebsiteOp(undefined, false)).toEqual({ op: 'skip' })
    expect(resolveWebsiteOp(undefined, true)).toEqual({ op: 'skip' })
  })

  it('skips when the field is explicitly null, regardless of allowClear', () => {
    expect(resolveWebsiteOp(null, false)).toEqual({ op: 'skip' })
    expect(resolveWebsiteOp(null, true)).toEqual({ op: 'skip' })
  })

  it('trims a set value', () => {
    expect(resolveWebsiteOp('  acme.com  ', false)).toEqual({ op: 'set', value: 'acme.com' })
    expect(resolveWebsiteOp('  acme.com  ', true)).toEqual({ op: 'set', value: 'acme.com' })
  })

  it('CREATE (allowClear=false): a blank/whitespace-only value is a no-op, not a clear', () => {
    expect(resolveWebsiteOp('', false)).toEqual({ op: 'skip' })
    expect(resolveWebsiteOp('   ', false)).toEqual({ op: 'skip' })
  })

  it('UPDATE (allowClear=true): a blank/whitespace-only value is an explicit clear', () => {
    expect(resolveWebsiteOp('', true)).toEqual({ op: 'clear' })
    expect(resolveWebsiteOp('   ', true)).toEqual({ op: 'clear' })
  })

  it("does not validate URL/domain shape — that is the brief-research guard's job, not the handler's", () => {
    // The handler stores whatever the attorney typed; briefResearchGuard.ts's
    // normalizeWebsite (extractPublicIdentifiers) is the one place junk is
    // ever filtered, and only for the outbound-research path.
    expect(resolveWebsiteOp('not a url at all', false)).toEqual({
      op: 'set',
      value: 'not a url at all',
    })
  })
})
