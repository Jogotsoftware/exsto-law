// WP A1 + WF-FIX-2 #3 — matter jurisdiction resolver
// (verticals/legal/src/api/matterJurisdiction.ts).
//   resolveJurisdictionChain is PURE (matter beats client address beats firm
//   beats honest null) so the chain logic runs with no DB and no fixtures.
//   resolveMatterJurisdictionWithClient is exercised against a minimal fake
//   DbClient (no live Postgres) to prove the "kind not defined yet / nothing
//   found" case degrades to null instead of throwing — the exact shape a
//   pre-migration read hits (attribute_kind_definition join simply matches zero
//   rows; DB-gated integration coverage against a real Postgres runs in CI only).
import { describe, it, expect } from 'vitest'
import {
  resolveJurisdictionChain,
  resolveMatterJurisdictionWithClient,
} from '../../verticals/legal/src/api/matterJurisdiction.js'
import type { DbClient } from '@exsto/shared'

// A representative client on-file address (state at the standard tail position).
const NC_ADDRESS = '123 Main St, Raleigh, NC 27601'

describe('resolveJurisdictionChain (pure)', () => {
  it('the matter fact wins when all rungs are set (matter beats address beats firm)', () => {
    expect(resolveJurisdictionChain('NC', '500 King St, Wilmington, DE 19801', 'CA')).toEqual({
      code: 'NC',
      displayName: 'North Carolina',
      source: 'matter',
    })
  })

  it('the client address wins over firm when the matter has no fact', () => {
    expect(resolveJurisdictionChain(null, NC_ADDRESS, 'CA')).toEqual({
      code: 'NC',
      displayName: 'North Carolina',
      source: 'client_address',
    })
  })

  it('parses a full state name at the standard position on the address rung', () => {
    expect(resolveJurisdictionChain(null, '77 Peachtree Rd, Atlanta, Georgia 30303', null)).toEqual(
      {
        code: 'GA',
        displayName: 'Georgia',
        source: 'client_address',
      },
    )
  })

  it('falls back to the firm fact when neither matter nor address resolve', () => {
    expect(resolveJurisdictionChain(null, null, 'CA')).toEqual({
      code: 'CA',
      displayName: 'California',
      source: 'firm',
    })
  })

  it('an UNPARSEABLE client address falls through to the firm rung', () => {
    expect(resolveJurisdictionChain(null, '123 Main St', 'TX')).toEqual({
      code: 'TX',
      displayName: 'Texas',
      source: 'firm',
    })
  })

  it('normalizes a legacy display-string matter value (e.g. "North Carolina")', () => {
    expect(resolveJurisdictionChain('North Carolina', null, null)).toEqual({
      code: 'NC',
      displayName: 'North Carolina',
      source: 'matter',
    })
  })

  it('falls through to firm when the matter value does not normalize (garbage)', () => {
    expect(resolveJurisdictionChain('not-a-state', null, 'TX')).toEqual({
      code: 'TX',
      displayName: 'Texas',
      source: 'firm',
    })
  })

  it('returns null when nothing is set (honest unset, no service rung, no guess)', () => {
    expect(resolveJurisdictionChain(null, null, null)).toBeNull()
  })

  it('returns null when no rung resolves (garbage matter + unparseable address + garbage firm)', () => {
    expect(resolveJurisdictionChain('nowhere', '123 Main St', 'also-nowhere')).toBeNull()
  })
})

// A fake DbClient whose .query() ALWAYS resolves with zero rows, regardless of
// the SQL text — simulating both "the firm_jurisdiction attribute kind doesn't
// exist yet" (migration 0170 unapplied) and "nothing was ever set". Neither case
// may throw.
function emptyRowsClient(): DbClient {
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as DbClient
}

describe('resolveMatterJurisdictionWithClient (DB-tolerant, no live DB)', () => {
  it('degrades to null, without throwing, when every read finds nothing', async () => {
    const result = await resolveMatterJurisdictionWithClient(
      emptyRowsClient(),
      'tenant-1',
      'matter-1',
    )
    expect(result).toBeNull()
  })

  it('degrades to null, without throwing, with no matter id at all', async () => {
    const result = await resolveMatterJurisdictionWithClient(emptyRowsClient(), 'tenant-1', null)
    expect(result).toBeNull()
  })
})
