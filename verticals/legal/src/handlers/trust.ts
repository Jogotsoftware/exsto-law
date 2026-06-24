import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertEvent, insertAttribute, lookupKindId, getLatestAttributeValue } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Trust (IOLTA) ledger handlers (migration 0111).
//
// Client funds are held in a POOLED trust account, accounted with a SEPARATE
// sub-ledger per client (NC State Bar minimum). A client's balance is DERIVED
// from the append-only events (trust.deposited / disbursed / transferred_earned
// / refunded) — nothing is stored or mutated; corrections are reversing entries
// (ADR 0039). The ledger is the firm's BOOK of record for trust.
//
// Compliance guardrails enforced HERE (the accounting control points):
//   • a client's trust balance can NEVER go negative — overdrawing one client's
//     trust with another's funds is the cardinal IOLTA violation;
//   • the ONLY path from trust → operating is an explicit EARNED transfer
//     against an issued invoice (no silent commingling);
//   • that transfer is ATOMIC with marking the invoice paid (one transaction),
//     so the books never show a debited client whose invoice is still unpaid.
//
// Money discipline (ADR 0044): decimal strings in, integer-cents arithmetic.
// ───────────────────────────────────────────────────────────────────────────

function amountToCents(amount: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount).trim())
  if (!m) throw new Error(`Invalid amount "${amount}" — use digits like 500 or 500.00.`)
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  // Fail loudly rather than silently lose cents past MAX_SAFE_INTEGER.
  if (!Number.isSafeInteger(cents)) throw new Error('Amount exceeds the safe integer-cents range.')
  return cents
}

// Serialize balance-mutating trust actions per (tenant, client): a second
// concurrent debit BLOCKS here until the first commits, then re-reads the reduced
// balance — closing the read-then-write overdraft race (mirrors booking.ts
// lockSlot). Transaction-scoped; released on COMMIT/ROLLBACK.
async function lockClientTrust(
  client: DbClient,
  tenantId: string,
  clientId: string,
): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 42))`, [
    `${tenantId}|trust|${clientId}`,
  ])
}

// Serialize all payments of one invoice (manual invoice.pay AND pay-from-trust)
// so two concurrent paths can't both mark it paid. invoice.pay takes the same
// lock; transfer_earned takes the client lock first, then this one (consistent
// order → no deadlock).
async function lockInvoicePay(
  client: DbClient,
  tenantId: string,
  invoiceId: string,
): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 42))`, [
    `${tenantId}|invoice_pay|${invoiceId}`,
  ])
}
function centsToAmount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

// Signed direction per trust event kind: a deposit adds to the client's balance;
// every other entry removes from it.
const TRUST_SIGN: Record<string, 1 | -1> = {
  'trust.deposited': 1,
  'trust.disbursed': -1,
  'trust.transferred_earned': -1,
  'trust.refunded': -1,
}
const TRUST_KINDS = Object.keys(TRUST_SIGN)

// A client's current trust balance in integer cents, derived from the ledger.
// THE compliance read — every disburse / transfer / refund takes lockClientTrust
// BEFORE calling this, so concurrent debits for one client serialize and the
// loser re-reads the reduced balance (a shared transaction alone gives atomicity,
// not mutual exclusion — the advisory lock is what prevents the overdraft race).
async function clientTrustBalanceCents(
  client: DbClient,
  tenantId: string,
  clientEntityId: string,
): Promise<number> {
  const res = await client.query<{ kind_name: string; amount: string | null }>(
    `SELECT ekd.kind_name, e.payload->>'amount' AS amount
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
      WHERE e.tenant_id = $1
        AND e.primary_entity_id = $2::uuid
        AND ekd.kind_name = ANY($3)`,
    [tenantId, clientEntityId, TRUST_KINDS],
  )
  let cents = 0
  for (const r of res.rows) {
    if (!r.amount) continue
    cents += (TRUST_SIGN[r.kind_name] ?? 0) * amountToCents(r.amount)
  }
  return cents
}

// Local copies of the two invoice-pay writes (mirrors handlers/invoice.ts) so the
// earned transfer can mark the invoice paid ATOMICALLY in one transaction rather
// than as a second, separately-committed action.
async function setAttr(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    entityId: string
    kind: string
    value: unknown
  },
): Promise<void> {
  const akId = await lookupKindId(client, 'attribute_kind_definition', args.tenantId, args.kind)
  await insertAttribute(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: args.entityId,
    attributeKindId: akId,
    value: args.value,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: args.actorId,
  })
}

async function loadInvoiceMatterIds(
  client: DbClient,
  tenantId: string,
  invoiceId: string,
): Promise<string[]> {
  const res = await client.query<{ matter_id: string | null }>(
    `SELECT DISTINCT amm.value #>> '{}' AS matter_id
       FROM attribute aii
       JOIN attribute_kind_definition kii ON kii.id = aii.attribute_kind_id
        AND kii.kind_name = 'line_invoice_id'
       JOIN attribute amm ON amm.entity_id = aii.entity_id AND amm.valid_to IS NULL
       JOIN attribute_kind_definition kmm ON kmm.id = amm.attribute_kind_id
        AND kmm.kind_name = 'line_matter_id'
      WHERE aii.tenant_id = $1 AND aii.valid_to IS NULL AND aii.value #>> '{}' = $2`,
    [tenantId, invoiceId],
  )
  return res.rows.map((r) => r.matter_id).filter((m): m is string => !!m)
}

interface DepositPayload {
  client_entity_id: string
  amount: string
  currency?: string | null
  source?: string | null
  matter_entity_id?: string | null
  reference?: string | null
  deposited_date?: string | null
}

registerActionHandler('trust.deposit', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DepositPayload
  const clientId = (p.client_entity_id ?? '').trim()
  if (!clientId) throw new Error('client_entity_id is required.')
  const cents = amountToCents(p.amount)
  if (cents <= 0) throw new Error('Deposit amount must be positive.')

  const eventId = await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'trust.deposited',
    primaryEntityId: clientId,
    secondaryEntityIds: p.matter_entity_id ? [p.matter_entity_id] : [],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: {
      amount: centsToAmount(cents),
      currency: (p.currency ?? 'USD').trim() || 'USD',
      source: (p.source ?? 'retainer').trim() || 'retainer',
      matter_id: p.matter_entity_id ?? null,
      reference: (p.reference ?? '').trim() || null,
      deposited_date: (p.deposited_date ?? '').trim() || new Date().toISOString().slice(0, 10),
    },
  })
  const balance = await clientTrustBalanceCents(client, ctx.tenantId, clientId)
  return { eventId, balance: centsToAmount(balance) }
})

interface DisbursePayload {
  client_entity_id: string
  amount: string
  payee?: string | null
  reason?: string | null
  matter_entity_id?: string | null
  reference?: string | null
}

registerActionHandler('trust.disburse', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DisbursePayload
  const clientId = (p.client_entity_id ?? '').trim()
  if (!clientId) throw new Error('client_entity_id is required.')
  const cents = amountToCents(p.amount)
  if (cents <= 0) throw new Error('Disbursement amount must be positive.')

  await lockClientTrust(client, ctx.tenantId, clientId)
  const balance = await clientTrustBalanceCents(client, ctx.tenantId, clientId)
  if (cents > balance) {
    throw new Error(
      `Trust overdraft blocked: this client's trust balance is ${centsToAmount(balance)}; cannot disburse ${centsToAmount(cents)}.`,
    )
  }

  const eventId = await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'trust.disbursed',
    primaryEntityId: clientId,
    secondaryEntityIds: p.matter_entity_id ? [p.matter_entity_id] : [],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: {
      amount: centsToAmount(cents),
      payee: (p.payee ?? '').trim() || null,
      reason: (p.reason ?? '').trim() || null,
      matter_id: p.matter_entity_id ?? null,
      reference: (p.reference ?? '').trim() || null,
      disbursed_date: new Date().toISOString().slice(0, 10),
    },
  })
  return { eventId, balance: centsToAmount(balance - cents) }
})

interface RefundPayload {
  client_entity_id: string
  amount: string
  reference?: string | null
}

registerActionHandler('trust.refund', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as RefundPayload
  const clientId = (p.client_entity_id ?? '').trim()
  if (!clientId) throw new Error('client_entity_id is required.')
  const cents = amountToCents(p.amount)
  if (cents <= 0) throw new Error('Refund amount must be positive.')

  await lockClientTrust(client, ctx.tenantId, clientId)
  const balance = await clientTrustBalanceCents(client, ctx.tenantId, clientId)
  if (cents > balance) {
    throw new Error(
      `Refund blocked: this client's trust balance is ${centsToAmount(balance)}; cannot refund ${centsToAmount(cents)}.`,
    )
  }

  const eventId = await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'trust.refunded',
    primaryEntityId: clientId,
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: {
      amount: centsToAmount(cents),
      reference: (p.reference ?? '').trim() || null,
      refunded_date: new Date().toISOString().slice(0, 10),
    },
  })
  return { eventId, balance: centsToAmount(balance - cents) }
})

interface TransferEarnedPayload {
  client_entity_id: string
  invoice_entity_id: string
  amount: string
}

// Apply a client's trust funds to an ISSUED invoice (attorney-initiated). One
// atomic transaction: record the trust→operating movement AND mark the invoice
// paid (method=trust). Validates the invoice is the client's and is issued/sent,
// and that the client's trust balance covers the amount.
registerActionHandler('trust.transfer_earned', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as TransferEarnedPayload
  const clientId = (p.client_entity_id ?? '').trim()
  const invoiceId = (p.invoice_entity_id ?? '').trim()
  if (!clientId || !invoiceId)
    throw new Error('client_entity_id and invoice_entity_id are required.')
  const cents = amountToCents(p.amount)
  if (cents <= 0) throw new Error('Transfer amount must be positive.')

  // Serialize per-client (overdraft race) THEN per-invoice (double-pay race),
  // always in this order so it can't deadlock with invoice.pay (invoice-only).
  await lockClientTrust(client, ctx.tenantId, clientId)
  await lockInvoicePay(client, ctx.tenantId, invoiceId)

  const get = (kind: string) =>
    getLatestAttributeValue<string>(client, ctx.tenantId, invoiceId, kind)
  const number = await get('invoice_number')
  const status = await get('invoice_status')
  const invClient = await get('invoice_client_id')
  const currency = await get('invoice_currency')
  const totalCents = amountToCents((await get('invoice_total')) ?? '0')
  if (!number || !status) throw new Error('Invoice not found.')
  if (status === 'paid') throw new Error(`Invoice ${number} is already paid.`)
  if (status !== 'issued' && status !== 'sent') {
    throw new Error(
      `Invoice ${number} is ${status}; only an issued or sent invoice can be paid from trust.`,
    )
  }
  if (invClient && invClient !== clientId) {
    throw new Error('That invoice belongs to a different client.')
  }
  // Trust applies in FULL only — never overpay (which would convert client funds)
  // and never mark a partially-covered invoice 'paid'. Partial trust application
  // is a future feature once invoices carry a partial-paid status.
  if (cents !== totalCents) {
    throw new Error(
      `Trust must cover the full invoice ${number} (${centsToAmount(totalCents)}); cannot apply ${centsToAmount(cents)}.`,
    )
  }

  const balance = await clientTrustBalanceCents(client, ctx.tenantId, clientId)
  if (cents > balance) {
    throw new Error(
      `Insufficient trust funds: this client's trust balance is ${centsToAmount(balance)}; cannot apply ${centsToAmount(cents)}.`,
    )
  }

  // 1) Record the trust → operating movement on the client's sub-ledger.
  const trustEventId = await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'trust.transferred_earned',
    primaryEntityId: clientId,
    secondaryEntityIds: [invoiceId],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: { amount: centsToAmount(cents), invoice_id: invoiceId },
  })

  // 2) Mark the invoice paid in the SAME transaction (mirrors invoice.pay).
  const matterIds = await loadInvoiceMatterIds(client, ctx.tenantId, invoiceId)
  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'invoice.paid',
    primaryEntityId: invoiceId,
    secondaryEntityIds: [...(invClient ? [invClient] : []), ...matterIds],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: {
      method: 'trust',
      amount: centsToAmount(cents),
      currency: (currency ?? 'USD') || 'USD',
      reference: trustEventId,
      paid_date: new Date().toISOString().slice(0, 10),
      note: 'Paid from client trust balance.',
    },
  })
  await setAttr(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    entityId: invoiceId,
    kind: 'invoice_status',
    value: 'paid',
  })

  return {
    trustEventId,
    invoiceNumber: number,
    applied: centsToAmount(cents),
    balance: centsToAmount(balance - cents),
  }
})
