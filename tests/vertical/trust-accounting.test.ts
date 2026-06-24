// Trust (IOLTA) accounting through the REAL action layer (live DB; gated on
// migration 0110 — the trust.* kinds). Proves the compliance guardrails:
//   • a deposit raises the client's trust balance,
//   • a disbursement beyond the balance is REJECTED (no overdraft),
//   • applying trust to an issued invoice atomically pays it (method=trust) and
//     reduces the client's balance,
//   • the reconciliation read reports the client's balance with no break.
//
// Self-seeding: creates its own tagged client + matter (intake.submit →
// matter.open), so it never touches real client data.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  addMatterFee,
  issueInvoice,
  getInvoice,
  listUnbilled,
  depositToTrust,
  disburseFromTrust,
  applyTrustToInvoice,
  getClientTrustBalance,
  getTrustReconciliation,
} from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'

run('trust (IOLTA) accounting (live DB)', { timeout: 120_000 }, () => {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
  const intakeCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }
  const tag = `vitest-trust-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('deposits, blocks overdraft, pays an invoice from trust, and reconciles', async () => {
    // 0) Seed our own client + matter.
    const intake = await submitAction(intakeCtx, {
      actionKindName: 'intake.submit',
      intentKind: 'enforcement',
      payload: {
        client_full_name: `${tag} Trust Test`,
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

    // Resolve the billable CLIENT (parent) via a seeded fee + the unbilled feed.
    const fee = await addMatterFee(ctx, {
      matterEntityId: matterId,
      feeType: 'document',
      amount: '321.00',
      description: `${tag} doc fee`,
    })
    let clientEntityId: string | null = null
    const { clients } = await listUnbilled(ctx)
    for (const c of clients)
      if (c.matters.some((m) => m.matterEntityId === matterId)) clientEntityId = c.clientEntityId
    expect(clientEntityId, 'matter should be under a billable client').toBeTruthy()
    const clientId = clientEntityId!

    // 1) Deposit a $1,000 retainer.
    const dep = await depositToTrust(ctx, {
      clientEntityId: clientId,
      amount: '1000.00',
      source: 'retainer',
    })
    expect(dep.balance).toBe('1000.00')

    // 2) Overdraft is blocked.
    await expect(
      disburseFromTrust(ctx, {
        clientEntityId: clientId,
        amount: '1500.00',
        reason: `${tag} too much`,
      }),
    ).rejects.toThrow(/overdraft/i)

    // 3) A valid disbursement reduces the balance.
    const dis = await disburseFromTrust(ctx, {
      clientEntityId: clientId,
      amount: '200.00',
      reason: `${tag} filing fee`,
    })
    expect(dis.balance).toBe('800.00')

    // 4) Issue an invoice and pay it FROM trust (atomic).
    const issued = await issueInvoice(ctx, {
      clientEntityId: clientId,
      lines: [{ sourceEventId: fee.eventId, kind: 'document_fee' }],
    })
    const applied = await applyTrustToInvoice(ctx, { invoiceEntityId: issued.invoiceEntityId })
    expect(applied.applied).toBe('321.00')
    expect(applied.balance).toBe('479.00') // 800 − 321

    const inv = await getInvoice(ctx, issued.invoiceEntityId)
    expect(inv?.status).toBe('paid')

    const bal = await getClientTrustBalance(ctx, clientId)
    expect(bal.balance).toBe('479.00')

    // 5) Can't pay an already-paid invoice again.
    await expect(
      applyTrustToInvoice(ctx, { invoiceEntityId: issued.invoiceEntityId }),
    ).rejects.toThrow(/already paid/i)

    // 6) Reconciliation reports this client's balance, with no break against it.
    const recon = await getTrustReconciliation(ctx)
    const mine = recon.clients.find((c) => c.clientEntityId === clientId)
    expect(mine?.balance).toBe('479.00')
    expect(recon.breaks.some((b) => b.clientEntityId === clientId)).toBe(false)
  })
})
