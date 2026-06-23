// Invoice payment lifecycle through the REAL action layer (live DB; gated on
// migration 0090 — invoice.pay action + invoice.paid event kind):
//   • issuing an invoice for a document fee, then payInvoice marks it paid
//     (invoice_status='paid'),
//   • the invoice.paid event names the matter as a secondary entity (so a
//     matter-scoped timeline can see it), and
//   • paying again is rejected (idempotent guard), as is paying a missing invoice.
//
// Self-seeding: the test creates its OWN tagged client + matter via intake.submit
// → matter.open (the same pattern billing-firm-rate.test.ts uses), so it never
// touches real client data and is portable across DBs.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { addMatterFee, issueInvoice, payInvoice, getInvoice, listUnbilled } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { closeDbPool, getDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'

run('invoice payment lifecycle (live DB)', { timeout: 120_000 }, () => {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
  const intakeCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }
  const tag = `vitest-paid-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('issues, marks paid, names the matter, and rejects a second payment', async () => {
    // 0) Seed our own client + matter (tagged, isolated from real data).
    const intake = await submitAction(intakeCtx, {
      actionKindName: 'intake.submit',
      intentKind: 'enforcement',
      payload: {
        client_full_name: `${tag} Pay Test`,
        client_email: `${tag}@pilot.test`,
        client_phone: null,
        client_company_name: `${tag} Co`,
        service_key: 'nc_llc_single_member',
        intake_form_id: null,
        intake_responses: {},
      },
    })
    const { clientEntityId: contactId, questionnaireEntityId } = intake.effects[0] as {
      clientEntityId: string
      questionnaireEntityId: string
    }
    const opened = await submitAction(intakeCtx, {
      actionKindName: 'matter.open',
      intentKind: 'enforcement',
      payload: {
        service_key: 'nc_llc_single_member',
        workflow_route: 'manual',
        client_entity_id: contactId,
        questionnaire_entity_id: questionnaireEntityId,
        client_display_name: `${tag} Co`,
      },
    })
    const matterId = (opened.effects[0] as { matterEntityId: string }).matterEntityId

    // 1) Add one billable document fee and issue an invoice that includes it.
    const fee = await addMatterFee(ctx, {
      matterEntityId: matterId,
      feeType: 'document',
      amount: '321.00',
      description: `${tag} doc fee`,
    })
    let clientEntityId: string | null = null
    let line: { kind: string } | undefined
    const { clients } = await listUnbilled(ctx)
    for (const c of clients) {
      const m = c.matters.find((x) => x.matterEntityId === matterId)
      if (m) {
        clientEntityId = c.clientEntityId
        line = m.entries.find((e) => e.sourceEventId === fee.eventId)
      }
    }
    expect(clientEntityId, 'matter should be under a billable client').toBeTruthy()
    expect(line?.kind).toBe('document_fee')

    const issued = await issueInvoice(ctx, {
      clientEntityId: clientEntityId!,
      lines: [{ sourceEventId: fee.eventId, kind: 'document_fee' }],
    })
    expect(issued.invoiceEntityId).toBeTruthy()

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
        [TENANT, issued.invoiceEntityId, matterId],
      )
      sawMatter = Number(r.rows[0]?.n ?? '0') > 0
    } finally {
      client.release()
    }
    expect(sawMatter, 'invoice.paid should name the matter as secondary').toBe(true)

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
