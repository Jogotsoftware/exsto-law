import type { ActionContext } from '@exsto/substrate'
import { listPendingDraftVersions, type PendingDraftSummary } from './drafts.js'
import { listSignaturesAwaitingAttorney, type AwaitingAttorneySignature } from '../api/esign.js'
import { listInvoices, type InvoiceSummary } from './billing.js'
import { listPaymentReports, type PaymentReport } from '../api/manualPayments.js'
import { listPendingRequests, type AttorneyRequestItem } from './clientRequests.js'

// TASK-QUEUE-1 — the unified attorney Task Queue. Aggregates every task
// currently waiting on the attorney across four sources (document review,
// e-sign, billing, client requests) into one merged, sortable/filterable row
// shape. Each source has a small PURE normalizer below (no DB) so the mapping
// from source shape -> AttorneyTask is unit-testable in isolation; the async
// listAttorneyTasks wraps each source read in try/catch so one failing source
// degrades (log + skip) instead of blanking the whole queue.

export type AttorneyTaskType = 'document_review' | 'esign' | 'billing' | 'client_request'

export interface AttorneyTask {
  id: string
  type: AttorneyTaskType
  typeLabel: string
  subtype?: string
  title: string
  clientName: string | null
  matterNumber: string | null
  matterEntityId: string | null
  contactEntityId: string | null
  date: string | null
  dateLabel: string
  status: string | null
  workHref: string
  viewHref?: string | null
}

// Plain document-kind → label transform for the Task Queue titles. BILINGUAL-DOCS-1:
// a '_es' Spanish copy renders as "… (Spanish)" so a translated document is
// clearly distinguished from its English source in the queue.
export function humanizeKind(kind: string): string {
  const es = kind.endsWith('_es')
  const base = es ? kind.slice(0, -'_es'.length) : kind
  const h = base.replace(/_/g, ' ')
  return es ? `${h} (Spanish)` : h
}

// ── Document review (legal.draft.list_pending) ──────────────────────────────

export function normalizeDocumentReviewTask(draft: PendingDraftSummary): AttorneyTask {
  const title =
    draft.channel === 'communication'
      ? draft.emailSubject || humanizeKind(draft.documentKind)
      : humanizeKind(draft.documentKind)
  return {
    id: draft.documentVersionId,
    type: 'document_review',
    typeLabel: 'Document Review',
    subtype: draft.channel,
    title,
    clientName: draft.clientName || null,
    matterNumber: draft.matterNumber || null,
    matterEntityId: draft.matterEntityId || null,
    contactEntityId: null,
    date: draft.recordedAt,
    dateLabel: 'Generated',
    status: draft.status,
    workHref: `/attorney/review/${draft.documentVersionId}`,
    viewHref: null,
  }
}

// ── E-sign (legal.esign.awaiting_me) ─────────────────────────────────────────

export function normalizeEsignTask(sig: AwaitingAttorneySignature): AttorneyTask {
  return {
    id: sig.requestId,
    type: 'esign',
    typeLabel: 'E-Sign',
    title: sig.subject || humanizeKind(sig.documentKind ?? 'document'),
    clientName: sig.contactName ?? null,
    matterNumber: sig.matterNumber,
    matterEntityId: sig.matterEntityId,
    contactEntityId: sig.contactEntityId,
    date: sig.sentAt,
    dateLabel: 'Sent',
    status: null,
    workHref: `/attorney/sign/${sig.requestId}`,
    viewHref: `/attorney/esign/${sig.envelopeId}`,
  }
}

// ── Billing: issued-but-unsent invoices (legal.invoice.list) ───────────────

// Pure filter, exported for unit tests: an invoice is "action needed" once
// issued but before it has been emailed to the client. InvoiceSummary.status
// is untyped string, but the real lifecycle values written by invoice.issue /
// invoice.send / invoice.pay are 'issued' -> 'sent' -> 'paid' (see
// verticals/legal/src/handlers/invoice.ts) — 'issued' alone correctly isolates
// "not yet sent" since 'sent' and 'paid' are distinct later values.
export function isUnsentIssuedInvoice(invoice: Pick<InvoiceSummary, 'status'>): boolean {
  return invoice.status === 'issued'
}

function formatInvoiceAmount(invoice: Pick<InvoiceSummary, 'total' | 'currency'>): string {
  if (!invoice.total) return ''
  return invoice.currency === 'USD' ? `$${invoice.total}` : `${invoice.total} ${invoice.currency}`
}

export function normalizeInvoiceTask(invoice: InvoiceSummary): AttorneyTask {
  const amount = formatInvoiceAmount(invoice)
  return {
    id: invoice.invoiceEntityId,
    type: 'billing',
    typeLabel: 'Billing',
    subtype: 'invoice_unsent',
    title: `Invoice ${invoice.invoiceNumber}${amount ? ' · ' + amount : ''}`,
    clientName: invoice.clientName || null,
    // InvoiceSummary carries no matter reference (an invoice is client-scoped;
    // individual lines can span multiple matters — see InvoiceLine.matterNumber
    // on getInvoice). Brief/Email hide on these rows for lack of a matter.
    matterNumber: null,
    matterEntityId: null,
    contactEntityId: null,
    date: invoice.issuedDate,
    dateLabel: 'Issued',
    status: invoice.status,
    workHref: '/attorney/billing',
    viewHref: null,
  }
}

// ── Billing: open client payment reports (legal.billing.payment_reports) ───

// Pure filter, exported for unit tests: PaymentReport.status is a real typed
// literal union ('open' | 'resolved' | 'dismissed') — 'open' is the one that
// needs attorney action.
export function isOpenPaymentReport(report: Pick<PaymentReport, 'status'>): boolean {
  return report.status === 'open'
}

export function normalizePaymentReportTask(report: PaymentReport): AttorneyTask {
  return {
    id: report.eventId,
    type: 'billing',
    typeLabel: 'Billing',
    subtype: 'payment_report',
    title: `Payment reported${report.invoiceNumber ? ' · ' + report.invoiceNumber : ''}`,
    // PaymentReport has no resolved client-entity name (it's event-backed, not
    // entity-backed) — payerName is the client's own self-reported name.
    clientName: report.payerName ?? null,
    matterNumber: null,
    matterEntityId: null,
    contactEntityId: null,
    date: report.reportedAt,
    dateLabel: 'Reported',
    status: report.status,
    workHref: '/attorney/billing',
    viewHref: null,
  }
}

// ── Client requests (legal.client_request.list_pending) ─────────────────────

export function normalizeClientRequestTask(req: AttorneyRequestItem): AttorneyTask {
  return {
    id: req.requestEntityId,
    type: 'client_request',
    typeLabel: 'Client Request',
    subtype: req.requestType,
    title: req.description || humanizeKind(req.requestType),
    clientName: req.clientName || null,
    matterNumber: req.matterNumber,
    matterEntityId: req.matterEntityId,
    contactEntityId: null,
    date: req.createdAt,
    dateLabel: 'Requested',
    status: req.status,
    workHref: '/attorney/requests',
    viewHref: null,
  }
}

// ── Aggregator ────────────────────────────────────────────────────────────

// Every task waiting on the attorney, merged across all four sources. Each
// source is independently try/catch-wrapped: a failure in one (e.g. a
// misbehaving billing read) is logged and skipped rather than blanking the
// rest of the queue.
export async function listAttorneyTasks(ctx: ActionContext): Promise<AttorneyTask[]> {
  const tasks: AttorneyTask[] = []

  try {
    const drafts = await listPendingDraftVersions(ctx)
    tasks.push(...drafts.map(normalizeDocumentReviewTask))
  } catch (err) {
    console.error('listAttorneyTasks: document review source failed:', err)
  }

  try {
    const signatures = await listSignaturesAwaitingAttorney(ctx)
    tasks.push(...signatures.map(normalizeEsignTask))
  } catch (err) {
    console.error('listAttorneyTasks: e-sign source failed:', err)
  }

  try {
    const invoices = await listInvoices(ctx)
    tasks.push(...invoices.filter(isUnsentIssuedInvoice).map(normalizeInvoiceTask))
  } catch (err) {
    console.error('listAttorneyTasks: invoice source failed:', err)
  }

  try {
    const reports = await listPaymentReports(ctx)
    tasks.push(...reports.filter(isOpenPaymentReport).map(normalizePaymentReportTask))
  } catch (err) {
    console.error('listAttorneyTasks: payment report source failed:', err)
  }

  try {
    const requests = await listPendingRequests(ctx)
    tasks.push(...requests.map(normalizeClientRequestTask))
  } catch (err) {
    console.error('listAttorneyTasks: client request source failed:', err)
  }

  return tasks
}
