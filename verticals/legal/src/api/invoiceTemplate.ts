// Invoice template config + PDF rendering (Phase 3). Read/write the firm's invoice
// branding, and render any invoice (or a sample, for the Settings live preview) to
// a real PDF via the one renderer in billing/invoicePdf.ts.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { getInvoice } from '../queries/billing.js'
import { getClientInvoiceByNumber } from '../queries/clientBilling.js'
import {
  renderInvoicePdf,
  resolveInvoiceTemplate,
  type InvoiceTemplateConfig,
} from '../billing/invoicePdf.js'

export type { InvoiceTemplateConfig } from '../billing/invoicePdf.js'

export interface InvoicePdf {
  filename: string
  contentType: 'application/pdf'
  base64: string
}

// The firm's saved invoice template, resolved over defaults (so the UI always has
// a complete config to edit and the renderer never sees an undefined field).
export async function getInvoiceTemplate(ctx: ActionContext): Promise<InvoiceTemplateConfig> {
  const stored = await withActionContext(ctx, async (client) => {
    const res = await client.query<{ value: Partial<InvoiceTemplateConfig> | null }>(
      `SELECT a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         JOIN entity e ON e.id = a.entity_id
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
        WHERE a.tenant_id = $1
          AND akd.kind_name = 'invoice_template_config'
          AND ekd.kind_name = 'firm_settings'
          AND (a.valid_to IS NULL OR a.valid_to > now())
        ORDER BY a.valid_from DESC
        LIMIT 1`,
      [ctx.tenantId],
    )
    return res.rows[0]?.value ?? null
  })
  return resolveInvoiceTemplate(stored)
}

// Save the firm's invoice template (through the core; append-only).
export async function setInvoiceTemplate(
  ctx: ActionContext,
  config: Partial<InvoiceTemplateConfig>,
): Promise<InvoiceTemplateConfig> {
  // Resolve over defaults so the stored value is always complete + well-formed.
  const resolved = resolveInvoiceTemplate(config)
  await submitAction(ctx, {
    actionKindName: 'legal.firm.set_invoice_template',
    intentKind: 'adjustment',
    payload: { config: resolved },
  })
  return resolved
}

// Render one invoice to a PDF (base64) using the firm's saved template. Returns
// null when the invoice doesn't exist. Used by the View / Download actions and the
// send-with-attachment path.
export async function renderInvoicePdfBase64(
  ctx: ActionContext,
  invoiceEntityId: string,
): Promise<InvoicePdf | null> {
  const invoice = await getInvoice(ctx, invoiceEntityId)
  if (!invoice) return null
  const cfg = await getInvoiceTemplate(ctx)
  const buf = await renderInvoicePdf(invoice, cfg)
  return {
    filename: `${invoice.invoiceNumber || 'invoice'}.pdf`,
    contentType: 'application/pdf',
    base64: buf.toString('base64'),
  }
}

// CLIENT-SAFE invoice PDF: render the signed-in client's OWN invoice (by number)
// to a branded PDF. Sources data from the CLIENT projection (getClientInvoiceByNumber
// — matter-scoped authz, issued/sent/paid only, descriptions+amounts only), NEVER
// the attorney getInvoice (which carries rates, source ledger events, internal ids).
// Firm branding (name/logo/accent/payment instructions) is shown, but the rate /
// quantity / matter columns are FORCE-HIDDEN so a saved firm config that enables the
// rate column can never print hourly rates to the client. Returns null when the
// invoice isn't the client's own / not yet issued (no oracle).
export async function renderClientInvoicePdfBase64(
  ctx: ActionContext,
  clientContactId: string,
  invoiceNumber: string,
): Promise<InvoicePdf | null> {
  const inv = await getClientInvoiceByNumber(ctx, clientContactId, invoiceNumber)
  if (!inv) return null

  const cfg = await getInvoiceTemplate(ctx)
  // Force client-unsafe columns off regardless of the firm's saved config.
  const clientCfg: InvoiceTemplateConfig = {
    ...cfg,
    columns: { matter: false, quantity: false, rate: false },
  }

  // Map the client projection into the renderer's InvoiceDetail shape, supplying
  // ONLY client-safe fields (no rate/quantity/matterNumber/sourceEventId/notes).
  const detail = {
    invoiceEntityId: inv.invoiceEntityId,
    invoiceNumber: inv.invoiceNumber,
    // Client-facing status label, not the internal lifecycle word ('sent' etc.).
    status: inv.status === 'paid' ? 'paid' : 'due',
    clientName: inv.clientName,
    clientEntityId: null,
    matterEntityId: null,
    total: inv.total,
    currency: inv.currency,
    issuedDate: inv.issuedDate,
    dueDate: inv.dueDate,
    notes: null,
    lineCount: inv.lines.length,
    createdAt: inv.issuedDate ?? '',
    lines: inv.lines.map((l, i) => ({
      lineEntityId: String(i),
      kind: '',
      description: l.description,
      quantity: '',
      rate: '',
      amount: l.amount,
      sourceEventId: null,
      matterNumber: null,
    })),
  }

  const buf = await renderInvoicePdf(detail, clientCfg)
  return {
    filename: `${inv.invoiceNumber || 'invoice'}.pdf`,
    contentType: 'application/pdf',
    base64: buf.toString('base64'),
  }
}

// A sample invoice for the Settings live preview, so the attorney sees their
// branding without needing a real invoice on file.
const SAMPLE_INVOICE = {
  invoiceEntityId: 'sample',
  invoiceNumber: 'INV-2026-0001',
  status: 'issued',
  clientName: 'Acme Holdings LLC',
  clientEntityId: null,
  matterEntityId: null,
  total: '650.00',
  currency: 'USD',
  issuedDate: '2026-01-15',
  dueDate: '2026-02-14',
  notes: null,
  lineCount: 2,
  createdAt: '2026-01-15T00:00:00Z',
  lines: [
    {
      lineEntityId: 's1',
      kind: 'time',
      description: 'Formation consultation',
      quantity: '1.50',
      rate: '350.00',
      amount: '525.00',
      sourceEventId: null,
      matterNumber: 'M-0001',
    },
    {
      lineEntityId: 's2',
      kind: 'expense',
      description: 'State filing fee',
      quantity: '1',
      rate: '125.00',
      amount: '125.00',
      sourceEventId: null,
      matterNumber: 'M-0001',
    },
  ],
}

// Render the sample invoice with a (draft) template config — powers the editor's
// live preview without saving.
export async function renderInvoiceTemplatePreviewBase64(
  config: Partial<InvoiceTemplateConfig>,
): Promise<InvoicePdf> {
  const buf = await renderInvoicePdf(SAMPLE_INVOICE, config)
  return {
    filename: 'invoice-preview.pdf',
    contentType: 'application/pdf',
    base64: buf.toString('base64'),
  }
}
