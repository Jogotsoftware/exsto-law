import type { ActionContext } from '@exsto/substrate'
import { listUnbilled } from '../queries/billing.js'
import { listClientInvoices, type ClientInvoiceSummary } from '../queries/clientBilling.js'
import { resolveClientMatterIds } from './clientIdentity.js'

// PORTAL-1 (WP2) — the client's Billing view: per matter, the invoices (open +
// paid), the ACCRUING not-yet-invoiced fees, and a running total.
//
// One truth, two renderings: the accrued figure is computed by the SAME
// listUnbilled() the attorney's billing panel uses, filtered to the client's
// matters and projected client-safe (description, date, amount — no rates
// table, no source events, no internal notes). Recorded ledger events ONLY
// (time.logged / expense.recorded / service_fee.recorded / document_fee.recorded);
// an unpriced time entry (no governing rate yet) is EXCLUDED from the client's
// number rather than shown as an estimate — never estimates or projections.

export interface ClientAccruedEntry {
  kind: 'time' | 'expense' | 'service_fee' | 'document_fee'
  date: string | null
  description: string
  amount: string
}

export interface ClientMatterBilling {
  matterEntityId: string
  matterNumber: string
  invoices: ClientInvoiceSummary[]
  accrued: ClientAccruedEntry[]
  /** Sum of accrued (integer-cent math, decimal string out). */
  accruedTotal: string
  /** Open (due) invoice total. */
  dueTotal: string
  paidTotal: string
  /** dueTotal + accruedTotal — what stands against this matter right now. */
  runningTotal: string
}

export interface ClientBillingSummary {
  matters: ClientMatterBilling[]
  currency: string
  totals: { due: string; paid: string; accrued: string; running: string }
}

const cents = (amount: string | null | undefined): number => {
  if (!amount || !/^-?\d+(\.\d+)?$/.test(amount)) return 0
  const [i = '0', f = ''] = amount.split('.')
  const sign = i.startsWith('-') ? -1 : 1
  return sign * (Math.abs(Number(i)) * 100 + Number(f.padEnd(2, '0').slice(0, 2)))
}
const toAmount = (c: number): string => {
  const sign = c < 0 ? '-' : ''
  const abs = Math.abs(c)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

export async function getClientBillingSummary(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ClientBillingSummary> {
  const matterIds = await resolveClientMatterIds(ctx.tenantId, clientContactId)
  const [invoices, unbilled] = await Promise.all([
    listClientInvoices(ctx, clientContactId),
    listUnbilled(ctx),
  ])

  // The attorney readout, narrowed to THIS client's matters.
  const accruedByMatter = new Map<
    string,
    { matterNumber: string; entries: ClientAccruedEntry[]; totalCents: number }
  >()
  for (const uc of unbilled.clients) {
    for (const m of uc.matters) {
      if (!matterIds.includes(m.matterEntityId)) continue
      const bucket = accruedByMatter.get(m.matterEntityId) ?? {
        matterNumber: m.matterNumber,
        entries: [],
        totalCents: 0,
      }
      for (const e of m.entries) {
        if (e.amount == null) continue // unpriced — never shown as an estimate
        bucket.entries.push({
          kind: e.kind,
          date: e.date,
          description: e.description,
          amount: e.amount,
        })
        bucket.totalCents += cents(e.amount)
      }
      accruedByMatter.set(m.matterEntityId, bucket)
    }
  }

  // Invoices grouped by matter. listClientInvoices is already scoped to the
  // client's matters; group via the per-matter invoice list it returns.
  // (Invoice summaries carry no matter id — resolve via a second pass below.)
  const invoiceMatters = await matterOfInvoices(ctx, invoices)

  const matterIdsAll = new Set<string>([...accruedByMatter.keys(), ...invoiceMatters.values()])
  const matters: ClientMatterBilling[] = []
  for (const matterId of matterIdsAll) {
    const accrued = accruedByMatter.get(matterId)
    const matterInvoices = invoices.filter((inv) => invoiceMatters.get(inv.invoiceEntityId) === matterId)
    const dueCents = matterInvoices
      .filter((i) => i.status === 'due')
      .reduce((n, i) => n + cents(i.total), 0)
    const paidCents = matterInvoices
      .filter((i) => i.status === 'paid')
      .reduce((n, i) => n + cents(i.total), 0)
    const accruedCents = accrued?.totalCents ?? 0
    matters.push({
      matterEntityId: matterId,
      matterNumber: accrued?.matterNumber ?? matterInvoices[0]?.invoiceNumber ?? '',
      invoices: matterInvoices,
      accrued: accrued?.entries ?? [],
      accruedTotal: toAmount(accruedCents),
      dueTotal: toAmount(dueCents),
      paidTotal: toAmount(paidCents),
      runningTotal: toAmount(dueCents + accruedCents),
    })
  }

  const sum = (pick: (m: ClientMatterBilling) => string): number =>
    matters.reduce((n, m) => n + cents(pick(m)), 0)
  return {
    matters,
    currency: 'USD',
    totals: {
      due: toAmount(sum((m) => m.dueTotal)),
      paid: toAmount(sum((m) => m.paidTotal)),
      accrued: toAmount(sum((m) => m.accruedTotal)),
      running: toAmount(sum((m) => m.runningTotal)),
    },
  }
}

// invoice → matter id (invoice_matter_id attribute), tenant-scoped.
async function matterOfInvoices(
  ctx: ActionContext,
  invoices: ClientInvoiceSummary[],
): Promise<Map<string, string>> {
  const { withActionContext } = await import('@exsto/substrate')
  const map = new Map<string, string>()
  if (invoices.length === 0) return map
  await withActionContext(ctx, async (client) => {
    const res = await client.query<{ entity_id: string; matter_id: string }>(
      `SELECT DISTINCT ON (a.entity_id) a.entity_id, a.value #>> '{}' AS matter_id
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1
         AND akd.kind_name = 'invoice_matter_id'
         AND a.entity_id = ANY($2::uuid[])
       ORDER BY a.entity_id, a.valid_from DESC`,
      [ctx.tenantId, invoices.map((i) => i.invoiceEntityId)],
    )
    for (const row of res.rows) map.set(row.entity_id, row.matter_id)
  })
  return map
}

// PORTAL-1 (WP2) — "Things to do": every action waiting on the client, in one
// list. Composed from the same sources the individual tabs read: documents to
// sign (e-sign), invoices to pay, and materials the firm requested (a matter
// parked at a client gate).
export interface ClientTodo {
  kind: 'sign' | 'pay' | 'materials'
  label: string
  matterEntityId?: string | null
  /** For sign: the requestId; for pay: the invoiceNumber. */
  ref: string
}

export async function listClientTodos(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ClientTodo[]> {
  const { listClientSignatures } = await import('./esign.js')
  const { loadClientContactEmail } = await import('./clientIdentity.js')
  const matterIds = await resolveClientMatterIds(ctx.tenantId, clientContactId)
  const email = await loadClientContactEmail(ctx.tenantId, clientContactId)
  const todos: ClientTodo[] = []

  if (email) {
    const signatures = await listClientSignatures({
      tenantId: ctx.tenantId,
      clientContactId,
      email,
      matterIds,
    })
    // listClientSignatures already returns ONLY requests awaiting this client
    // (delivered/opened).
    for (const sig of signatures) {
      todos.push({
        kind: 'sign',
        label: `Sign: ${sig.documentTitle ?? 'a document'}`,
        ref: sig.requestId,
      })
    }
  }

  const invoices = await listClientInvoices(ctx, clientContactId)
  for (const inv of invoices) {
    if (inv.status === 'due') {
      todos.push({
        kind: 'pay',
        label: `Pay invoice ${inv.invoiceNumber} — $${inv.total}`,
        ref: inv.invoiceNumber,
      })
    }
  }

  // Matters parked at a CLIENT gate = the firm is waiting on the client
  // (materials, a reply, an acceptance).
  const { withActionContext } = await import('@exsto/substrate')
  const { getWorkflowInstanceForMatter, resolveBoundWorkflowById } = await import(
    '../lifecycle/binding.js'
  )
  const { stageByKey, allowedTransitions, clientLabel } = await import('../lifecycle/resolve.js')
  await withActionContext(ctx, async (client) => {
    for (const matterId of matterIds) {
      const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, matterId)
      if (!instance || instance.status === 'completed') continue
      let graph =
        instance.statesOverride && instance.statesOverride.length > 0
          ? instance.statesOverride
          : []
      if (graph.length === 0) {
        const bound = await resolveBoundWorkflowById(client, ctx.tenantId, instance.workflowDefinitionId)
        graph = bound?.graph ?? []
      }
      if (graph.length === 0) continue
      const clientEdges = allowedTransitions(graph, instance.currentState, ['client'])
      if (clientEdges.length === 0) continue
      const stage = stageByKey(graph, instance.currentState)
      todos.push({
        kind: 'materials',
        label: `Waiting on you: ${stage ? clientLabel(stage) : 'the firm requested something'}`,
        matterEntityId: matterId,
        ref: matterId,
      })
    }
  })

  return todos
}
