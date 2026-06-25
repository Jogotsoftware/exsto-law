// Online payments — the firm connection round-trip through the substrate. Pins
// migration 0113 + the connect/disconnect handlers + the getFirmPaymentStatus
// read: connecting records the account id, refreshing persists the capability
// flags, and disconnecting clears them (append-only, observed_null). DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { getFirmPaymentStatus } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('firm payment status round-trip (live DB)', { timeout: 120_000 }, () => {
  it('connect records the account, refresh persists flags, disconnect clears', async () => {
    const acct = `acct_test_${Date.now()}`

    // Onboarding start: only the account id is known yet.
    await submitAction(ctx, {
      actionKindName: 'legal.firm.connect_stripe',
      intentKind: 'adjustment',
      payload: { account_id: acct },
    })
    let s = await getFirmPaymentStatus(ctx)
    expect(s.connected).toBe(true)
    expect(s.accountId).toBe(acct)
    expect(s.chargesEnabled).toBe(false)

    // Capability refresh (what the return route / account.updated webhook does).
    await submitAction(ctx, {
      actionKindName: 'legal.firm.connect_stripe',
      intentKind: 'adjustment',
      payload: { account_id: acct, charges_enabled: true, details_submitted: true },
    })
    s = await getFirmPaymentStatus(ctx)
    expect(s.chargesEnabled).toBe(true)
    expect(s.detailsSubmitted).toBe(true)

    // Disconnect clears the connection (account id → null, flags → false).
    await submitAction(ctx, {
      actionKindName: 'legal.firm.disconnect_stripe',
      intentKind: 'adjustment',
      payload: {},
    })
    s = await getFirmPaymentStatus(ctx)
    expect(s.connected).toBe(false)
    expect(s.accountId).toBeNull()
    expect(s.chargesEnabled).toBe(false)
  })

  afterAll(async () => {
    await closeDbPool()
  })
})
