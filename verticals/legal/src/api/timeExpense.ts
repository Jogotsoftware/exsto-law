// Time & expense ledgers for a matter. Both are observational journal entries on
// the matter timeline (time.logged / expense.recorded event kinds, migration
// 0018), written through the generic event.record action — no state change, no
// handler. These are the rows the billing module rolls up into an invoice.
//
// Money discipline (ADR 0044): amounts are DECIMAL STRINGS, never JS/JSON numbers.
// Totals are summed in integer cents so there is no floating-point drift.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

// ── Time ────────────────────────────────────────────────────────────────────

export interface LogTimeInput {
  matterEntityId: string
  durationMinutes: number
  description: string
  // ISO date (YYYY-MM-DD) the work was done; defaults to today when omitted.
  workedDate?: string
}

export interface TimeEntry {
  eventId: string
  durationMinutes: number
  description: string
  workedDate: string | null
  recordedAt: string
}

export interface MatterTime {
  entries: TimeEntry[]
  totalMinutes: number
}

export async function logTimeEntry(
  ctx: ActionContext,
  input: LogTimeInput,
): Promise<{ eventId: string }> {
  const minutes = Math.round(input.durationMinutes)
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('Enter a positive duration.')
  }
  const description = input.description.trim()
  if (!description) throw new Error('Add a description for the time entry.')

  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'enforcement',
    payload: {
      event_kind_name: 'time.logged',
      primary_entity_id: input.matterEntityId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: {
        duration_minutes: minutes,
        description,
        worked_date: input.workedDate ?? null,
      },
    },
  })
  const eventId = (res.effects[0] as { eventId: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

export async function listMatterTime(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<MatterTime> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      event_id: string
      payload: { duration_minutes?: number; description?: string; worked_date?: string | null }
      occurred_at: string
    }>(
      `SELECT e.id AS event_id, e.payload,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS occurred_at
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'time.logged'
         AND e.primary_entity_id = $2::uuid
       ORDER BY e.occurred_at DESC`,
      [ctx.tenantId, matterEntityId],
    )
    const entries = res.rows.map((r) => ({
      eventId: r.event_id,
      durationMinutes: Number(r.payload.duration_minutes ?? 0),
      description: r.payload.description ?? '',
      workedDate: r.payload.worked_date ?? null,
      recordedAt: r.occurred_at,
    }))
    const totalMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0)
    return { entries, totalMinutes }
  })
}

// ── Expenses ──────────────────────────────────────────────────────────────────

// Inline receipt storage cap. There is no object store yet, so a receipt is held
// as base64 in the event payload — fine for a small PDF/image, but capped so the
// append-only event table never absorbs a large binary. Beyond this the UI tells
// the attorney to email the receipt instead (a dedicated blob store is the
// follow-up). ~1.5 MB of bytes ≈ 2,000,000 base64 chars.
export const RECEIPT_MAX_BASE64_CHARS = 2_000_000

export interface ReceiptUpload {
  filename: string
  contentType: string
  dataBase64: string
}

export interface RecordExpenseInput {
  matterEntityId: string
  // Decimal string, e.g. "150.00". Validated to ≥ 0 with ≤ 2 decimals.
  amount: string
  currency?: string
  description: string
  // ISO date (YYYY-MM-DD) incurred; defaults to today when omitted.
  incurredDate?: string
  receipt?: ReceiptUpload
}

export interface ReceiptMeta {
  filename: string
  contentType: string
  sizeBytes: number
}

export interface ExpenseEntry {
  eventId: string
  amount: string
  currency: string
  description: string
  incurredDate: string | null
  receipt: ReceiptMeta | null
  recordedAt: string
}

export interface MatterExpenses {
  entries: ExpenseEntry[]
  total: string
  currency: string
}

// Exact decimal-string → integer cents (no float). Accepts "150", "150.5",
// "150.50". Throws on anything else so a bad amount never reaches the ledger.
export function amountToCents(amount: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim())
  if (!m) throw new Error(`Invalid amount "${amount}" — use digits like 150 or 150.00.`)
  const whole = Number(m[1])
  const frac = (m[2] ?? '').padEnd(2, '0')
  return whole * 100 + Number(frac)
}

function centsToAmount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

function approxBytesFromBase64(b64: string): number {
  // 4 base64 chars encode 3 bytes; subtract padding.
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

export async function recordExpense(
  ctx: ActionContext,
  input: RecordExpenseInput,
): Promise<{ eventId: string }> {
  // Normalize + validate the amount through the cents round-trip.
  const cents = amountToCents(input.amount)
  if (cents < 0) throw new Error('Amount must be zero or positive.')
  const amount = centsToAmount(cents)

  const description = input.description.trim()
  if (!description) throw new Error('Add a description for the expense.')
  const currency = (input.currency ?? 'USD').trim().toUpperCase()

  let receipt: (ReceiptMeta & { data_base64: string }) | null = null
  if (input.receipt) {
    const { filename, contentType, dataBase64 } = input.receipt
    if (dataBase64.length > RECEIPT_MAX_BASE64_CHARS) {
      throw new Error(
        'Receipt is too large to attach here (limit ~1.5 MB). Email it to the matter instead.',
      )
    }
    receipt = {
      filename: filename.trim() || 'receipt',
      contentType: contentType || 'application/octet-stream',
      sizeBytes: approxBytesFromBase64(dataBase64),
      data_base64: dataBase64,
    }
  }

  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'enforcement',
    payload: {
      event_kind_name: 'expense.recorded',
      primary_entity_id: input.matterEntityId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: {
        amount,
        currency,
        description,
        incurred_date: input.incurredDate ?? null,
        receipt,
      },
    },
  })
  const eventId = (res.effects[0] as { eventId: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

export async function listMatterExpenses(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<MatterExpenses> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      event_id: string
      payload: {
        amount?: string
        currency?: string
        description?: string
        incurred_date?: string | null
        receipt?: { filename?: string; contentType?: string; sizeBytes?: number } | null
      }
      occurred_at: string
    }>(
      // Receipt bytes (data_base64) are deliberately NOT selected here — the list
      // stays lean; the bytes are fetched on demand via getExpenseReceipt.
      `SELECT e.id AS event_id,
              (e.payload - 'receipt')
                || jsonb_build_object(
                     'receipt',
                     CASE WHEN e.payload->'receipt' IS NULL OR e.payload->'receipt' = 'null'::jsonb
                          THEN NULL
                          ELSE (e.payload->'receipt') - 'data_base64' END
                   ) AS payload,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS occurred_at
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'expense.recorded'
         AND e.primary_entity_id = $2::uuid
       ORDER BY e.occurred_at DESC`,
      [ctx.tenantId, matterEntityId],
    )
    const entries: ExpenseEntry[] = res.rows.map((r) => ({
      eventId: r.event_id,
      amount: r.payload.amount ?? '0.00',
      currency: r.payload.currency ?? 'USD',
      description: r.payload.description ?? '',
      incurredDate: r.payload.incurred_date ?? null,
      receipt: r.payload.receipt
        ? {
            filename: r.payload.receipt.filename ?? 'receipt',
            contentType: r.payload.receipt.contentType ?? 'application/octet-stream',
            sizeBytes: Number(r.payload.receipt.sizeBytes ?? 0),
          }
        : null,
      recordedAt: r.occurred_at,
    }))
    const totalCents = entries.reduce((sum, e) => sum + amountToCents(e.amount), 0)
    const currency = entries[0]?.currency ?? 'USD'
    return { entries, total: centsToAmount(totalCents), currency }
  })
}

// Fetch one receipt's bytes for download. Scoped to the matter + event so an
// attorney can only pull receipts on a matter they can read (RLS-enforced).
export async function getExpenseReceipt(
  ctx: ActionContext,
  input: { matterEntityId: string; eventId: string },
): Promise<ReceiptUpload | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      receipt: { filename?: string; contentType?: string; data_base64?: string } | null
    }>(
      `SELECT e.payload->'receipt' AS receipt
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'expense.recorded'
         AND e.primary_entity_id = $2::uuid
         AND e.id = $3::uuid`,
      [ctx.tenantId, input.matterEntityId, input.eventId],
    )
    const r = res.rows[0]?.receipt
    if (!r || !r.data_base64) return null
    return {
      filename: r.filename ?? 'receipt',
      contentType: r.contentType ?? 'application/octet-stream',
      dataBase64: r.data_base64,
    }
  })
}
