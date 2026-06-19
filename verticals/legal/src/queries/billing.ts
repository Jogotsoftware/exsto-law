import { withActionContext, type ActionContext } from '@exsto/substrate'

// Billing read-path (Session 4). Bitemporal discipline (exsto-query-substrate):
// current attribute = latest valid_from; relationships current via valid_to open.
//
// "Unbilled" is DERIVED, not stored: a time.logged / expense.recorded ledger event
// (migration 0018) is unbilled when no time.billed / expense.billed event names it
// as source_event_id. Money math is integer-cents (ADR 0044) — no float drift.

// Latest value of every attribute kind for the tenant, keyed (entity, kind).
const ATTRS_CTE = `
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name)
      a.entity_id, akd.kind_name, a.value
    FROM attribute a
    JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = $1
    ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  )`

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
  kind: 'time' | 'expense' | 'service_fee'
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

export async function listUnbilled(
  ctx: ActionContext,
): Promise<{ clients: UnbilledClient[]; currency: string }> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      event_id: string
      kind: string
      matter_id: string
      matter_number: string
      client_id: string | null
      client_name: string | null
      billable_rate: string | null
      billing_type: string | null
      description: string | null
      duration_minutes: string | null
      amount: string | null
      entry_date: string | null
    }>(
      `${ATTRS_CTE},
       billed AS (
         SELECT e.payload->>'source_event_id' AS sid
         FROM event e JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
         WHERE e.tenant_id = $1 AND ekd.kind_name IN ('time.billed','expense.billed','service_fee.billed')
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
         cli.id AS client_id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = cli.id AND kind_name = 'client_name')          AS client_name,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = cli.id AND kind_name = 'client_billable_rate') AS billable_rate,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = cli.id AND kind_name = 'client_billing_type')  AS billing_type,
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
         AND ekd.kind_name IN ('time.logged','expense.recorded','service_fee.recorded')
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
          entries: [],
          total: '0.00',
        }
        c.matters.push(m)
      }

      let entry: UnbilledEntry
      if (r.kind === 'time.logged') {
        const minutes = Number(r.duration_minutes ?? '0')
        const rate = r.billable_rate
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
      } else if (r.kind === 'service_fee.recorded') {
        // An approved document's flat service fee (recorded once per matter on
        // first approval). Always carries its own amount — no client-rate lookup.
        const amt = centsToAmount(amountToCents(r.amount ?? '0'))
        entry = {
          kind: 'service_fee',
          sourceEventId: r.event_id,
          date: r.entry_date,
          description: r.description ?? 'Service fee',
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
      `${ATTRS_CTE}
       SELECT e.id AS invoice_id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_number')   AS number,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_status')   AS status,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_total')    AS total,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_currency') AS currency,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_issued_date') AS issued_date,
         (SELECT (SELECT value #>> '{}' FROM attrs WHERE entity_id = r.target_entity_id AND kind_name = 'client_name')
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
      `${ATTRS_CTE}
       SELECT e.id AS invoice_id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_number')      AS number,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_status')      AS status,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_client_id')   AS client_id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_matter_id')   AS matter_id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_total')       AS total,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_currency')    AS currency,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_issued_date') AS issued_date,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_due_date')    AS due_date,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'invoice_notes')       AS notes,
         (SELECT (SELECT value #>> '{}' FROM attrs WHERE entity_id = r.target_entity_id AND kind_name = 'client_name')
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
      `${ATTRS_CTE}
       SELECT le.id AS line_id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = le.id AND kind_name = 'line_kind')            AS kind,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = le.id AND kind_name = 'line_description')     AS description,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = le.id AND kind_name = 'line_quantity')        AS quantity,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = le.id AND kind_name = 'line_rate')            AS rate,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = le.id AND kind_name = 'line_amount')          AS amount,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = le.id AND kind_name = 'line_source_event_id') AS source_event_id,
         (SELECT m.name FROM entity m
            WHERE m.id = (SELECT value #>> '{}' FROM attrs WHERE entity_id = le.id AND kind_name = 'line_matter_id')::uuid) AS matter_number
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
