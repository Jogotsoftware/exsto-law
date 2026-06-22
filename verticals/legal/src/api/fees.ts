// Flat-fee write-path (Phase 2): mark a service complete (accrues its service fee),
// add a fee to a matter by hand, and void an unbilled fee. All go THROUGH THE CORE
// via submitAction; the handlers (handlers/fee.ts) do the append-only writes.
import { submitAction, type ActionContext } from '@exsto/substrate'

export interface CompleteServiceResult {
  matterEntityId: string
  accrued: boolean
  amount: string | null
}

// Mark a matter's service workflow complete; accrues the service's flat fee if one
// is configured (idempotent per matter + service).
export async function completeService(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<CompleteServiceResult> {
  if (!matterEntityId?.trim()) throw new Error('matterEntityId is required.')
  const res = await submitAction(ctx, {
    actionKindName: 'legal.service.complete',
    intentKind: 'enforcement',
    payload: { matter_entity_id: matterEntityId },
  })
  return res.effects[0] as CompleteServiceResult
}

export interface AddMatterFeeInput {
  matterEntityId: string
  feeType: 'service' | 'document'
  amount: string
  description?: string | null
  documentKind?: string | null
}

// Add a service or document fee to a matter by hand — a billable ledger entry the
// attorney can later invoice or void.
export async function addMatterFee(
  ctx: ActionContext,
  input: AddMatterFeeInput,
): Promise<{ eventId: string; matterEntityId: string; feeType: string; amount: string }> {
  if (!input.matterEntityId?.trim()) throw new Error('Pick a matter to add the fee to.')
  if (!input.amount?.trim()) throw new Error('Enter a fee amount.')
  const res = await submitAction(ctx, {
    actionKindName: 'legal.matter.add_fee',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: input.matterEntityId,
      fee_type: input.feeType,
      amount: input.amount.trim(),
      description: input.description ?? null,
      document_kind: input.documentKind ?? null,
    },
  })
  return res.effects[0] as {
    eventId: string
    matterEntityId: string
    feeType: string
    amount: string
  }
}

// Void an unbilled fee (its source ledger event id). Reversible by adding it again.
export async function voidMatterFee(
  ctx: ActionContext,
  sourceEventId: string,
): Promise<{ eventId: string; sourceEventId: string; voided: boolean }> {
  if (!sourceEventId?.trim()) throw new Error('sourceEventId is required.')
  const res = await submitAction(ctx, {
    actionKindName: 'legal.matter.void_fee',
    intentKind: 'correction',
    payload: { source_event_id: sourceEventId },
  })
  return res.effects[0] as { eventId: string; sourceEventId: string; voided: boolean }
}
