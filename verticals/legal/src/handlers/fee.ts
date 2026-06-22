import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertEvent, getLatestAttributeValue } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Flat-fee billing handlers (Phase 2). Two flat fees accrue as billable ledger
// entries, separately from time/expenses and from document fees (which accrue on
// document approval — see handlers/draft.ts):
//
//   • SERVICE fee — the service's flat fee (transitions.cost type 'fixed', or the
//     legacy transitions.fixed_fee), accrued when the matter's service workflow is
//     marked complete (legal.service.complete). One per matter + service.
//   • MANUAL fee — a service or document fee the attorney adds by hand
//     (legal.matter.add_fee), and removes by voiding it (legal.matter.void_fee).
//
// All write through the action layer as append-only events; voiding is a new
// billing_entry.voided event (never a mutation — ADR 0039), which the unbilled
// feed treats like a *.billed marker (the entry leaves the feed).
// ───────────────────────────────────────────────────────────────────────────

// A money decimal string (ADR 0044): non-negative, up to 2 fractional digits.
const MONEY_RE = /^\d+(\.\d{1,2})?$/

// Accrue a matter's flat SERVICE fee, if its service configures one. Idempotent
// per (matter, service): re-completing a service does not double-bill. Reads the
// fee under one convention — transitions.cost (type 'fixed'), legacy fixed_fee as
// a fallback. Returns the accrued amount, or null when nothing accrued.
export async function accrueServiceFeeForMatter(
  client: DbClient,
  args: { tenantId: string; actionId: string; actorId: string; matterEntityId: string },
): Promise<string | null> {
  const serviceKey = await getLatestAttributeValue<string>(
    client,
    args.tenantId,
    args.matterEntityId,
    'service_key',
  )
  if (!serviceKey) return null

  const already = await client.query<{ found: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1 AND e.primary_entity_id = $2
         AND ekd.kind_name = 'service_fee.recorded'
         AND COALESCE(e.payload->>'service_key', '') = $3
     ) AS found`,
    [args.tenantId, args.matterEntityId, serviceKey],
  )
  if (already.rows[0]?.found) return null

  const feeRes = await client.query<{
    cost: { type?: string; amount?: string } | null
    fixed_fee: string | null
  }>(
    `SELECT transitions->'cost' AS cost, transitions->>'fixed_fee' AS fixed_fee
       FROM workflow_definition
      WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
      ORDER BY version DESC LIMIT 1`,
    [args.tenantId, serviceKey],
  )
  const row = feeRes.rows[0]
  const amount =
    row?.cost && row.cost.type === 'fixed' && row.cost.amount
      ? row.cost.amount
      : (row?.fixed_fee ?? null)
  if (!amount || !String(amount).trim()) return null

  await insertEvent(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    eventKindName: 'service_fee.recorded',
    primaryEntityId: args.matterEntityId,
    secondaryEntityIds: [],
    sourceType: 'system',
    sourceRef: args.actorId,
    data: {
      service_key: serviceKey,
      amount: String(amount),
      description: `Service fee — ${serviceKey.replace(/_/g, ' ')}`,
    },
  })
  return String(amount)
}

interface CompleteServicePayload {
  matter_entity_id: string
}

registerActionHandler('legal.service.complete', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as CompleteServicePayload
  const matterEntityId = (p.matter_entity_id ?? '').trim()
  if (!matterEntityId) throw new Error('matter_entity_id is required.')
  const accrued = await accrueServiceFeeForMatter(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    matterEntityId,
  })
  return { matterEntityId, accrued: accrued !== null, amount: accrued }
})

interface AddFeePayload {
  matter_entity_id: string
  fee_type: 'service' | 'document'
  amount: string
  description?: string | null
  // For a document fee, the document kind it represents (free text label is fine).
  document_kind?: string | null
}

registerActionHandler('legal.matter.add_fee', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as AddFeePayload
  const matterEntityId = (p.matter_entity_id ?? '').trim()
  if (!matterEntityId) throw new Error('matter_entity_id is required.')
  const feeType = p.fee_type === 'document' ? 'document' : 'service'
  const amount = (p.amount ?? '').trim()
  if (!MONEY_RE.test(amount)) {
    throw new Error(
      `Fee amount must be a decimal string like 150 or 150.00; got ${JSON.stringify(p.amount)}.`,
    )
  }
  const serviceKey = await getLatestAttributeValue<string>(
    client,
    ctx.tenantId,
    matterEntityId,
    'service_key',
  )
  const description =
    (p.description ?? '').trim() || (feeType === 'document' ? 'Document fee' : 'Service fee')

  const eventId = await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: feeType === 'document' ? 'document_fee.recorded' : 'service_fee.recorded',
    primaryEntityId: matterEntityId,
    secondaryEntityIds: [],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: {
      service_key: serviceKey ?? null,
      ...(feeType === 'document'
        ? { document_kind: (p.document_kind ?? '').trim() || 'custom' }
        : {}),
      amount,
      description,
    },
  })
  return { eventId, matterEntityId, feeType, amount }
})

interface VoidFeePayload {
  source_event_id: string
}

registerActionHandler('legal.matter.void_fee', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as VoidFeePayload
  const sourceEventId = (p.source_event_id ?? '').trim()
  if (!sourceEventId) throw new Error('source_event_id is required.')

  // Resolve the fee's matter (its primary entity) and confirm it's a fee ledger
  // entry that hasn't been billed — voiding a billed entry is meaningless.
  const src = await client.query<{ matter_id: string | null; kind_name: string }>(
    `SELECT e.primary_entity_id AS matter_id, ekd.kind_name
       FROM event e JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
      WHERE e.tenant_id = $1 AND e.id = $2::uuid`,
    [ctx.tenantId, sourceEventId],
  )
  const row = src.rows[0]
  if (!row) throw new Error(`Ledger entry ${sourceEventId} not found.`)
  if (row.kind_name !== 'service_fee.recorded' && row.kind_name !== 'document_fee.recorded') {
    throw new Error('Only a service or document fee can be voided here.')
  }
  const billed = await client.query<{ found: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM event e JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name IN ('service_fee.billed','document_fee.billed')
         AND e.payload->>'source_event_id' = $2) AS found`,
    [ctx.tenantId, sourceEventId],
  )
  if (billed.rows[0]?.found) throw new Error('That fee is already invoiced and cannot be voided.')

  const eventId = await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'billing_entry.voided',
    primaryEntityId: row.matter_id,
    secondaryEntityIds: [],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: { source_event_id: sourceEventId },
  })
  return { eventId, sourceEventId, voided: true }
})
