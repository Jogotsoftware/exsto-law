import { withActionContext, type ActionContext } from '@exsto/substrate'
import { readFirmDefault } from '../api/rates.js'

// Billing read-path (Session 4). Bitemporal discipline (exsto-query-substrate):
// current attribute = latest valid_from; relationships current via valid_to open.
//
// "Unbilled" is DERIVED, not stored: a time.logged / expense.recorded ledger event
// (migration 0018) is unbilled when no time.billed / expense.billed event names it
// as source_event_id. Money math is integer-cents (ADR 0044) — no float drift.

function amountToCents(amount: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec((amount ?? '').trim())
  if (!m) return 0
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}
function centsToAmount(cents: number): string {
  const abs = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
// hours = round(minutes/60, 2); amount = round(hours * rate). Matches the handler.
function priceTime(minutes: number, rateStr: string): { quantity: string; amountCents: number } {
  const hoursHundredths = Math.round((minutes * 100) / 60)
  const amountCents = Math.round((hoursHundredths * amountToCents(rateStr)) / 100)
  return { quantity: (hoursHundredths / 100).toFixed(2), amountCents }
}

export interface UnbilledEntry {
  kind: 'time' | 'expense' | 'service_fee' | 'document_fee'
  sourceEventId: string
  date: string | null
  description: string
  durationMinutes: number | null
  quantity: string
  rate: string | null
  // null when a time entry has no client rate yet (UI prompts for one).
  amount: string | null
}
export interface UnbilledMatter {
  matterEntityId: string
  matterNumber: string
  // Plain-language matter summary (e.g. "NC LLC formation for Acme"); the UI shows
  // this as the readable label and keeps matterNumber as a secondary code.
  matterSummary: string | null
  // The matter's contact (client_of). Present even when the matter has no client
  // parent — the Unbilled UI uses it to one-click set up billing for an orphan.
  contactEntityId: string | null
  contactName: string | null
  entries: UnbilledEntry[]
  total: string
}
export interface UnbilledClient {
  clientEntityId: string | null
  clientName: string
  billableRate: string | null
  billingType: string | null
  matters: UnbilledMatter[]
  total: string
}

// Done + costed + not-yet-invoiced tasks (migration 0084) — the VIRTUAL unbilled
// lines. A task is the LIVE source of its charge: it appears here only while it is
// `done`, costed (billing_mode hours|fixed), and un-invoiced, so moving it back
// out of `done` simply removes the line again. Nothing is written until
// invoice.issue MATERIALISES it into a ledger event and sets task_invoice_id (the
// lock). Same matter/client/contact context as the event feed, so it slots into
// the same client -> matter groups.
interface BillableTaskRow {
  task_id: string
  title: string | null
  billing_mode: string | null
  hours: string | null
  fee_amount: string | null
  matter_id: string | null
  matter_number: string | null
  matter_summary: string | null
  client_id: string | null
  client_name: string | null
  billable_rate: string | null
  billing_type: string | null
  contact_id: string | null
  contact_name: string | null
}

async function listBillableTasks(
  client: Parameters<Parameters<typeof withActionContext>[1]>[0],
  tenantId: string,
): Promise<BillableTaskRow[]> {
  const res = await client.query<BillableTaskRow>(
    `WITH
     task_of AS (SELECT id FROM relationship_kind_definition
                  WHERE tenant_id = $1 AND kind_name = 'task_of' AND status = 'active' LIMIT 1),
     matter_of AS (SELECT id FROM relationship_kind_definition
                  WHERE tenant_id = $1 AND kind_name = 'matter_of' AND status = 'active' LIMIT 1)
     SELECT
       e.id AS task_id,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_title' ORDER BY a.valid_from DESC LIMIT 1)        AS title,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_billing_mode' ORDER BY a.valid_from DESC LIMIT 1) AS billing_mode,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_hours' ORDER BY a.valid_from DESC LIMIT 1)        AS hours,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_fee_amount' ORDER BY a.valid_from DESC LIMIT 1)   AS fee_amount,
       m.id AS matter_id,
       m.name AS matter_number,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = m.id AND akd.kind_name = 'matter_summary' ORDER BY a.valid_from DESC LIMIT 1)        AS matter_summary,
       cli.id AS client_id,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = cli.id AND akd.kind_name = 'client_name' ORDER BY a.valid_from DESC LIMIT 1)          AS client_name,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = cli.id AND akd.kind_name = 'client_billable_rate' ORDER BY a.valid_from DESC LIMIT 1) AS billable_rate,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = cli.id AND akd.kind_name = 'client_billing_type' ORDER BY a.valid_from DESC LIMIT 1)  AS billing_type,
       (SELECT co.source_entity_id FROM relationship co
          JOIN relationship_kind_definition cok ON cok.id = co.relationship_kind_id
         WHERE co.tenant_id = $1 AND co.target_entity_id = m.id AND cok.kind_name = 'client_of'
           AND (co.valid_to IS NULL OR co.valid_to > now()) LIMIT 1) AS contact_id,
       (SELECT COALESCE(
          (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = c2.cid AND akd.kind_name = 'contact_full_name' ORDER BY a.valid_from DESC LIMIT 1),
          (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = c2.cid AND akd.kind_name = 'full_name' ORDER BY a.valid_from DESC LIMIT 1))
        FROM (SELECT co.source_entity_id AS cid FROM relationship co
                JOIN relationship_kind_definition cok ON cok.id = co.relationship_kind_id
               WHERE co.tenant_id = $1 AND co.target_entity_id = m.id AND cok.kind_name = 'client_of'
                 AND (co.valid_to IS NULL OR co.valid_to > now()) LIMIT 1) c2) AS contact_name
     FROM entity e
     JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'task'
     JOIN relationship tr ON tr.source_entity_id = e.id AND tr.tenant_id = $1
       AND tr.relationship_kind_id = (SELECT id FROM task_of)
       AND (tr.valid_to IS NULL OR tr.valid_to > now())
     JOIN entity m ON m.id = tr.target_entity_id AND m.tenant_id = $1
     LEFT JOIN relationship r ON r.source_entity_id = m.id AND r.tenant_id = $1
       AND r.relationship_kind_id = (SELECT id FROM matter_of)
       AND (r.valid_to IS NULL OR r.valid_to > now())
     LEFT JOIN entity cli ON cli.id = r.target_entity_id AND cli.status = 'active'
     WHERE e.tenant_id = $1 AND e.status = 'active'
       AND (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_status' ORDER BY a.valid_from DESC LIMIT 1) = 'done'
       AND (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_billing_mode' ORDER BY a.valid_from DESC LIMIT 1) IN ('hours','fixed')
       AND (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_invoice_id' ORDER BY a.valid_from DESC LIMIT 1) IS NULL`,
    [tenantId],
  )
  return res.rows
}

export async function listUnbilled(
  ctx: ActionContext,
): Promise<{ clients: UnbilledClient[]; currency: string }> {
  return withActionContext(ctx, async (client) => {
    // The firm default hourly rate is the fallback when a client has no explicit
    // rate (Contract K, rates.ts is the source of truth). The invoice handler
    // already falls back to it; the Unbilled PREVIEW must too, or logged time
    // shows a blank amount even though it would invoice fine.
    const firmDefaultRate = await readFirmDefault(client, ctx.tenantId)
    const res = await client.query<{
      event_id: string
      kind: string
      matter_id: string
      matter_number: string
      matter_summary: string | null
      client_id: string | null
      client_name: string | null
      billable_rate: string | null
      billing_type: string | null
      contact_id: string | null
      contact_name: string | null
      description: string | null
      duration_minutes: string | null
      amount: string | null
      entry_date: string | null
    }>(
      `WITH
       -- A ledger entry leaves the unbilled feed when it is billed onto an invoice
       -- (*.billed), voided by the attorney (billing_entry.voided), or WAIVED by the
       -- attorney (fee.waived, HOTFIX-P17) — each names the source ledger event, so one
       -- NOT EXISTS handles them all. (A fee.waived that names no source_event_id is a
       -- waive of an ORPHANED fee that never accrued — it was never on this feed.)
       billed AS (
         SELECT e.payload->>'source_event_id' AS sid
         FROM event e JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
         WHERE e.tenant_id = $1
           AND ekd.kind_name IN ('time.billed','expense.billed','service_fee.billed','document_fee.billed','billing_entry.voided','fee.waived')
           AND e.payload->>'source_event_id' IS NOT NULL
       ),
       matter_of AS (
         SELECT id FROM relationship_kind_definition
         WHERE tenant_id = $1 AND kind_name = 'matter_of' AND status = 'active' LIMIT 1
       )
       SELECT
         e.id AS event_id,
         ekd.kind_name AS kind,
         m.id AS matter_id,
         m.name AS matter_number,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = m.id AND akd.kind_name = 'matter_summary' ORDER BY a.valid_from DESC LIMIT 1) AS matter_summary,
         cli.id AS client_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = cli.id AND akd.kind_name = 'client_name' ORDER BY a.valid_from DESC LIMIT 1)          AS client_name,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = cli.id AND akd.kind_name = 'client_billable_rate' ORDER BY a.valid_from DESC LIMIT 1) AS billable_rate,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = cli.id AND akd.kind_name = 'client_billing_type' ORDER BY a.valid_from DESC LIMIT 1)  AS billing_type,
         -- The matter's contact (client_of: contact -> matter). For an ORPHANED
         -- matter (no client parent), this lets the UI offer a one-click "set up
         -- billing" that creates the client from this contact. LIMIT 1 keeps the
         -- ledger row from multiplying when a matter has more than one contact.
         (SELECT co.source_entity_id FROM relationship co
            JOIN relationship_kind_definition cok ON cok.id = co.relationship_kind_id
           WHERE co.tenant_id = $1 AND co.target_entity_id = m.id AND cok.kind_name = 'client_of'
             AND (co.valid_to IS NULL OR co.valid_to > now()) LIMIT 1) AS contact_id,
         (SELECT COALESCE(
            (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = c2.cid AND akd.kind_name = 'contact_full_name' ORDER BY a.valid_from DESC LIMIT 1),
            (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = c2.cid AND akd.kind_name = 'full_name' ORDER BY a.valid_from DESC LIMIT 1))
          FROM (SELECT co.source_entity_id AS cid FROM relationship co
                  JOIN relationship_kind_definition cok ON cok.id = co.relationship_kind_id
                 WHERE co.tenant_id = $1 AND co.target_entity_id = m.id AND cok.kind_name = 'client_of'
                   AND (co.valid_to IS NULL OR co.valid_to > now()) LIMIT 1) c2) AS contact_name,
         e.payload->>'description'      AS description,
         e.payload->>'duration_minutes' AS duration_minutes,
         e.payload->>'amount'           AS amount,
         COALESCE(e.payload->>'worked_date', e.payload->>'incurred_date') AS entry_date
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       JOIN entity m ON m.id = e.primary_entity_id AND m.tenant_id = e.tenant_id
       LEFT JOIN relationship r ON r.source_entity_id = m.id AND r.tenant_id = e.tenant_id
         AND r.relationship_kind_id = (SELECT id FROM matter_of)
         AND (r.valid_to IS NULL OR r.valid_to > now())
       LEFT JOIN entity cli ON cli.id = r.target_entity_id AND cli.status = 'active'
       WHERE e.tenant_id = $1
         AND ekd.kind_name IN ('time.logged','expense.recorded','service_fee.recorded','document_fee.recorded')
         AND NOT EXISTS (SELECT 1 FROM billed b WHERE b.sid = e.id::text)
       ORDER BY client_name NULLS LAST, m.name, e.occurred_at`,
      [ctx.tenantId],
    )

    // Group by client → matter, pricing each entry.
    const byClient = new Map<string, UnbilledClient>()
    for (const r of res.rows) {
      const clientKey = r.client_id ?? '__none__'
      let c = byClient.get(clientKey)
      if (!c) {
        c = {
          clientEntityId: r.client_id,
          clientName: r.client_name ?? 'Unassigned client',
          billableRate: r.billable_rate,
          billingType: r.billing_type,
          matters: [],
          total: '0.00',
        }
        byClient.set(clientKey, c)
      }
      let m = c.matters.find((x) => x.matterEntityId === r.matter_id)
      if (!m) {
        m = {
          matterEntityId: r.matter_id,
          matterNumber: r.matter_number,
          matterSummary: r.matter_summary,
          contactEntityId: r.contact_id,
          contactName: r.contact_name,
          entries: [],
          total: '0.00',
        }
        c.matters.push(m)
      }

      let entry: UnbilledEntry
      if (r.kind === 'time.logged') {
        const minutes = Number(r.duration_minutes ?? '0')
        // Client rate first, then the firm default fallback (matches the invoice
        // handler). null only when neither is set — the UI then prompts per line.
        const rate = r.billable_rate ?? firmDefaultRate
        if (rate) {
          const { quantity, amountCents } = priceTime(minutes, rate)
          entry = {
            kind: 'time',
            sourceEventId: r.event_id,
            date: r.entry_date,
            description: r.description ?? '',
            durationMinutes: minutes,
            quantity,
            rate: centsToAmount(amountToCents(rate)),
            amount: centsToAmount(amountCents),
          }
        } else {
          entry = {
            kind: 'time',
            sourceEventId: r.event_id,
            date: r.entry_date,
            description: r.description ?? '',
            durationMinutes: minutes,
            quantity: (Math.round((minutes * 100) / 60) / 100).toFixed(2),
            rate: null,
            amount: null,
          }
        }
      } else if (r.kind === 'service_fee.recorded' || r.kind === 'document_fee.recorded') {
        // A flat service or document fee. Always carries its own amount — no
        // client-rate lookup. Service fee accrues when the service is completed;
        // document fee when a document is approved (one per document kind).
        const isDoc = r.kind === 'document_fee.recorded'
        const amt = centsToAmount(amountToCents(r.amount ?? '0'))
        entry = {
          kind: isDoc ? 'document_fee' : 'service_fee',
          sourceEventId: r.event_id,
          date: r.entry_date,
          description: r.description ?? (isDoc ? 'Document fee' : 'Service fee'),
          durationMinutes: null,
          quantity: '1',
          rate: amt,
          amount: amt,
        }
      } else {
        const amt = centsToAmount(amountToCents(r.amount ?? '0'))
        entry = {
          kind: 'expense',
          sourceEventId: r.event_id,
          date: r.entry_date,
          description: r.description ?? '',
          durationMinutes: null,
          quantity: '1',
          rate: amt,
          amount: amt,
        }
      }
      m.entries.push(entry)
    }

    // Inject the VIRTUAL task lines (done + costed + un-invoiced) into the same
    // client -> matter groups. sourceEventId is prefixed `task:` so the UI can
    // select it and invoice.issue routes it to the materialise-and-lock path.
    for (const t of await listBillableTasks(client, ctx.tenantId)) {
      if (!t.matter_id) continue
      const clientKey = t.client_id ?? '__none__'
      let c = byClient.get(clientKey)
      if (!c) {
        c = {
          clientEntityId: t.client_id,
          clientName: t.client_name ?? 'Unassigned client',
          billableRate: t.billable_rate,
          billingType: t.billing_type,
          matters: [],
          total: '0.00',
        }
        byClient.set(clientKey, c)
      }
      let m = c.matters.find((x) => x.matterEntityId === t.matter_id)
      if (!m) {
        m = {
          matterEntityId: t.matter_id,
          matterNumber: t.matter_number ?? '',
          matterSummary: t.matter_summary,
          contactEntityId: t.contact_id,
          contactName: t.contact_name,
          entries: [],
          total: '0.00',
        }
        c.matters.push(m)
      }
      const source = `task:${t.task_id}`
      const label = (t.title ?? 'Task').trim() || 'Task'
      if (t.billing_mode === 'fixed') {
        const amt = centsToAmount(amountToCents(t.fee_amount ?? '0'))
        m.entries.push({
          kind: 'service_fee',
          sourceEventId: source,
          date: null,
          description: label,
          durationMinutes: null,
          quantity: '1',
          rate: amt,
          amount: amt,
        })
      } else {
        // hours
        const hours = Number(t.hours ?? '0')
        const minutes = Math.round(hours * 60)
        const rate = t.billable_rate ?? firmDefaultRate
        if (rate && minutes > 0) {
          const { quantity, amountCents } = priceTime(minutes, rate)
          m.entries.push({
            kind: 'time',
            sourceEventId: source,
            date: null,
            description: label,
            durationMinutes: minutes,
            quantity,
            rate: centsToAmount(amountToCents(rate)),
            amount: centsToAmount(amountCents),
          })
        } else {
          m.entries.push({
            kind: 'time',
            sourceEventId: source,
            date: null,
            description: label,
            durationMinutes: minutes,
            quantity: (minutes / 60).toFixed(2),
            rate: null,
            amount: null,
          })
        }
      }
    }

    // Roll up totals (entries with a null amount don't count toward the total).
    let grand = 0
    const clients = [...byClient.values()]
    for (const c of clients) {
      let clientCents = 0
      for (const m of c.matters) {
        const matterCents = m.entries.reduce(
          (s, e) => s + (e.amount ? amountToCents(e.amount) : 0),
          0,
        )
        m.total = centsToAmount(matterCents)
        clientCents += matterCents
      }
      c.total = centsToAmount(clientCents)
      grand += clientCents
    }
    void grand
    return { clients, currency: 'USD' }
  })
}

export interface InvoiceSummary {
  invoiceEntityId: string
  invoiceNumber: string
  status: string
  clientName: string
  total: string
  currency: string
  issuedDate: string | null
  lineCount: number
  createdAt: string
}

export async function listInvoices(ctx: ActionContext): Promise<InvoiceSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      invoice_id: string
      number: string | null
      status: string | null
      client_name: string | null
      total: string | null
      currency: string | null
      issued_date: string | null
      line_count: string
      created_at: Date
    }>(
      `
       SELECT e.id AS invoice_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_number' ORDER BY a.valid_from DESC LIMIT 1)   AS number,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_status' ORDER BY a.valid_from DESC LIMIT 1)   AS status,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_total' ORDER BY a.valid_from DESC LIMIT 1)    AS total,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_currency' ORDER BY a.valid_from DESC LIMIT 1) AS currency,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_issued_date' ORDER BY a.valid_from DESC LIMIT 1) AS issued_date,
         (SELECT (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = r.target_entity_id AND akd.kind_name = 'client_name' ORDER BY a.valid_from DESC LIMIT 1)
            FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.tenant_id = $1 AND r.source_entity_id = e.id AND rkd.kind_name = 'invoice_of'
              AND (r.valid_to IS NULL OR r.valid_to > now()) LIMIT 1) AS client_name,
         (SELECT count(*) FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id AND rkd.kind_name = 'line_of'
              AND (r.valid_to IS NULL OR r.valid_to > now()))::text AS line_count,
         e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'invoice' AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => ({
      invoiceEntityId: r.invoice_id,
      invoiceNumber: r.number ?? '(draft)',
      status: r.status ?? 'draft',
      clientName: r.client_name ?? '',
      total: r.total ?? '0.00',
      currency: r.currency ?? 'USD',
      issuedDate: r.issued_date,
      lineCount: Number(r.line_count),
      createdAt: r.created_at.toISOString(),
    }))
  })
}

export interface InvoiceLine {
  lineEntityId: string
  kind: string
  description: string
  quantity: string
  rate: string
  amount: string
  sourceEventId: string | null
  matterNumber: string | null
}
export interface InvoiceDetail extends InvoiceSummary {
  clientEntityId: string | null
  matterEntityId: string | null
  dueDate: string | null
  notes: string | null
  lines: InvoiceLine[]
}

export async function getInvoice(
  ctx: ActionContext,
  invoiceEntityId: string,
): Promise<InvoiceDetail | null> {
  return withActionContext(ctx, async (client) => {
    const head = await client.query<{
      invoice_id: string
      number: string | null
      status: string | null
      client_id: string | null
      matter_id: string | null
      total: string | null
      currency: string | null
      issued_date: string | null
      due_date: string | null
      notes: string | null
      client_name: string | null
      created_at: Date
    }>(
      `
       SELECT e.id AS invoice_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_number' ORDER BY a.valid_from DESC LIMIT 1)      AS number,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_status' ORDER BY a.valid_from DESC LIMIT 1)      AS status,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_client_id' ORDER BY a.valid_from DESC LIMIT 1)   AS client_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_matter_id' ORDER BY a.valid_from DESC LIMIT 1)   AS matter_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_total' ORDER BY a.valid_from DESC LIMIT 1)       AS total,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_currency' ORDER BY a.valid_from DESC LIMIT 1)    AS currency,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_issued_date' ORDER BY a.valid_from DESC LIMIT 1) AS issued_date,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_due_date' ORDER BY a.valid_from DESC LIMIT 1)    AS due_date,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'invoice_notes' ORDER BY a.valid_from DESC LIMIT 1)       AS notes,
         (SELECT (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = r.target_entity_id AND akd.kind_name = 'client_name' ORDER BY a.valid_from DESC LIMIT 1)
            FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.tenant_id = $1 AND r.source_entity_id = e.id AND rkd.kind_name = 'invoice_of'
              AND (r.valid_to IS NULL OR r.valid_to > now()) LIMIT 1) AS client_name,
         e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'invoice' AND e.status = 'active'`,
      [ctx.tenantId, invoiceEntityId],
    )
    const h = head.rows[0]
    if (!h) return null

    const linesRes = await client.query<{
      line_id: string
      kind: string | null
      description: string | null
      quantity: string | null
      rate: string | null
      amount: string | null
      source_event_id: string | null
      matter_number: string | null
    }>(
      `
       SELECT le.id AS line_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_kind' ORDER BY a.valid_from DESC LIMIT 1)            AS kind,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_description' ORDER BY a.valid_from DESC LIMIT 1)     AS description,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_quantity' ORDER BY a.valid_from DESC LIMIT 1)        AS quantity,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_rate' ORDER BY a.valid_from DESC LIMIT 1)            AS rate,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_amount' ORDER BY a.valid_from DESC LIMIT 1)          AS amount,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_source_event_id' ORDER BY a.valid_from DESC LIMIT 1) AS source_event_id,
         (SELECT m.name FROM entity m
            WHERE m.id = (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_matter_id' ORDER BY a.valid_from DESC LIMIT 1)::uuid) AS matter_number
       FROM entity le
       JOIN relationship r ON r.source_entity_id = le.id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'line_of'
         AND (r.valid_to IS NULL OR r.valid_to > now()) AND le.status = 'active'
       ORDER BY le.created_at`,
      [ctx.tenantId, invoiceEntityId],
    )

    return {
      invoiceEntityId: h.invoice_id,
      invoiceNumber: h.number ?? '(draft)',
      status: h.status ?? 'draft',
      clientEntityId: h.client_id,
      clientName: h.client_name ?? '',
      matterEntityId: h.matter_id,
      total: h.total ?? '0.00',
      currency: h.currency ?? 'USD',
      issuedDate: h.issued_date,
      dueDate: h.due_date,
      notes: h.notes,
      lineCount: linesRes.rows.length,
      createdAt: h.created_at.toISOString(),
      lines: linesRes.rows.map((r) => ({
        lineEntityId: r.line_id,
        kind: r.kind ?? '',
        description: r.description ?? '',
        quantity: r.quantity ?? '0',
        rate: r.rate ?? '0.00',
        amount: r.amount ?? '0.00',
        sourceEventId: r.source_event_id,
        matterNumber: r.matter_number,
      })),
    }
  })
}

export interface MatterInvoicedItem {
  lineEntityId: string
  kind: string
  description: string
  quantity: string
  rate: string
  amount: string
  invoiceEntityId: string
  invoiceNumber: string
  invoiceStatus: string
  issuedDate: string | null
}

// The INVOICED (already-billed) line items for one matter — the counterpart to the
// unbilled feed, so the matter Billing tab shows both what's outstanding and what's
// been invoiced, with each invoice's status. Lines carry line_matter_id = this
// matter and link to their invoice (line_of) for the number + status.
export async function listMatterInvoiced(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<{ items: MatterInvoicedItem[]; currency: string }> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      line_id: string
      kind: string | null
      description: string | null
      quantity: string | null
      rate: string | null
      amount: string | null
      invoice_id: string
      invoice_number: string | null
      invoice_status: string | null
      currency: string | null
      issued_date: string | null
    }>(
      `
       SELECT le.id AS line_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_kind' ORDER BY a.valid_from DESC LIMIT 1)        AS kind,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_description' ORDER BY a.valid_from DESC LIMIT 1) AS description,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_quantity' ORDER BY a.valid_from DESC LIMIT 1)    AS quantity,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_rate' ORDER BY a.valid_from DESC LIMIT 1)        AS rate,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_amount' ORDER BY a.valid_from DESC LIMIT 1)      AS amount,
         inv.id AS invoice_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = inv.id AND akd.kind_name = 'invoice_number' ORDER BY a.valid_from DESC LIMIT 1)      AS invoice_number,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = inv.id AND akd.kind_name = 'invoice_status' ORDER BY a.valid_from DESC LIMIT 1)      AS invoice_status,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = inv.id AND akd.kind_name = 'invoice_currency' ORDER BY a.valid_from DESC LIMIT 1)    AS currency,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = inv.id AND akd.kind_name = 'invoice_issued_date' ORDER BY a.valid_from DESC LIMIT 1) AS issued_date
       FROM entity le
       JOIN relationship r ON r.source_entity_id = le.id AND r.tenant_id = $1
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'line_of'
       JOIN entity inv ON inv.id = r.target_entity_id AND inv.status = 'active'
       WHERE le.tenant_id = $1 AND le.status = 'active'
         AND (r.valid_to IS NULL OR r.valid_to > now())
         AND (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = le.id AND akd.kind_name = 'line_matter_id' ORDER BY a.valid_from DESC LIMIT 1) = $2
       ORDER BY inv.created_at DESC, le.created_at`,
      [ctx.tenantId, matterEntityId],
    )
    const currency = res.rows.find((r) => r.currency)?.currency ?? 'USD'
    return {
      currency,
      items: res.rows.map((r) => ({
        lineEntityId: r.line_id,
        kind: r.kind ?? '',
        description: r.description ?? '',
        quantity: r.quantity ?? '0',
        rate: r.rate ?? '0.00',
        amount: r.amount ?? '0.00',
        invoiceEntityId: r.invoice_id,
        invoiceNumber: r.invoice_number ?? '(draft)',
        invoiceStatus: r.invoice_status ?? 'draft',
        issuedDate: r.issued_date,
      })),
    }
  })
}
