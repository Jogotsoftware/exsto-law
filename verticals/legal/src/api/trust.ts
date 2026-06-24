// Trust (IOLTA) write-path (migration 0110). Every write goes THROUGH THE CORE
// via submitAction; the handlers (handlers/trust.ts) do the guarded transactional
// writes (no client overdraft; atomic earned transfer). Reads live in
// queries/trust.ts.
import { submitAction, type ActionContext } from '@exsto/substrate'
import { getInvoice } from '../queries/billing.js'

export interface TrustDepositInput {
  clientEntityId: string
  amount: string
  source?: string | null // retainer | advance | settlement | other
  matterEntityId?: string | null
  reference?: string | null
  depositedDate?: string | null
}

export async function depositToTrust(
  ctx: ActionContext,
  input: TrustDepositInput,
): Promise<{ eventId: string; balance: string }> {
  if (!input.clientEntityId?.trim()) throw new Error('Pick a client to deposit trust funds for.')
  const res = await submitAction(ctx, {
    actionKindName: 'trust.deposit',
    intentKind: 'enforcement',
    payload: {
      client_entity_id: input.clientEntityId,
      amount: input.amount,
      source: input.source ?? null,
      matter_entity_id: input.matterEntityId ?? null,
      reference: input.reference ?? null,
      deposited_date: input.depositedDate ?? null,
    },
  })
  return res.effects[0] as { eventId: string; balance: string }
}

export interface TrustDisburseInput {
  clientEntityId: string
  amount: string
  payee?: string | null
  reason?: string | null
  matterEntityId?: string | null
  reference?: string | null
}

export async function disburseFromTrust(
  ctx: ActionContext,
  input: TrustDisburseInput,
): Promise<{ eventId: string; balance: string }> {
  if (!input.clientEntityId?.trim()) throw new Error('Pick a client to disburse from.')
  const res = await submitAction(ctx, {
    actionKindName: 'trust.disburse',
    intentKind: 'enforcement',
    payload: {
      client_entity_id: input.clientEntityId,
      amount: input.amount,
      payee: input.payee ?? null,
      reason: input.reason ?? null,
      matter_entity_id: input.matterEntityId ?? null,
      reference: input.reference ?? null,
    },
  })
  return res.effects[0] as { eventId: string; balance: string }
}

export interface TrustRefundInput {
  clientEntityId: string
  amount: string
  reference?: string | null
}

export async function refundTrust(
  ctx: ActionContext,
  input: TrustRefundInput,
): Promise<{ eventId: string; balance: string }> {
  if (!input.clientEntityId?.trim()) throw new Error('Pick a client to refund.')
  const res = await submitAction(ctx, {
    actionKindName: 'trust.refund',
    intentKind: 'enforcement',
    payload: {
      client_entity_id: input.clientEntityId,
      amount: input.amount,
      reference: input.reference ?? null,
    },
  })
  return res.effects[0] as { eventId: string; balance: string }
}

export interface ApplyTrustResult {
  trustEventId: string
  invoiceNumber: string
  applied: string
  balance: string
}

// Attorney-initiated: apply a client's trust funds to one of their issued
// invoices. Resolves the invoice's client + amount server-side (defaults to the
// full invoice total), then the trust.transfer_earned handler atomically moves
// the funds and marks the invoice paid (method=trust).
export async function applyTrustToInvoice(
  ctx: ActionContext,
  input: { invoiceEntityId: string; amount?: string | null },
): Promise<ApplyTrustResult> {
  if (!input.invoiceEntityId?.trim()) throw new Error('invoiceEntityId is required.')
  const invoice = await getInvoice(ctx, input.invoiceEntityId)
  if (!invoice) throw new Error('Invoice not found.')
  if (!invoice.clientEntityId) throw new Error('This invoice has no client to draw trust from.')
  if (invoice.status === 'paid')
    throw new Error(`Invoice ${invoice.invoiceNumber} is already paid.`)
  const amount = (input.amount ?? '').trim() || invoice.total
  const res = await submitAction(ctx, {
    actionKindName: 'trust.transfer_earned',
    intentKind: 'enforcement',
    payload: {
      client_entity_id: invoice.clientEntityId,
      invoice_entity_id: input.invoiceEntityId,
      amount,
    },
  })
  return res.effects[0] as ApplyTrustResult
}
