import { withActionContext, type ActionContext } from '@exsto/substrate'
import { resolveClientMatterIds } from '../api/clientIdentity.js'
import { getTenantSettings } from '../api/tenantSettings.js'

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
  /** The client's own name (the "Bill to" on their invoice). */
  clientName: string
  lines: ClientInvoiceLine[]
  // FB-C — the resolved firm's name (never a hardcoded literal). Backs BOTH
  // pay doors (authed session + the token-based magic link), since both call
  // this same function. Null when the firm hasn't set one.
  firmName: string | null
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
  (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_number' ORDER BY a.valid_from DESC LIMIT 1)      AS number,
  (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_status' ORDER BY a.valid_from DESC LIMIT 1)      AS status,
  (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_total' ORDER BY a.valid_from DESC LIMIT 1)       AS total,
  (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_currency' ORDER BY a.valid_from DESC LIMIT 1)    AS currency,
  (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_issued_date' ORDER BY a.valid_from DESC LIMIT 1) AS issued_date,
  (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_due_date' ORDER BY a.valid_from DESC LIMIT 1)    AS due_date`

// List the signed-in client's invoices (newest first), scoped to their matters.
export async function listClientInvoices(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ClientInvoiceSummary[]> {
  const matterIds = await resolveClientMatterIds(ctx.tenantId, clientContactId)
  if (matterIds.length === 0) return []
  return withActionContext(ctx, async (client) => {
    const res = await client.query<InvoiceHeadRow>(
      `
       SELECT ${HEAD_COLUMNS}
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'invoice' AND e.status = 'active'
         AND (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_status' ORDER BY a.valid_from DESC LIMIT 1)
             = ANY($3::text[])
         AND (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_matter_id' ORDER BY a.valid_from DESC LIMIT 1)
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
  const detail = await withActionContext(ctx, async (client) => {
    const head = await client.query<InvoiceHeadRow & { client_name: string | null }>(
      `
       SELECT ${HEAD_COLUMNS},
         (SELECT (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = r.target_entity_id AND akd.kind_name = 'client_name' ORDER BY a.valid_from DESC LIMIT 1)
            FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.tenant_id = $1 AND r.source_entity_id = e.id AND rkd.kind_name = 'invoice_of'
              AND (r.valid_to IS NULL OR r.valid_to > now()) LIMIT 1) AS client_name
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'invoice' AND e.status = 'active'
         AND (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_number' ORDER BY a.valid_from DESC LIMIT 1) = $2
         AND (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_status' ORDER BY a.valid_from DESC LIMIT 1)
             = ANY($4::text[])
         AND (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_matter_id' ORDER BY a.valid_from DESC LIMIT 1)
             = ANY($3::text[])
       LIMIT 1`,
      [ctx.tenantId, invoiceNumber, matterIds, CLIENT_VISIBLE_STATUSES],
    )
    const h = head.rows[0]
    if (!h) return null

    const linesRes = await client.query<{ description: string | null; amount: string | null }>(
      `
       SELECT
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_description' ORDER BY a.valid_from DESC LIMIT 1) AS description,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_amount' ORDER BY a.valid_from DESC LIMIT 1)      AS amount
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
      clientName: h.client_name ?? '',
      lines: linesRes.rows.map((r) => ({
        description: r.description ?? '',
        amount: r.amount ?? '0.00',
      })),
    }
  })
  if (!detail) return null

  let firmName: string | null = null
  try {
    firmName = (await getTenantSettings(ctx)).firmName
  } catch {
    firmName = null // degrade to the page's generic fallback, never guess a name
  }
  return { ...detail, firmName }
}

// PORTAL-1 (WP6) — the magic-link pay door: resolve the CLIENT CONTACT the
// invoice bills, from the invoice itself (invoice_client_id → the client's main
// contact, else any contact). The pay token (bound to this invoice + tenant,
// emailed only to the on-file address) is the authorization; this lookup only
// supplies the contact the existing session-door functions expect.
export async function resolveInvoiceClientContact(
  ctx: ActionContext,
  invoiceNumber: string,
): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ contact_id: string }>(
      `
       SELECT COALESCE(
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
           WHERE a.tenant_id = $1
             AND a.entity_id = (SELECT a2.value #>> '{}' FROM attribute a2
                                 JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id
                                WHERE a2.tenant_id = $1 AND a2.entity_id = e.id AND akd2.kind_name = 'invoice_client_id'
                                ORDER BY a2.valid_from DESC LIMIT 1)::uuid
             AND akd.kind_name = 'client_main_contact'
           ORDER BY a.valid_from DESC LIMIT 1),
         (SELECT r.source_entity_id::text
            FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
           WHERE r.tenant_id = $1
             AND r.target_entity_id = (SELECT a2.value #>> '{}' FROM attribute a2
                                        JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id
                                       WHERE a2.tenant_id = $1 AND a2.entity_id = e.id AND akd2.kind_name = 'invoice_client_id'
                                       ORDER BY a2.valid_from DESC LIMIT 1)::uuid
             AND rkd.kind_name = 'contact_of'
             AND (r.valid_to IS NULL OR r.valid_to > now())
           ORDER BY r.recorded_at DESC LIMIT 1)
       ) AS contact_id
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'invoice' AND e.status = 'active'
         AND (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_number' ORDER BY a.valid_from DESC LIMIT 1) = $2
       LIMIT 1`,
      [ctx.tenantId, invoiceNumber],
    )
    return res.rows[0]?.contact_id ?? null
  })
}
