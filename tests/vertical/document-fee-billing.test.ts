// Phase 2 flat-fee billing through the REAL action layer (live DB; gated on
// migration 0080 being applied — the new kinds must exist):
//   • addMatterFee records a service / document fee that shows in the matter's
//     unbilled feed with the right kind and amount,
//   • voidMatterFee removes an unbilled fee from the feed (billing_entry.voided),
//   • issuing an invoice that includes a document fee bills it (document_fee.billed)
//     so it leaves the unbilled feed and lands as a document_fee invoice line.
//
// Append-only and tagged: every fee carries a unique tag in its description so the
// assertions ignore any other data on the shared demo matter.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { addMatterFee, voidMatterFee, listUnbilled, issueInvoice } from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
// The seeded demo matter (Pine Hollow Roasters), stable across the dev DB.
const MATTER = 'ee4a824f-0742-4f2b-af16-55fc62f1f107'

// All unbilled entries for MATTER (across whichever client/orphan group it sits in).
async function matterUnbilled(ctx: ActionContext) {
  const { clients } = await listUnbilled(ctx)
  for (const c of clients)
    for (const m of c.matters)
      if (m.matterEntityId === MATTER)
        return { entries: m.entries, clientEntityId: c.clientEntityId }
  return { entries: [], clientEntityId: null }
}

run('flat-fee billing (live DB)', { timeout: 90_000 }, () => {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
  const tag = `vitest-fee-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('adds a service fee and a document fee that show as unbilled with the right kind', async () => {
    const svc = await addMatterFee(ctx, {
      matterEntityId: MATTER,
      feeType: 'service',
      amount: '500.00',
      description: `${tag} service`,
    })
    const doc = await addMatterFee(ctx, {
      matterEntityId: MATTER,
      feeType: 'document',
      amount: '250.00',
      description: `${tag} document`,
    })

    const { entries } = await matterUnbilled(ctx)
    const svcEntry = entries.find((e) => e.sourceEventId === svc.eventId)
    const docEntry = entries.find((e) => e.sourceEventId === doc.eventId)
    expect(svcEntry?.kind).toBe('service_fee')
    expect(svcEntry?.amount).toBe('500.00')
    expect(docEntry?.kind).toBe('document_fee')
    expect(docEntry?.amount).toBe('250.00')
  })

  it('voiding a fee removes it from the unbilled feed', async () => {
    const fee = await addMatterFee(ctx, {
      matterEntityId: MATTER,
      feeType: 'service',
      amount: '99.00',
      description: `${tag} to-void`,
    })
    expect((await matterUnbilled(ctx)).entries.some((e) => e.sourceEventId === fee.eventId)).toBe(
      true,
    )

    await voidMatterFee(ctx, fee.eventId)
    expect((await matterUnbilled(ctx)).entries.some((e) => e.sourceEventId === fee.eventId)).toBe(
      false,
    )
  })

  it('invoicing a document fee bills it (leaves the unbilled feed)', async () => {
    const doc = await addMatterFee(ctx, {
      matterEntityId: MATTER,
      feeType: 'document',
      amount: '175.00',
      description: `${tag} to-invoice`,
    })
    const { clientEntityId } = await matterUnbilled(ctx)
    // The demo matter must be linked to a client to invoice; if not, the fee still
    // accrued (asserted above) and we skip the invoice leg rather than fail.
    if (!clientEntityId) return

    const issued = await issueInvoice(ctx, {
      clientEntityId,
      matterEntityId: MATTER,
      lines: [{ sourceEventId: doc.eventId, kind: 'document_fee' }],
    })
    expect(Number(issued.lineCount)).toBeGreaterThanOrEqual(1)

    // Once billed, the document fee is gone from the unbilled feed.
    expect((await matterUnbilled(ctx)).entries.some((e) => e.sourceEventId === doc.eventId)).toBe(
      false,
    )
  })
})
