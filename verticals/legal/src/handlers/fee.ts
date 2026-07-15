import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertEvent, getLatestAttributeValue } from './common.js'
import { getWorkflowInstanceForMatter, resolveBoundWorkflowById } from '../lifecycle/binding.js'
import { stageByKey, isBlockingStage } from '../lifecycle/resolve.js'
import type { Lifecycle, LifecycleStage } from '../lifecycle/types.js'

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

// HOTFIX-P17 (L2) — resolve the matter's running workflow graph (the bound version,
// or its per-matter override). Null when the matter runs no instance — a legacy matter
// with no lifecycle, which still completes off-workflow (fee + archive) as before.
async function resolveMatterGraph(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
): Promise<{ currentState: string; graph: Lifecycle } | null> {
  const instance = await getWorkflowInstanceForMatter(client, tenantId, matterEntityId)
  if (!instance) return null
  let graph: Lifecycle =
    instance.statesOverride && instance.statesOverride.length > 0 ? instance.statesOverride : []
  if (graph.length === 0) {
    const bound = await resolveBoundWorkflowById(client, tenantId, instance.workflowDefinitionId)
    graph = bound?.graph ?? []
  }
  return { currentState: instance.currentState, graph }
}

// The blocking steps a matter parked at `currentKey` has NOT yet completed: the current
// step (when it is blocking and non-terminal) plus every blocking step still ahead of
// it on the way to a terminal. Empty when the matter sits on its terminal stage — it
// legitimately reached completion (the L1 runtime guard makes reaching a terminal
// imply every blocking step ran). Follows the linear chain; a `seen` set guards a
// malformed cyclic graph.
function unexecutedBlockingSteps(graph: Lifecycle, currentKey: string): LifecycleStage[] {
  const out: LifecycleStage[] = []
  const seen = new Set<string>()
  let key: string | undefined = currentKey
  while (key && !seen.has(key)) {
    seen.add(key)
    const stage = stageByKey(graph, key)
    if (!stage) break
    if (isBlockingStage(stage)) out.push(stage) // isBlockingStage excludes terminals
    if (stage.terminal) break
    key = stage.advances_to[0]?.to
  }
  return out
}

// HOTFIX-P17 (L2/L3) — the ORPHANED fees a matter owes at completion: a per-document
// fee the SERVICE declares (transitions.document_fees[kind]) whose accrual trigger
// (approving that document) never fired, so the fee is neither on the ledger
// (document_fee.recorded) nor waived. Its revenue would otherwise vanish silently when
// the matter is completed and archived. The flat SERVICE fee (transitions.cost) is NOT
// here: it accrues in THIS completion action, so it can never be orphaned.
async function findOrphanedFees(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
): Promise<Array<{ documentKind: string; amount: string }>> {
  const serviceKey = await getLatestAttributeValue<string>(
    client,
    tenantId,
    matterEntityId,
    'service_key',
  )
  if (!serviceKey) return []
  const feeRes = await client.query<{ document_fees: Record<string, string> | null }>(
    `SELECT transitions->'document_fees' AS document_fees
       FROM workflow_definition
      WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
      ORDER BY version DESC LIMIT 1`,
    [tenantId, serviceKey],
  )
  const declared = feeRes.rows[0]?.document_fees
  if (!declared || typeof declared !== 'object') return []

  const orphaned: Array<{ documentKind: string; amount: string }> = []
  for (const [documentKind, amount] of Object.entries(declared)) {
    if (!amount || !String(amount).trim()) continue
    // Resolved = the fee accrued (it is on the unbilled ledger) OR it was waived.
    const resolved = await client.query<{ found: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM event e JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
         WHERE e.tenant_id = $1 AND e.primary_entity_id = $2
           AND ekd.kind_name IN ('document_fee.recorded','fee.waived')
           AND e.payload->>'document_kind' = $3
       ) AS found`,
      [tenantId, matterEntityId, documentKind],
    )
    if (!resolved.rows[0]?.found) orphaned.push({ documentKind, amount: String(amount) })
  }
  return orphaned
}

interface CompleteServicePayload {
  matter_entity_id: string
}

// legal.service.complete — accrues the service's flat completion fee. HOTFIX-P17 makes
// it a COMPLETION-INTEGRITY GATE: BEFORE accruing anything it refuses when a blocking
// step has not been done, or when a declared fee was silently dropped. Both refusals
// are plain-English and name what to fix; neither leaks engine internals (P3).
registerActionHandler('legal.service.complete', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as CompleteServicePayload
  const matterEntityId = (p.matter_entity_id ?? '').trim()
  if (!matterEntityId) throw new Error('matter_entity_id is required.')

  // GATE (a) — every blocking step must have run. A matter still parked on (or ahead
  // of) a blocking step cannot be completed: finish it first (or, for a client step
  // the client never did, skip it). A legacy matter with no instance skips this.
  const loaded = await resolveMatterGraph(client, ctx.tenantId, matterEntityId)
  if (loaded && loaded.graph.length > 0) {
    const pending = unexecutedBlockingSteps(loaded.graph, loaded.currentState)
    if (pending.length > 0) {
      throw new Error(
        `This matter can't be completed yet — the "${pending[0]!.label}" step still needs to be ` +
          `done. Finish it first (or, for a step the client hasn't done, skip it), then complete ` +
          `the matter.`,
      )
    }
  }

  // GATE (b) — no declared fee may be silently dropped. A per-document fee whose
  // document was never approved never accrued; the attorney must BILL it (approve the
  // document, or add the fee) or WAIVE it (a recorded decision) before completing.
  const orphaned = await findOrphanedFees(client, ctx.tenantId, matterEntityId)
  if (orphaned.length > 0) {
    const list = orphaned
      .map((f) => `$${f.amount} for the ${f.documentKind.replace(/_/g, ' ')}`)
      .join('; ')
    throw new Error(
      `This matter can't be completed yet — a fee that should have been charged was never ` +
        `recorded: ${list}. Bill it (approve the document or add the fee) or waive it (record a ` +
        `waive with your reason), then complete the matter.`,
    )
  }

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

// HOTFIX-P17 (L2/L3) — legal.fee.waive: an attorney's DELIBERATE, recorded decision
// not to charge a fee — mandatory reasoning (the action kind requires a reasoning
// trace at the core; the reason is echoed on the event). This is distinct from
// legal.matter.void_fee (removes an accrued ledger entry as a correction) and from
// legal.fee.decline (the CLIENT declines a quoted fee): a waive is the firm choosing
// to forgo revenue it is owed, and it is what RESOLVES the completion gate (an
// orphaned per-document fee) so a matter can finish without silently dropping money.
//
// Two modes:
//   • Mode 1 (accrued fee): name the source ledger event id. The entry then leaves the
//     unbilled feed (queries/billing.ts treats fee.waived as a terminal marker, like a
//     void), and the reason is on the record.
//   • Mode 2 (orphaned fee): name the fee directly (fee_type + amount, plus
//     document_kind for a document fee). Nothing accrued, so there is no source entry —
//     this waive is what clears findOrphanedFees for that document kind.
interface WaiveFeePayload {
  matter_entity_id?: string
  source_event_id?: string | null
  fee_type?: 'service' | 'document'
  document_kind?: string | null
  amount?: string
  reason?: string | null
}

registerActionHandler('legal.fee.waive', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as WaiveFeePayload
  const reason = (p.reason ?? '').trim()
  if (!reason) throw new Error('A reason is required to waive a fee.')

  const sourceEventId = (p.source_event_id ?? '').trim()
  if (sourceEventId) {
    // Mode 1 — waive an EXISTING accrued ledger entry. Resolve its matter/kind/amount.
    const src = await client.query<{
      matter_id: string | null
      kind_name: string
      amount: string | null
      document_kind: string | null
    }>(
      `SELECT e.primary_entity_id AS matter_id, ekd.kind_name,
              e.payload->>'amount' AS amount, e.payload->>'document_kind' AS document_kind
         FROM event e JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
        WHERE e.tenant_id = $1 AND e.id = $2::uuid`,
      [ctx.tenantId, sourceEventId],
    )
    const row = src.rows[0]
    if (!row || !row.matter_id) throw new Error(`Fee ledger entry ${sourceEventId} not found.`)
    if (row.kind_name !== 'service_fee.recorded' && row.kind_name !== 'document_fee.recorded') {
      throw new Error('Only a service or document fee can be waived here.')
    }
    const alreadyBilled = await client.query<{ found: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM event e JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
         WHERE e.tenant_id = $1 AND ekd.kind_name IN ('service_fee.billed','document_fee.billed')
           AND e.payload->>'source_event_id' = $2) AS found`,
      [ctx.tenantId, sourceEventId],
    )
    if (alreadyBilled.rows[0]?.found) {
      throw new Error('That fee is already invoiced — it cannot be waived.')
    }
    const feeType = row.kind_name === 'document_fee.recorded' ? 'document' : 'service'
    const eventId = await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName: 'fee.waived',
      primaryEntityId: row.matter_id,
      secondaryEntityIds: [],
      sourceType: 'human',
      sourceRef: ctx.actorId,
      data: {
        source_event_id: sourceEventId,
        fee_type: feeType,
        document_kind: row.document_kind,
        amount: row.amount,
        reason,
      },
    })
    return { eventId, matterEntityId: row.matter_id, feeType, waived: true, sourceEventId }
  }

  // Mode 2 — waive an ORPHANED fee named directly (it never accrued, so no source
  // ledger entry). This is what clears the completion gate for a dropped document fee.
  const matterEntityId = (p.matter_entity_id ?? '').trim()
  if (!matterEntityId) throw new Error('matter_entity_id (or source_event_id) is required.')
  const feeType = p.fee_type === 'document' ? 'document' : 'service'
  const amount = (p.amount ?? '').trim()
  if (!MONEY_RE.test(amount)) {
    throw new Error(
      `Fee amount must be a decimal string like 150 or 150.00; got ${JSON.stringify(p.amount)}.`,
    )
  }
  const documentKind = (p.document_kind ?? '').trim()
  if (feeType === 'document' && !documentKind) {
    throw new Error('document_kind is required to waive a document fee.')
  }
  const eventId = await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'fee.waived',
    primaryEntityId: matterEntityId,
    secondaryEntityIds: [],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: {
      fee_type: feeType,
      document_kind: feeType === 'document' ? documentKind : null,
      amount,
      reason,
    },
  })
  return {
    eventId,
    matterEntityId,
    feeType,
    documentKind: documentKind || null,
    amount,
    waived: true,
  }
})
