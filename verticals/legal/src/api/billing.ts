// Billing write-path (Session 4): issue an invoice from unbilled time + expense
// ledger events, and send an issued invoice. Both go THROUGH THE CORE via
// submitAction — the handlers (handlers/invoice.ts) do the transactional writes.
// Reads live in queries/billing.ts.
import { submitAction, type ActionContext } from '@exsto/substrate'
import { enqueueClientEmail } from './mailWorkspace.js'
import { getInvoice } from '../queries/billing.js'
import { getClient } from '../queries/client.js'
import { renderEmailHtml } from '../email/index.js'

export interface IssueInvoiceLineInput {
  sourceEventId: string
  kind: 'time' | 'expense' | 'service_fee' | 'document_fee'
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

export async function issueInvoice(
  ctx: ActionContext,
  input: IssueInvoiceInput,
): Promise<IssuedInvoice> {
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
  // Recipient override; defaults to the client's main-contact email.
  toEmail?: string | null
  // Optional cover line added under the greeting.
  message?: string | null
  // Origin of the app the client should land on for the "Pay now" link, e.g.
  // "https://app.pacheco.law". Passed from the browser (window.location.origin),
  // mirroring how draft-link emails build their share URL. The pay link is
  // `${payUrlBase}/portal/pay/<invoiceNumber>`.
  payUrlBase?: string | null
}

export interface SentInvoice {
  sent: boolean
  delivered: boolean
  to: string
  invoiceNumber: string
  payUrl: string
  messageId: string
}

// Build the plain-text invoice email. Contract B (enqueueClientEmail) sends text
// only, so the "Pay now" call-to-action is a prominent link, not an HTML button.
function renderInvoiceEmail(args: {
  greetingName: string
  number: string
  issuedDate: string | null
  lines: { description: string; quantity: string; kind: string; rate: string; amount: string }[]
  total: string
  currency: string
  payUrl: string
  coverMessage: string | null
}): { subject: string; body: string } {
  const cur = args.currency === 'USD' ? '$' : `${args.currency} `
  const lineRows = args.lines.map((l) => {
    const qty = l.kind === 'time' ? `${l.quantity} hrs × ${cur}${l.rate}` : `${cur}${l.rate}`
    return `  • ${l.description}\r\n      ${qty}  =  ${cur}${l.amount}`
  })
  const body = [
    `Hi ${args.greetingName},`,
    '',
    ...(args.coverMessage ? [args.coverMessage, ''] : []),
    `Your invoice ${args.number} from Pacheco Law is ready${args.issuedDate ? ` (issued ${args.issuedDate})` : ''}.`,
    '',
    ...lineRows,
    '  ─────────────────────────',
    `  Total due: ${cur}${args.total} ${args.currency}`,
    '',
    'Pay now:',
    args.payUrl,
    '',
    'Online card payments are coming soon — the link above has the details. In the',
    'meantime, just reply to this email to arrange payment by check or transfer.',
  ].join('\r\n')
  return { subject: `Invoice ${args.number} from Pacheco Law`, body }
}

// Send an issued invoice to the client by email (amounts + a "Pay now" link to the
// portal), through Contract B (enqueueClientEmail — real Gmail send + mail.send
// audit), then record invoice.send (invoice.sent + status) through the core.
export async function sendInvoice(
  ctx: ActionContext,
  input: SendInvoiceInput,
): Promise<SentInvoice> {
  if (!input.invoiceEntityId?.trim()) throw new Error('invoiceEntityId is required.')

  const invoice = await getInvoice(ctx, input.invoiceEntityId)
  if (!invoice) throw new Error('Invoice not found.')
  if (invoice.status !== 'issued' && invoice.status !== 'sent') {
    throw new Error(
      `Invoice ${invoice.invoiceNumber} is ${invoice.status}; only issued invoices can be sent.`,
    )
  }

  // Resolve recipient + greeting from the client (override wins).
  let to = (input.toEmail ?? '').trim()
  let greetingName = 'there'
  if (invoice.clientEntityId) {
    const client = await getClient(ctx, invoice.clientEntityId)
    if (client) {
      greetingName = client.name?.split(' ')[0]?.trim() || greetingName
      if (!to) {
        const main =
          client.contacts.find((c) => c.isMain && c.email) ?? client.contacts.find((c) => c.email)
        to = (main?.email ?? '').trim()
      }
    }
  }
  if (!to) {
    throw new Error(
      'No client email on file for this invoice. Add one to the client, or pass a recipient.',
    )
  }

  const base = (input.payUrlBase ?? '').replace(/\/+$/, '')
  const payUrl = `${base}/portal/pay/${encodeURIComponent(invoice.invoiceNumber)}`

  const { subject, body } = renderInvoiceEmail({
    greetingName,
    number: invoice.invoiceNumber,
    issuedDate: invoice.issuedDate,
    lines: invoice.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      kind: l.kind,
      rate: l.rate,
      amount: l.amount,
    })),
    total: invoice.total,
    currency: invoice.currency,
    payUrl,
    coverMessage: input.message?.trim() || null,
  })

  // Branded HTML alternative (the plaintext `body` above stays the fallback).
  const branded = renderEmailHtml('client-invoice', {
    client_first_name: greetingName !== 'there' ? greetingName : undefined,
    invoice_number: invoice.invoiceNumber,
    amount_due: invoice.total,
    pay_url: payUrl,
    line_items: invoice.lines.map((l) => ({ label: l.description, amount: l.amount })),
  })

  // Real send through Contract B (throws if Google isn't connected — the genuine
  // activation gate — or if `to` isn't a known client contact). We do NOT fake a
  // delivery: a failure here surfaces to the caller.
  const mail = await enqueueClientEmail(ctx, {
    to,
    subject,
    body,
    html: branded?.html,
    matterId: invoice.matterEntityId ?? undefined,
  })

  // Record the invoice lifecycle (invoice.sent + status='sent') through the core.
  const res = await submitAction(ctx, {
    actionKindName: 'invoice.send',
    intentKind: 'enforcement',
    payload: {
      invoice_entity_id: input.invoiceEntityId,
      to: mail.to,
      message_id: mail.messageId,
      delivered: true,
      pay_url: payUrl,
    },
  })
  const effect = res.effects[0] as { invoiceNumber: string }

  return {
    sent: true,
    delivered: true,
    to: mail.to,
    invoiceNumber: effect?.invoiceNumber ?? invoice.invoiceNumber,
    payUrl,
    messageId: mail.messageId,
  }
}
