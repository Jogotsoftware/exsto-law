import { withActionContext, type ActionContext } from '@exsto/substrate'
import { resolveClientMatterIds } from '../api/clientIdentity.js'

// CLIENT-SAFE invoice reads for the authenticated portal. Deliberately a separate
// module from queries/billing.ts (the attorney surface) so the projection is easy
// to audit: a client may see only invoices for matters they are client_of, only
// once issued/sent (never a draft), and only the public fields — number, total,
// currency, status, dates, and line DESCRIPTIONS + AMOUNTS. Internal billing data
// (hourly rates, per-line source ledger events, the client billing-parent id,
// attorney notes) never appears here.
//
// Authorization is by the client's OWN matters: the caller passes the
// clientContactId the portal route stamped from the signed session cookie; we
// re-resolve that contact's current matter set from the DB and scope every read
// to it. A client can never see a stranger's invoice even by guessing a number.

const ATTRS_CTE = `
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name)
      a.entity_id, akd.kind_name, a.value
    FROM attribute a
    JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = $1
    ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  )`

// Invoices a client may see: issued/sent (outstanding) or paid. Drafts are the
// attorney's working state and never leave the firm.
const CLIENT_VISIBLE_STATUSES = ['issued', 'sent', 'paid']

export interface ClientInvoiceLine {
  description: string
  amount: string
}
export interface ClientInvoiceSummary {
  invoiceEntityId: string
  invoiceNumber: string
  /** Client-facing status: 'due' (issued/sent) or 'paid'. */
  status: 'due' | 'paid'
  total: string
  currency: string
  issuedDate: string | null
  dueDate: string | null
}
export interface ClientInvoiceDetail extends ClientInvoiceSummary {
  lines: ClientInvoiceLine[]
}

// 'paid' stays 'paid'; everything else a client can see (issued/sent) is "due".
function toClientStatus(raw: string | null): 'due' | 'paid' {
  return raw === 'paid' ? 'paid' : 'due'
}

interface InvoiceHeadRow {
  invoice_id: string
  number: string | null
  status: string | null
  total: string | null
  currency: string | null
  issued_date: string | null
  due_date: string | null
}

function toSummary(r: InvoiceHeadRow): ClientInvoiceSummary {
  return {
    invoiceEntityId: r.invoice_id,
    invoiceNumber: r.number ?? '',
    status: toClientStatus(r.status),
    total: r.total ?? '0.00',
    currency: r.currency ?? 'USD',
    issuedDate: r.issued_date,
    dueDate: r.due_date,
  }
}

const HEAD_COLUMNS = `
  e.id AS invoice_id,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_number')      AS number,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_status')      AS status,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_total')       AS total,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_currency')    AS currency,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_issued_date') AS issued_date,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_due_date')    AS due_date`

// List the signed-in client's invoices (newest first), scoped to their matters.
export async function listClientInvoices(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ClientInvoiceSummary[]> {
  const matterIds = await resolveClientMatterIds(ctx.tenantId, clientContactId)
  if (matterIds.length === 0) return []
  return withActionContext(ctx, async (client) => {
    const res = await client.query<InvoiceHeadRow>(
      `${ATTRS_CTE}
       SELECT ${HEAD_COLUMNS}
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'invoice' AND e.status = 'active'
         AND (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_status')
             = ANY($3::text[])
         AND (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_matter_id')
             = ANY($2::text[])
       ORDER BY e.created_at DESC`,
      [ctx.tenantId, matterIds, CLIENT_VISIBLE_STATUSES],
    )
    return res.rows.map(toSummary)
  })
}

// One invoice (by its human-facing number) with its line descriptions + amounts —
// only if it bills a matter this client is client_of and it has been issued.
export async function getClientInvoiceByNumber(
  ctx: ActionContext,
  clientContactId: string,
  invoiceNumber: string,
): Promise<ClientInvoiceDetail | null> {
  const matterIds = await resolveClientMatterIds(ctx.tenantId, clientContactId)
  if (matterIds.length === 0) return null
  return withActionContext(ctx, async (client) => {
    const head = await client.query<InvoiceHeadRow>(
      `${ATTRS_CTE}
       SELECT ${HEAD_COLUMNS}
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'invoice' AND e.status = 'active'
         AND (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_number') = $2
         AND (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_status')
             = ANY($4::text[])
         AND (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_matter_id')
             = ANY($3::text[])
       LIMIT 1`,
      [ctx.tenantId, invoiceNumber, matterIds, CLIENT_VISIBLE_STATUSES],
    )
    const h = head.rows[0]
    if (!h) return null

    const linesRes = await client.query<{ description: string | null; amount: string | null }>(
      `${ATTRS_CTE}
       SELECT
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = le.id AND kind_name = 'line_description') AS description,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = le.id AND kind_name = 'line_amount')      AS amount
       FROM entity le
       JOIN relationship r ON r.source_entity_id = le.id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'line_of'
         AND (r.valid_to IS NULL OR r.valid_to > now()) AND le.status = 'active'
       ORDER BY le.created_at`,
      [ctx.tenantId, h.invoice_id],
    )

    return {
      ...toSummary(h),
      lines: linesRes.rows.map((r) => ({
        description: r.description ?? '',
        amount: r.amount ?? '0.00',
      })),
    }
  })
}
