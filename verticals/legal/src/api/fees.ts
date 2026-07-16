// Flat-fee write-path (Phase 2): mark a service complete (accrues its service fee),
// add a fee to a matter by hand, and void an unbilled fee. All go THROUGH THE CORE
// via submitAction; the handlers (handlers/fee.ts) do the append-only writes.
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

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

export interface WaiveFeeInput {
  // Waive an EXISTING accrued fee by its ledger event id (mode 1)…
  sourceEventId?: string
  // …or waive an ORPHANED fee named directly (mode 2): the matter + fee descriptor.
  matterEntityId?: string
  feeType?: 'service' | 'document'
  documentKind?: string | null
  amount?: string
  /** Why the fee is being forgone — MANDATORY (the action kind requires a trace). */
  reason: string
}

export interface WaiveFeeResult {
  eventId: string
  matterEntityId: string | null
  feeType: string
  waived: boolean
}

// The reasoning trace's author: the tenant's agent actor if present, else its system
// actor — a firm-authored waive still explains itself. Mirrors amendPermissionScope.
async function resolveTraceActor(ctx: ActionContext): Promise<string> {
  return withActionContext(ctx, async (client) => {
    const agent = await client.query<{ id: string }>(
      `SELECT id FROM actor WHERE tenant_id = $1 AND actor_type = 'agent' AND status = 'active'
       ORDER BY created_at ASC LIMIT 1`,
      [ctx.tenantId],
    )
    if (agent.rows[0]) return agent.rows[0].id
    const system = await client.query<{ id: string }>(
      `SELECT id FROM actor WHERE tenant_id = $1 AND actor_type = 'system' AND status = 'active'
       ORDER BY created_at ASC LIMIT 1`,
      [ctx.tenantId],
    )
    const id = system.rows[0]?.id
    if (!id) throw new Error('No agent or system actor to author the reasoning trace.')
    return id
  })
}

// Waive a fee — a deliberate, RECORDED decision to forgo revenue the firm is owed,
// with a mandatory reason. Persists a reasoning_trace FIRST (the action kind requires
// one) then fires legal.fee.waive through the core. This is what resolves the
// completion gate on an orphaned fee (mode 2), and also clears an accrued fee off the
// unbilled feed (mode 1) — distinct from void (a correction) and decline (the client).
export async function waiveFee(ctx: ActionContext, input: WaiveFeeInput): Promise<WaiveFeeResult> {
  const reason = (input.reason ?? '').trim()
  if (!reason) throw new Error('A reason is required to waive a fee.')
  if (!input.sourceEventId?.trim() && !input.matterEntityId?.trim()) {
    throw new Error(
      'Provide either sourceEventId (an accrued fee) or matterEntityId (an orphaned fee).',
    )
  }

  const traceId = randomUUID()
  const traceActor = await resolveTraceActor(ctx)
  const subject = input.sourceEventId?.trim()
    ? `accrued fee ${input.sourceEventId.trim()}`
    : `${input.feeType ?? 'service'} fee${input.documentKind ? ` (${input.documentKind})` : ''} of $${input.amount ?? '0'} on matter ${input.matterEntityId}`
  await withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO reasoning_trace (
         id, tenant_id, agent_actor_id, prompt, evidence, alternatives,
         conclusion, confidence, model_identity, trace
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb)`,
      [
        traceId,
        ctx.tenantId,
        traceActor,
        `Waive ${subject}.`,
        JSON.stringify([{ kind: 'reason', detail: reason }]),
        JSON.stringify([{ option: 'bill the fee', rejected: reason }]),
        `The firm deliberately forgoes this fee; the reason is on the record.`,
        1.0,
        null,
        JSON.stringify({ waive: subject }),
      ],
    )
  })

  const res = await submitAction(ctx, {
    actionKindName: 'legal.fee.waive',
    intentKind: 'adjustment',
    reasoningTraceId: traceId,
    payload: {
      matter_entity_id: input.matterEntityId ?? null,
      source_event_id: input.sourceEventId ?? null,
      fee_type: input.feeType ?? 'service',
      document_kind: input.documentKind ?? null,
      amount: input.amount ?? null,
      reason,
    },
  })
  return res.effects[0] as unknown as WaiveFeeResult
}
