// Trust (IOLTA) ledger reads (migration 0111). Balances are DERIVED from the
// append-only trust events — this module never writes. Mirrors the cents
// discipline of the billing reads (ADR 0044).
//
// getTrustReconciliation applies GL↔subledger reconciliation discipline to the
// law-firm "three-way" trust reconciliation: the BOOK control (the firm's total
// trust ledger) must equal the sum of the per-client SUB-LEDGERS, and — when a
// bank balance is supplied — the bank statement. Any non-tie is surfaced as a
// classified BREAK (a client overdraft, unassigned funds with no client, or a
// bank-vs-book delta), never silently netted away.
import { withActionContext, type ActionContext } from '@exsto/substrate'

const TRUST_SIGN: Record<string, 1 | -1> = {
  'trust.deposited': 1,
  'trust.disbursed': -1,
  'trust.transferred_earned': -1,
  'trust.refunded': -1,
}
const TRUST_KINDS = Object.keys(TRUST_SIGN)

function amountToCents(amount: string | null): number {
  if (!amount) return 0
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount).trim())
  if (!m) return 0
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  return m[1] === '-' ? -cents : cents
}
function centsToAmount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

export interface TrustBalance {
  clientEntityId: string
  balance: string // decimal string
  currency: string
}

// One client's current trust balance.
export async function getClientTrustBalance(
  ctx: ActionContext,
  clientEntityId: string,
): Promise<TrustBalance> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ kind_name: string; amount: string | null }>(
      `SELECT ekd.kind_name, e.payload->>'amount' AS amount
         FROM event e
         JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
        WHERE e.tenant_id = $1 AND e.primary_entity_id = $2::uuid AND ekd.kind_name = ANY($3)`,
      [ctx.tenantId, clientEntityId, TRUST_KINDS],
    )
    let cents = 0
    for (const r of res.rows) cents += (TRUST_SIGN[r.kind_name] ?? 0) * amountToCents(r.amount)
    return { clientEntityId, balance: centsToAmount(cents), currency: 'USD' }
  })
}

export interface TrustLedgerEntry {
  eventId: string
  kind: string // deposited | disbursed | transferred_earned | refunded
  amount: string
  signedAmount: string // + for deposits, − for the rest
  runningBalance: string
  occurredAt: string
  reference: string | null
  note: string | null
}

// One client's trust sub-ledger, oldest→newest, with a roll-forward running
// balance (opening + activity = closing) — the per-client statement.
export async function listClientTrustLedger(
  ctx: ActionContext,
  clientEntityId: string,
): Promise<{ entries: TrustLedgerEntry[]; balance: string }> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      id: string
      kind_name: string
      amount: string | null
      occurred_at: string
      payload: Record<string, unknown>
    }>(
      `SELECT e.id, ekd.kind_name, e.payload->>'amount' AS amount,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS occurred_at, e.payload
         FROM event e
         JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
        WHERE e.tenant_id = $1 AND e.primary_entity_id = $2::uuid AND ekd.kind_name = ANY($3)
        ORDER BY e.occurred_at ASC`,
      [ctx.tenantId, clientEntityId, TRUST_KINDS],
    )
    let running = 0
    const entries: TrustLedgerEntry[] = res.rows.map((r) => {
      const sign = TRUST_SIGN[r.kind_name] ?? 0
      const signedCents = sign * amountToCents(r.amount)
      running += signedCents
      const p = r.payload ?? {}
      return {
        eventId: r.id,
        kind: r.kind_name.replace('trust.', ''),
        amount: centsToAmount(amountToCents(r.amount)),
        signedAmount: centsToAmount(signedCents),
        runningBalance: centsToAmount(running),
        occurredAt: r.occurred_at,
        reference: (p.reference as string) ?? null,
        note: (p.payee as string) ?? (p.source as string) ?? (p.reason as string) ?? null,
      }
    })
    return { entries, balance: centsToAmount(running) }
  })
}

export interface TrustReconciliationBreak {
  type: 'client_overdraft' | 'unassigned_funds' | 'bank_book_delta'
  clientEntityId: string | null
  clientName: string | null
  amount: string
  note: string
}

export interface TrustReconciliation {
  bookBalance: string // the firm's total trust ledger (control)
  clientCount: number
  clients: Array<{ clientEntityId: string; clientName: string | null; balance: string }>
  // True iff Σ client sub-ledgers == book, no client is overdrawn, no funds are
  // unassigned, and (if a bank balance was given) bank == book.
  tiesOut: boolean
  bankBalance: string | null
  bankBookDelta: string | null
  breaks: TrustReconciliationBreak[]
}

// Three-way trust reconciliation. The substrate is the BOOK; pass the bank
// statement balance to complete the third leg. Returns the per-client breakdown
// plus every break, classified — hand the breaks to a human to resolve before
// sign-off (never auto-net).
export async function getTrustReconciliation(
  ctx: ActionContext,
  opts: { bankBalance?: string | null } = {},
): Promise<TrustReconciliation> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      client_id: string | null
      client_name: string | null
      kind_name: string
      amount: string | null
    }>(
      `SELECT e.primary_entity_id AS client_id,
              (SELECT a.value #>> '{}' FROM attribute a
                 JOIN attribute_kind_definition ak ON ak.id = a.attribute_kind_id
                WHERE a.entity_id = e.primary_entity_id AND ak.kind_name = 'client_name'
                  AND a.valid_to IS NULL LIMIT 1) AS client_name,
              ekd.kind_name, e.payload->>'amount' AS amount
         FROM event e
         JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
        WHERE e.tenant_id = $1 AND ekd.kind_name = ANY($2)`,
      [ctx.tenantId, TRUST_KINDS],
    )

    // Subledger: net cents per client (and a bucket for any unassigned entries).
    const byClient = new Map<string, { name: string | null; cents: number }>()
    let unassignedCents = 0
    for (const r of res.rows) {
      const signed = (TRUST_SIGN[r.kind_name] ?? 0) * amountToCents(r.amount)
      if (!r.client_id) {
        unassignedCents += signed
        continue
      }
      const cur = byClient.get(r.client_id) ?? { name: r.client_name, cents: 0 }
      cur.cents += signed
      cur.name = cur.name ?? r.client_name
      byClient.set(r.client_id, cur)
    }

    const clients = [...byClient.entries()]
      .map(([clientEntityId, v]) => ({
        clientEntityId,
        clientName: v.name,
        balance: centsToAmount(v.cents),
        _cents: v.cents,
      }))
      .sort((a, b) => b._cents - a._cents)
    const bookCents = clients.reduce((s, c) => s + c._cents, 0) + unassignedCents

    const breaks: TrustReconciliationBreak[] = []
    // (a) Overdrawn client — the cardinal IOLTA break.
    for (const c of clients) {
      if (c._cents < 0) {
        breaks.push({
          type: 'client_overdraft',
          clientEntityId: c.clientEntityId,
          clientName: c.clientName,
          amount: centsToAmount(c._cents),
          note: 'Client trust balance is negative — one client cannot be funded by another.',
        })
      }
    }
    // (b) Funds not tied to any client.
    if (unassignedCents !== 0) {
      breaks.push({
        type: 'unassigned_funds',
        clientEntityId: null,
        clientName: null,
        amount: centsToAmount(unassignedCents),
        note: 'Trust funds not attributed to a client sub-ledger.',
      })
    }
    // (c) Bank statement vs book (third leg).
    let bankCents: number | null = null
    let deltaCents: number | null = null
    if (opts.bankBalance != null && String(opts.bankBalance).trim() !== '') {
      bankCents = amountToCents(opts.bankBalance)
      deltaCents = bankCents - bookCents
      if (deltaCents !== 0) {
        breaks.push({
          type: 'bank_book_delta',
          clientEntityId: null,
          clientName: null,
          amount: centsToAmount(deltaCents),
          note:
            deltaCents > 0
              ? 'Bank balance exceeds the book — unrecorded deposits or outstanding disbursements.'
              : 'Book exceeds the bank balance — unrecorded disbursements or a missing deposit.',
        })
      }
    }

    return {
      bookBalance: centsToAmount(bookCents),
      clientCount: clients.length,
      clients: clients.map(({ _cents, ...c }) => c),
      tiesOut: breaks.length === 0,
      bankBalance: bankCents != null ? centsToAmount(bankCents) : null,
      bankBookDelta: deltaCents != null ? centsToAmount(deltaCents) : null,
      breaks,
    }
  })
}
