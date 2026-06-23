// Invoice payment lifecycle through the REAL action layer (live DB; gated on
// migration 0090 being applied — invoice.pay action + invoice.paid event kind):
//   • issuing an invoice for a document fee, then payInvoice marks it paid
//     (invoice_status='paid'),
//   • the invoice.paid event names the matter as a secondary entity (so a
//     matter-scoped timeline can see it), and
//   • paying again is rejected (idempotent guard), as is paying a missing invoice.
//
// Tagged: the seeded fee carries a unique tag so assertions ignore other data.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { addMatterFee, issueInvoice, payInvoice, getInvoice, listUnbilled } from '@exsto/legal'
import { closeDbPool, getDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
// The seeded demo matter (Pine Hollow Roasters), stable across the dev DB.
const MATTER = 'ee4a824f-0742-4f2b-af16-55fc62f1f107'

async function matterUnbilled(ctx: ActionContext) {
  const { clients } = await listUnbilled(ctx)
  for (const c of clients)
    for (const m of c.matters)
      if (m.matterEntityId === MATTER)
        return { entries: m.entries, clientEntityId: c.clientEntityId }
  return { entries: [], clientEntityId: null }
}

run('invoice payment lifecycle (live DB)', { timeout: 90_000 }, () => {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
  const tag = `vitest-paid-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('issues, marks paid, and rejects a second payment', async () => {
    // 1) Seed one billable document fee and issue an invoice that includes it.
    const fee = await addMatterFee(ctx, {
      matterEntityId: MATTER,
      feeType: 'document',
      amount: '321.00',
      description: `${tag} doc fee`,
    })
    const { entries, clientEntityId } = await matterUnbilled(ctx)
    expect(clientEntityId).toBeTruthy()
    const line = entries.find((e) => e.sourceEventId === fee.eventId)
    expect(line?.kind).toBe('document_fee')

    const issued = await issueInvoice(ctx, {
      clientEntityId: clientEntityId!,
      lines: [{ sourceEventId: fee.eventId, kind: 'document_fee' }],
    })
    expect(issued.invoiceEntityId).toBeTruthy()

    // Pre-payment status is issued.
    const before = await getInvoice(ctx, issued.invoiceEntityId)
    expect(before?.status).toBe('issued')

    // 2) Mark it paid.
    const paid = await payInvoice(ctx, {
      invoiceEntityId: issued.invoiceEntityId,
      method: 'manual',
    })
    expect(paid.paid).toBe(true)
    expect(paid.status).toBe('paid')

    const after = await getInvoice(ctx, issued.invoiceEntityId)
    expect(after?.status).toBe('paid')

    // 3) The invoice.paid event names the matter as a secondary entity.
    const pool = await getDbPool()
    const client = await pool.connect()
    let sawMatter = false
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT])
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM event e
           JOIN event_kind_definition k ON k.id = e.event_kind_id
          WHERE e.tenant_id = $1 AND k.kind_name = 'invoice.paid'
            AND e.primary_entity_id = $2::uuid
            AND $3::uuid = ANY(e.secondary_entity_ids)`,
        [TENANT, issued.invoiceEntityId, MATTER],
      )
      sawMatter = Number(r.rows[0]?.n ?? '0') > 0
    } finally {
      client.release()
    }
    expect(sawMatter).toBe(true)

    // 4) Paying again is rejected.
    await expect(
      payInvoice(ctx, { invoiceEntityId: issued.invoiceEntityId, method: 'manual' }),
    ).rejects.toThrow(/already/i)
  })

  it('rejects paying a non-existent invoice', async () => {
    await expect(
      payInvoice(ctx, { invoiceEntityId: '00000000-0000-0000-0000-0000000000ff' }),
    ).rejects.toThrow(/not found/i)
  })
})
