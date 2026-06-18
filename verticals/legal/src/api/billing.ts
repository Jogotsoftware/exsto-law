// Billing write-path (Session 4): issue an invoice from unbilled time + expense
// ledger events, and send an issued invoice. Both go THROUGH THE CORE via
// submitAction — the handlers (handlers/invoice.ts) do the transactional writes.
// Reads live in queries/billing.ts.
import { submitAction, type ActionContext } from '@exsto/substrate'

export interface IssueInvoiceLineInput {
  sourceEventId: string
  kind: 'time' | 'expense'
  // Optional per-entry overrides; rate defaults to the client's billable rate,
  // description to the source entry's description.
  rateOverride?: string | null
  descriptionOverride?: string | null
}

export interface IssueInvoiceInput {
  clientEntityId: string
  matterEntityId?: string | null
  currency?: string | null
  dueDate?: string | null
  notes?: string | null
  lines: IssueInvoiceLineInput[]
}

export interface IssuedInvoice {
  invoiceEntityId: string
  invoiceNumber: string
  total: string
  currency: string
  lineCount: number
}

export async function issueInvoice(ctx: ActionContext, input: IssueInvoiceInput): Promise<IssuedInvoice> {
  if (!input.clientEntityId?.trim()) throw new Error('Pick a client to invoice.')
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error('Select at least one unbilled time or expense entry.')
  }
  const res = await submitAction(ctx, {
    actionKindName: 'invoice.issue',
    intentKind: 'enforcement',
    payload: {
      client_entity_id: input.clientEntityId,
      matter_entity_id: input.matterEntityId ?? null,
      currency: input.currency ?? null,
      due_date: input.dueDate ?? null,
      notes: input.notes ?? null,
      lines: input.lines.map((l) => ({
        source_event_id: l.sourceEventId,
        kind: l.kind,
        rate_override: l.rateOverride ?? null,
        description_override: l.descriptionOverride ?? null,
      })),
    },
  })
  return res.effects[0] as IssuedInvoice
}

export interface SendInvoiceInput {
  invoiceEntityId: string
  toEmail?: string | null
  message?: string | null
}

export interface SentInvoice {
  sent: boolean
  // v1 live delivery is gated on Google connect + the comms send contract (S3);
  // activationGated=true means the send was recorded but not actually delivered.
  activationGated: boolean
  delivered: boolean
  to: string | null
  invoiceNumber: string
}

export async function sendInvoice(ctx: ActionContext, input: SendInvoiceInput): Promise<SentInvoice> {
  if (!input.invoiceEntityId?.trim()) throw new Error('invoiceEntityId is required.')
  const res = await submitAction(ctx, {
    actionKindName: 'invoice.send',
    intentKind: 'enforcement',
    payload: {
      invoice_entity_id: input.invoiceEntityId,
      to_email: input.toEmail ?? null,
      message: input.message ?? null,
    },
  })
  return res.effects[0] as SentInvoice
}
