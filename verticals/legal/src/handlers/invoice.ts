import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import {
  lookupKindId,
  insertEntity,
  insertAttribute,
  insertRelationship,
  insertEvent,
  getLatestAttributeValue,
} from './common.js'
import { readFirmDefaultRate } from './firmSettings.js'

// ───────────────────────────────────────────────────────────────────────────
// Billing handlers (Session 4): invoice.issue + invoice.send.
//
// Time and expenses are NOT entities here — they are the immutable time.logged /
// expense.recorded ledger events (migration 0018). This handler ROLLS THEM UP:
// it reads the selected unbilled events, creates an invoice + one invoice_line
// per event, links each line to its source event via the line_source_event_id
// attribute (the "billed_on" link — the source is an event, not an entity, so it
// can't be a relationship), and marks each source billed with a NEW time.billed /
// expense.billed event (append-only; never an in-place mutation — ADR 0039).
//
// Money discipline (ADR 0044): amounts are decimal STRINGS; all arithmetic is in
// integer cents so there is no floating-point drift.
// ───────────────────────────────────────────────────────────────────────────

const INVOICE_KIND = 'invoice'
const INVOICE_LINE_KIND = 'invoice_line'

// Exact decimal-string → integer cents (mirrors api/timeExpense.amountToCents).
// Accepts "150", "150.5", "150.50". Throws on anything else.
function amountToCents(amount: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim())
  if (!m) throw new Error(`Invalid amount "${amount}" — use digits like 150 or 150.00.`)
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

function centsToAmount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

interface IssueLineSpec {
  source_event_id: string
  kind: 'time' | 'expense' | 'service_fee' | 'document_fee'
  // Optional per-line overrides; rate defaults to the client's billable rate,
  // description defaults to the source entry's description.
  rate_override?: string | null
  description_override?: string | null
}

interface IssueInvoicePayload {
  client_entity_id: string
  matter_entity_id?: string | null
  currency?: string | null
  due_date?: string | null
  notes?: string | null
  lines: IssueLineSpec[]
}

// One resolved, priced line ready to write.
interface PricedLine {
  sourceEventId: string
  kind: 'time' | 'expense' | 'service_fee' | 'document_fee'
  matterId: string
  description: string
  quantity: string // hours (time) or "1" (expense)
  rate: string // hourly rate (time) or the expense amount (expense)
  amountCents: number
}

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

// Has this ledger event already been billed onto some invoice line?
async function isAlreadyBilled(
  client: DbClient,
  tenantId: string,
  sourceEventId: string,
): Promise<boolean> {
  const res = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
      WHERE e.tenant_id = $1
        AND ekd.kind_name IN ('time.billed', 'expense.billed', 'service_fee.billed', 'document_fee.billed')
        AND e.payload->>'source_event_id' = $2`,
    [tenantId, sourceEventId],
  )
  return Number(res.rows[0]?.n ?? '0') > 0
}

// Read one ledger event's kind + payload, scoped to the tenant.
async function loadSourceEvent(
  client: DbClient,
  tenantId: string,
  eventId: string,
): Promise<{ kindName: string; matterId: string | null; payload: Record<string, unknown> } | null> {
  const res = await client.query<{
    kind_name: string
    primary_entity_id: string | null
    payload: Record<string, unknown>
  }>(
    `SELECT ekd.kind_name, e.primary_entity_id, e.payload
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
      WHERE e.tenant_id = $1 AND e.id = $2::uuid`,
    [tenantId, eventId],
  )
  const r = res.rows[0]
  if (!r) return null
  return { kindName: r.kind_name, matterId: r.primary_entity_id, payload: r.payload ?? {} }
}

// Distinct matter ids an invoice touches, read from its lines' line_matter_id.
// Lets the invoice lifecycle events (sent/paid) name the matter(s) as secondary
// entities so a matter-scoped timeline (getMatterHistory) sees them natively —
// invoice.issued/sent/paid are primary=invoice, so without this the matter can't
// observe them.
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

// hours = round(minutes / 60, 2); amount = round(hours * rate). Billing on
// 2-dp hours keeps quantity x rate === amount exactly to the cent on the invoice.
function priceTimeLine(
  minutes: number,
  rateStr: string,
): { quantity: string; amountCents: number } {
  const hoursHundredths = Math.round((minutes * 100) / 60) // hours in 1/100ths
  const rateCents = amountToCents(rateStr)
  const amountCents = Math.round((hoursHundredths * rateCents) / 100)
  return { quantity: (hoursHundredths / 100).toFixed(2), amountCents }
}

async function priceLine(
  client: DbClient,
  tenantId: string,
  spec: IssueLineSpec,
  defaultRate: string | null,
): Promise<PricedLine> {
  if (await isAlreadyBilled(client, tenantId, spec.source_event_id)) {
    throw new Error(`Entry ${spec.source_event_id} is already billed.`)
  }
  const src = await loadSourceEvent(client, tenantId, spec.source_event_id)
  if (!src) throw new Error(`Source entry ${spec.source_event_id} not found.`)
  if (!src.matterId) throw new Error(`Source entry ${spec.source_event_id} has no matter.`)

  if (spec.kind === 'time') {
    if (src.kindName !== 'time.logged')
      throw new Error(`Entry ${spec.source_event_id} is not a time entry.`)
    const minutes = Number((src.payload as { duration_minutes?: number }).duration_minutes ?? 0)
    if (!(minutes > 0)) throw new Error(`Time entry ${spec.source_event_id} has no duration.`)
    const rate = (spec.rate_override ?? defaultRate ?? '').trim()
    if (!rate)
      throw new Error(
        `No billable rate for entry ${spec.source_event_id}; set the client rate or a per-line rate.`,
      )
    const { quantity, amountCents } = priceTimeLine(minutes, rate)
    return {
      sourceEventId: spec.source_event_id,
      kind: 'time',
      matterId: src.matterId,
      description:
        (
          spec.description_override ??
          (src.payload as { description?: string }).description ??
          ''
        ).trim() || 'Legal services',
      quantity,
      rate: centsToAmount(amountToCents(rate)),
      amountCents,
    }
  }

  if (spec.kind === 'service_fee' || spec.kind === 'document_fee') {
    const expectedKind =
      spec.kind === 'document_fee' ? 'document_fee.recorded' : 'service_fee.recorded'
    if (src.kindName !== expectedKind)
      throw new Error(`Entry ${spec.source_event_id} is not a ${spec.kind.replace('_', ' ')}.`)
    const amount = String((src.payload as { amount?: string }).amount ?? '0')
    const amountCents = amountToCents(amount)
    if (!(amountCents > 0)) throw new Error(`Fee ${spec.source_event_id} has no amount.`)
    return {
      sourceEventId: spec.source_event_id,
      kind: spec.kind,
      matterId: src.matterId,
      description:
        (
          spec.description_override ??
          (src.payload as { description?: string }).description ??
          ''
        ).trim() || (spec.kind === 'document_fee' ? 'Document fee' : 'Service fee'),
      quantity: '1',
      rate: centsToAmount(amountCents),
      amountCents,
    }
  }

  // expense
  if (src.kindName !== 'expense.recorded')
    throw new Error(`Entry ${spec.source_event_id} is not an expense.`)
  const amount = String((src.payload as { amount?: string }).amount ?? '0')
  const amountCents = amountToCents(amount)
  return {
    sourceEventId: spec.source_event_id,
    kind: 'expense',
    matterId: src.matterId,
    description:
      (
        spec.description_override ??
        (src.payload as { description?: string }).description ??
        ''
      ).trim() || 'Expense',
    quantity: '1',
    rate: centsToAmount(amountCents),
    amountCents,
  }
}

// Sequential invoice number per tenant: INV-<year>-<NNNN>. Single-firm pilot, so a
// count-based sequence is fine (no concurrent issuing).
async function nextInvoiceNumber(client: DbClient, tenantId: string): Promise<string> {
  const res = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
      WHERE e.tenant_id = $1 AND ekd.kind_name = '${INVOICE_KIND}'`,
    [tenantId],
  )
  const seq = Number(res.rows[0]?.n ?? '0') + 1
  return `INV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`
}

// ── Task billing (migration 0084) ─────────────────────────────────────────────
// A line whose source_event_id is `task:<id>` bills a matter TASK. The task is a
// VIRTUAL unbilled line until now; we MATERIALISE it into a real ledger event
// (time.logged for hours, service_fee.recorded for fixed) tagged with the task, so
// the rest of invoice.issue prices + bills it exactly like any other entry. The
// task is then LOCKED (task_invoice_id) so it can't be billed twice or un-billed
// by moving it back. Append-only throughout — no event is ever mutated.
const TASK_SOURCE_PREFIX = 'task:'

interface MaterialisedTask {
  taskId: string
  spec: IssueLineSpec // rewritten to point at the freshly-created ledger event
}

async function materialiseTaskLine(
  client: DbClient,
  ctx: { tenantId: string; actorId: string },
  actionId: string,
  spec: IssueLineSpec,
): Promise<MaterialisedTask> {
  const taskId = spec.source_event_id.slice(TASK_SOURCE_PREFIX.length)
  const res = await client.query<{
    status: string | null
    billing_mode: string | null
    hours: string | null
    fee_amount: string | null
    title: string | null
    invoice_id: string | null
    matter_id: string | null
  }>(
    `WITH attrs AS (
       SELECT DISTINCT ON (a.entity_id, akd.kind_name) a.entity_id, akd.kind_name, a.value
       FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2 ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC),
     task_of AS (SELECT id FROM relationship_kind_definition
                  WHERE tenant_id = $1 AND kind_name = 'task_of' AND status = 'active' LIMIT 1)
     SELECT
       (SELECT value #>> '{}' FROM attrs WHERE kind_name = 'task_status')       AS status,
       (SELECT value #>> '{}' FROM attrs WHERE kind_name = 'task_billing_mode') AS billing_mode,
       (SELECT value #>> '{}' FROM attrs WHERE kind_name = 'task_hours')        AS hours,
       (SELECT value #>> '{}' FROM attrs WHERE kind_name = 'task_fee_amount')   AS fee_amount,
       (SELECT value #>> '{}' FROM attrs WHERE kind_name = 'task_title')        AS title,
       (SELECT value #>> '{}' FROM attrs WHERE kind_name = 'task_invoice_id')   AS invoice_id,
       (SELECT r.target_entity_id FROM relationship r
          WHERE r.tenant_id = $1 AND r.source_entity_id = $2
            AND r.relationship_kind_id = (SELECT id FROM task_of)
            AND (r.valid_to IS NULL OR r.valid_to > now()) LIMIT 1)             AS matter_id`,
    [ctx.tenantId, taskId],
  )
  const t = res.rows[0]
  if (!t || !t.matter_id) throw new Error(`Task ${taskId} not found.`)
  const desc = (t.title ?? 'Task').trim() || 'Task'
  if (t.invoice_id) throw new Error(`Task "${desc}" is already on an invoice.`)
  if (t.status !== 'done') throw new Error(`Task "${desc}" must be done before it can be billed.`)

  let eventKindName: 'time.logged' | 'service_fee.recorded'
  let data: Record<string, unknown>
  if (t.billing_mode === 'hours') {
    const hours = Number(t.hours ?? '0')
    if (!(hours > 0)) throw new Error(`Task "${desc}" has no hours to bill.`)
    eventKindName = 'time.logged'
    data = {
      duration_minutes: Math.round(hours * 60),
      description: desc,
      worked_date: new Date().toISOString().slice(0, 10),
    }
  } else if (t.billing_mode === 'fixed') {
    const fee = String(t.fee_amount ?? '0')
    if (!(amountToCents(fee) > 0)) throw new Error(`Task "${desc}" has no fee to bill.`)
    eventKindName = 'service_fee.recorded'
    data = { amount: fee, description: desc }
  } else {
    throw new Error(`Task "${desc}" has no billable cost.`)
  }

  const eventId = await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName,
    primaryEntityId: t.matter_id,
    secondaryEntityIds: [taskId],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data,
  })

  return {
    taskId,
    spec: {
      source_event_id: eventId,
      kind: eventKindName === 'time.logged' ? 'time' : 'service_fee',
      rate_override: spec.rate_override,
      description_override: spec.description_override,
    },
  }
}

registerActionHandler('invoice.issue', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as IssueInvoicePayload
  const clientEntityId = (p.client_entity_id ?? '').trim()
  if (!clientEntityId) throw new Error('client_entity_id is required.')
  if (!Array.isArray(p.lines) || p.lines.length === 0) {
    throw new Error('Select at least one unbilled time or expense entry to invoice.')
  }
  // Reject a payload that repeats one source entry: isAlreadyBilled only catches
  // CROSS-invoice re-billing (the *.billed marker isn't written until the write
  // loop), so two identical source_event_ids in one payload would otherwise both
  // price and double the total. Throw rather than collapse (append-only).
  const sourceIds = p.lines.map((l) => l.source_event_id)
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error(
      'A time or expense entry appears twice in this invoice; each can be billed once.',
    )
  }

  // Materialise any `task:<id>` lines into real ledger events first, so the rest
  // of the handler prices + bills them like any other entry. Collect the task ids
  // to LOCK once the invoice exists.
  const materialisedTasks: MaterialisedTask[] = []
  const lines: IssueLineSpec[] = []
  for (const spec of p.lines) {
    if (spec.source_event_id.startsWith(TASK_SOURCE_PREFIX)) {
      const mt = await materialiseTaskLine(client, ctx, actionId, spec)
      materialisedTasks.push(mt)
      lines.push(mt.spec)
    } else {
      lines.push(spec)
    }
  }

  // Contract K (Session 7): the per-line default rate is the client's explicit
  // client_billable_rate, falling back to the firm default when the client has
  // none. A per-line rate_override still wins over both (priceLine).
  const clientRate = await getLatestAttributeValue<string>(
    client,
    ctx.tenantId,
    clientEntityId,
    'client_billable_rate',
  )
  const defaultRate = clientRate ?? (await readFirmDefaultRate(client, ctx.tenantId))

  // Resolve + price every line first (also validates each source is unbilled).
  // `lines` = the event lines plus the now-materialised task lines.
  const priced: PricedLine[] = []
  for (const spec of lines) {
    priced.push(await priceLine(client, ctx.tenantId, spec, defaultRate))
  }
  const totalCents = priced.reduce((sum, l) => sum + l.amountCents, 0)
  const currency = (p.currency ?? 'USD').trim().toUpperCase()
  const invoiceNumber = await nextInvoiceNumber(client, ctx.tenantId)
  const issuedDate = new Date().toISOString().slice(0, 10)

  // ── Invoice header ──────────────────────────────────────────────────────────
  const invoiceKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    INVOICE_KIND,
  )
  const invoiceId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    invoiceKindId,
    invoiceNumber,
    {},
  )
  const setHeader = (kind: string, value: unknown) =>
    setAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: invoiceId,
      kind,
      value,
    })
  await setHeader('invoice_number', invoiceNumber)
  await setHeader('invoice_status', 'issued')
  await setHeader('invoice_client_id', clientEntityId)
  if (p.matter_entity_id) await setHeader('invoice_matter_id', p.matter_entity_id)
  await setHeader('invoice_total', centsToAmount(totalCents))
  await setHeader('invoice_currency', currency)
  await setHeader('invoice_issued_date', issuedDate)
  if (p.due_date) await setHeader('invoice_due_date', p.due_date)
  if (p.notes && String(p.notes).trim()) await setHeader('invoice_notes', String(p.notes).trim())

  // invoice → client (substrate-native parent pointer)
  const invoiceOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'invoice_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: invoiceId,
    targetEntityId: clientEntityId,
    relationshipKindId: invoiceOfId,
  })

  // LOCK each billed task to this invoice (task_invoice_id) — it stops showing as
  // unbilled and can no longer be billed again or un-billed by moving it back. The
  // materialised ledger event it produced is billed below like any other line.
  for (const mt of materialisedTasks) {
    await setAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: mt.taskId,
      kind: 'task_invoice_id',
      value: invoiceId,
    })
  }

  // ── Lines + billed events ─────────────────────────────────────────────────────
  const lineOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'line_of',
  )
  const invoiceLineKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    INVOICE_LINE_KIND,
  )
  for (const l of priced) {
    const lineAmount = centsToAmount(l.amountCents)
    const lineId = await insertEntity(
      client,
      ctx.tenantId,
      actionId,
      invoiceLineKindId,
      `${invoiceNumber} · ${l.kind}`,
      {},
    )
    const setLine = (kind: string, value: unknown) =>
      setAttr(client, {
        tenantId: ctx.tenantId,
        actionId,
        actorId: ctx.actorId,
        entityId: lineId,
        kind,
        value,
      })
    await setLine('line_invoice_id', invoiceId)
    await setLine('line_kind', l.kind)
    await setLine('line_source_event_id', l.sourceEventId)
    await setLine('line_description', l.description)
    await setLine('line_quantity', l.quantity)
    await setLine('line_rate', l.rate)
    await setLine('line_amount', lineAmount)
    await setLine('line_matter_id', l.matterId)
    await insertRelationship(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceEntityId: lineId,
      targetEntityId: invoiceId,
      relationshipKindId: lineOfId,
    })
    // Mark the source ledger entry billed — a NEW event, never a mutation (ADR 0039).
    await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName:
        l.kind === 'time'
          ? 'time.billed'
          : l.kind === 'service_fee'
            ? 'service_fee.billed'
            : l.kind === 'document_fee'
              ? 'document_fee.billed'
              : 'expense.billed',
      primaryEntityId: l.matterId,
      secondaryEntityIds: [invoiceId, lineId],
      sourceType: 'human',
      sourceRef: ctx.actorId,
      data: {
        source_event_id: l.sourceEventId,
        invoice_id: invoiceId,
        invoice_line_id: lineId,
        amount: lineAmount,
      },
    })
  }

  // ── Invoice issued (lifecycle event) ─────────────────────────────────────────
  // Secondary names the client AND every matter the lines touch, so a matter's
  // timeline (getMatterHistory) sees "invoice created" without joining through
  // the *.billed events.
  const issuedMatterIds = [...new Set(priced.map((l) => l.matterId))]
  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'invoice.issued',
    primaryEntityId: invoiceId,
    secondaryEntityIds: [clientEntityId, ...issuedMatterIds],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: { total: centsToAmount(totalCents), currency, line_count: priced.length },
  })

  return {
    invoiceEntityId: invoiceId,
    invoiceNumber,
    total: centsToAmount(totalCents),
    currency,
    lineCount: priced.length,
  }
})

interface SendInvoicePayload {
  invoice_entity_id: string
  // The actual email send happens in api/billing.sendInvoice through Contract B
  // (enqueueClientEmail); this handler RECORDS the result. `delivered` reflects
  // whether the email actually went out (false only if a caller records a send
  // attempt without delivery).
  to?: string | null
  message_id?: string | null
  delivered?: boolean
  pay_url?: string | null
}

// Record an invoice send (invoice.sent event + status='sent') through the core.
// The email itself is sent by the api layer via Contract B and its mail.send audit
// row; this is the invoice-lifecycle record that references it.
registerActionHandler('invoice.send', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as SendInvoicePayload
  const invoiceId = (p.invoice_entity_id ?? '').trim()
  if (!invoiceId) throw new Error('invoice_entity_id is required.')

  const number = await getLatestAttributeValue<string>(
    client,
    ctx.tenantId,
    invoiceId,
    'invoice_number',
  )
  const status = await getLatestAttributeValue<string>(
    client,
    ctx.tenantId,
    invoiceId,
    'invoice_status',
  )
  const clientEntityId = await getLatestAttributeValue<string>(
    client,
    ctx.tenantId,
    invoiceId,
    'invoice_client_id',
  )
  if (!number || !status) throw new Error('Invoice not found.')
  if (status !== 'issued' && status !== 'sent') {
    throw new Error(`Invoice ${number} is ${status}; only issued invoices can be sent.`)
  }

  const delivered = p.delivered !== false
  const matterIds = await loadInvoiceMatterIds(client, ctx.tenantId, invoiceId)

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'invoice.sent',
    primaryEntityId: invoiceId,
    secondaryEntityIds: [...(clientEntityId ? [clientEntityId] : []), ...matterIds],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: {
      to: (p.to ?? '').trim() || null,
      channel: 'email',
      delivered,
      message_id: p.message_id ?? null,
      pay_url: p.pay_url ?? null,
    },
  })

  await setAttr(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    entityId: invoiceId,
    kind: 'invoice_status',
    value: 'sent',
  })

  return { sent: true, delivered, to: (p.to ?? '').trim() || null, invoiceNumber: number }
})

interface PayInvoicePayload {
  invoice_entity_id: string
  // 'manual' (attorney recorded a payment) or a processor name (a webhook will
  // call this same action later); defaults to 'manual'.
  method?: string | null
  amount?: string | null // decimal string; defaults to the invoice total
  currency?: string | null
  reference?: string | null // check #, processor charge id, etc.
  paid_date?: string | null // YYYY-MM-DD; defaults to today
  note?: string | null
}

// Record a payment against an issued/sent invoice (invoice.paid event +
// invoice_status='paid') through the core. ONE action records payment whatever
// the source: the v1 caller is a manual "Mark paid", a payment processor webhook
// will call the SAME action later with method/reference set. Recording is
// reversible_with_state_decay (no un-pay handler in v1).
registerActionHandler('invoice.pay', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as PayInvoicePayload
  const invoiceId = (p.invoice_entity_id ?? '').trim()
  if (!invoiceId) throw new Error('invoice_entity_id is required.')

  // Serialize all payments of one invoice (manual mark-paid AND pay-from-trust)
  // so two concurrent paths can't both mark it paid (mirrors booking.ts lockSlot;
  // trust.transfer_earned takes the same lock key).
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 42))`, [
    `${ctx.tenantId}|invoice_pay|${invoiceId}`,
  ])

  const get = (kind: string) =>
    getLatestAttributeValue<string>(client, ctx.tenantId, invoiceId, kind)
  const number = await get('invoice_number')
  const status = await get('invoice_status')
  const clientEntityId = await get('invoice_client_id')
  const total = await get('invoice_total')
  const currency = await get('invoice_currency')
  if (!number || !status) throw new Error('Invoice not found.')
  if (status === 'paid') throw new Error(`Invoice ${number} is already marked paid.`)
  if (status !== 'issued' && status !== 'sent') {
    throw new Error(
      `Invoice ${number} is ${status}; only an issued or sent invoice can be marked paid.`,
    )
  }

  const matterIds = await loadInvoiceMatterIds(client, ctx.tenantId, invoiceId)
  const method = (p.method ?? '').trim() || 'manual'
  const amount = (p.amount ?? '').trim() || total || null
  const paidDate = (p.paid_date ?? '').trim() || new Date().toISOString().slice(0, 10)

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'invoice.paid',
    primaryEntityId: invoiceId,
    // Client + every matter the invoice touches, so each matter's timeline sees
    // "Invoice Paid" natively.
    secondaryEntityIds: [...(clientEntityId ? [clientEntityId] : []), ...matterIds],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: {
      method,
      amount,
      currency: (p.currency ?? '').trim() || currency || 'USD',
      reference: (p.reference ?? '').trim() || null,
      paid_date: paidDate,
      note: (p.note ?? '').trim() || null,
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

  return { paid: true, invoiceNumber: number, status: 'paid', method, amount, paidDate }
})
