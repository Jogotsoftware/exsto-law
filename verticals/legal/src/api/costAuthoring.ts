// AI authoring of a service's BILLING (Build-Wizard Phase 6, gated) — the
// substrate-facing half of "propose the service's price in the chatbot". It mirrors
// serviceAuthoring.ts / templateAuthoring.ts exactly, one concept over: where those
// author a service shell / a document template, this authors the service's COST (its
// fee model). Two pieces:
//   • CostProposal / validateProposedCost — a captured, not-yet-persisted price
//     (hourly rate + estimated hours, or a flat fixed fee) validated the SAME way the
//     write path will write it (the money decimal contract, ADR 0044), so the propose
//     tool surfaces errors verbatim and the card never shows a price the write rejects.
//   • createCostAI — the AI WRITE path. The chat turn never writes; this is called by
//     the attorney-gated approve route. It persists a reasoning_trace FIRST (the same
//     agent-actor + clamped-confidence discipline serviceAuthoring follows), then sets
//     the cost AS THE AGENT ACTOR through the existing setServiceCost path (a
//     legal.service.upsert with a cost transitions_patch) so the new version carries
//     full AI provenance.
//
// Why no new action kind: cost already rides through legal.service.upsert (the cost
// lives in transitions.cost; setServiceCost is the canonical setter). Phase 6 adds the
// AI *authoring* layer over it, not a new write path — the same pattern Phase 3 used
// for templates (createTemplateAI is also a cost-free upsert patch). CLAUDE.md hard
// rule 4/7: every AI write has an agent source, a reasoning trace, and an intent kind.
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  getService,
  type ServiceCost,
  type ServiceCostType,
  type ServiceDefinition,
} from './services.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent) — the
// SAME id serviceAuthoring.ts / templateAuthoring.ts source their writes to.
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

// The closed set of fee models a proposed cost may use — kept as a const tuple so the
// propose tool's input_schema enum and the validator read from ONE source (the model
// can never invent a fee model the write path rejects). Mirrors SERVICE_ROUTES.
export const SERVICE_COST_TYPES: readonly ServiceCostType[] = ['hourly', 'fixed'] as const

// The money decimal contract (ADR 0044) — the SAME regex normalizeCost uses, surfaced
// here so the propose tool can validate a price BEFORE capture (not only on write).
const MONEY_RE = /^\d+(\.\d{1,2})?$/

// A proposed service cost captured this turn — what the model proposes, validated. The
// chat surfaces it as an inline approval card; the attorney approves it, which posts
// the cost approve route (the only place a live write happens). Mirrors ServiceProposal.
export interface CostProposal {
  serviceKey: string
  // 'hourly' → amount is the rate, hours is the estimate; 'fixed' → amount is the flat
  // fee and hours is null (the same shape ServiceCost stores).
  costType: ServiceCostType
  amount: string
  hours: number | null
  // BUILDER-CERT-1 (WP1) — per-document fees ({ document_kind: decimal-string }),
  // each accrued once per matter when that document is approved. The billing model
  // the doctrine offers as "per-document on approval": without this field the
  // wizard could OFFER the model but never DECLARE it (review finding).
  documentFees?: Record<string, string>
  summary: string
  confidence: number
}

// Validate a proposed cost the way setServiceCost (normalizeCost) will write it: a fee
// model from the closed set and a well-formed money decimal string. Returns the same
// { ok, errors } shape validateProposedService does so the propose tool surfaces
// errors verbatim. Pure — no DB read needed (cost has no cross-row uniqueness).
export function validateProposedCost(input: {
  costType: ServiceCostType
  amount: string
  hours?: number | null
  documentFees?: Record<string, string>
}): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (!SERVICE_COST_TYPES.includes(input.costType)) {
    errors.push(`cost type must be one of: ${SERVICE_COST_TYPES.join(', ')}`)
  }
  const amount = (input.amount ?? '').trim()
  if (!MONEY_RE.test(amount)) {
    errors.push('amount must be a decimal string like "350.00" (ADR 0044)')
  }
  if (input.costType === 'hourly' && input.hours != null) {
    if (!Number.isFinite(input.hours) || input.hours < 0) {
      errors.push('hours must be a non-negative number')
    }
  }
  for (const [kind, fee] of Object.entries(input.documentFees ?? {})) {
    if (!/^[a-z][a-z0-9_]*$/.test(kind)) {
      errors.push(`document fee kind "${kind}" must be a snake_case document kind`)
    }
    if (!MONEY_RE.test((fee ?? '').trim())) {
      errors.push(`document fee for "${kind}" must be a decimal string like "350.00" (ADR 0044)`)
    }
  }
  return { ok: errors.length === 0, errors }
}

// Reasoning summary the approve route carries from the chat turn that produced the
// proposal — the model's framing for WHY this price, plus an honest confidence the
// substrate clamps below 1.0 (an AI never claims certainty — ADR 0006 / 0020).
export interface CostReasoning {
  conclusion: string
  evidence?: unknown[]
  alternatives?: unknown[]
  confidence?: number
  modelIdentity?: string
}

// The full proposed-cost shape the create path persists.
export interface CreateCostAIInput {
  costType: ServiceCostType
  amount: string
  hours?: number | null
  // Per-document fees to declare alongside (or instead of meaningfully using) the
  // flat/hourly cost — one decimal-string amount per document kind.
  documentFees?: Record<string, string>
}

// Persist a reasoning_trace for an AI cost-set write (mirrors serviceAuthoring's):
// sourced to the Claude agent actor, confidence clamped strictly below 1.0. Returns
// the trace id the action references.
async function persistReasoningTrace(
  ctx: ActionContext,
  serviceKey: string,
  input: CreateCostAIInput,
  reasoning: CostReasoning,
): Promise<string> {
  const id = randomUUID()
  const conclusion =
    reasoning.conclusion?.trim() ||
    `Set the ${input.costType} fee for ${serviceKey} to ${input.amount}.`
  const prompt = `Set the billing (fee model) for the service "${serviceKey}".`
  await withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO reasoning_trace (
         id, tenant_id, agent_actor_id, prompt, evidence, alternatives,
         conclusion, confidence, model_identity, trace
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb)`,
      [
        id,
        ctx.tenantId,
        CLAUDE_AGENT_ACTOR_ID,
        prompt,
        JSON.stringify(reasoning.evidence ?? []),
        JSON.stringify(reasoning.alternatives ?? []),
        conclusion,
        clampConfidence(reasoning.confidence),
        reasoning.modelIdentity ?? 'claude',
        JSON.stringify({ serviceKey, ...input, ...reasoning }),
      ],
    )
  })
  return id
}

// The AI write path (the live write happens ONLY on attorney approve). Validates the
// cost, persists the reasoning_trace FIRST (so an invalid proposal leaves no trace),
// then sets the cost AS THE AGENT ACTOR via setServiceCost — which submits
// legal.service.upsert with a cost transitions_patch (the same versioned, service-
// bound path the manual cost editor uses), but here under the agent ctx + trace so the
// new version carries the agent source. Mirrors createTemplateAI's agentCtx pattern.
export async function createCostAI(
  ctx: ActionContext,
  serviceKey: string,
  input: CreateCostAIInput,
  reasoning: CostReasoning,
): Promise<ServiceDefinition> {
  const key = (serviceKey ?? '').trim()
  if (!key) throw new Error('A service_key is required to set billing.')
  const amount = (input.amount ?? '').trim()
  const hours = input.costType === 'hourly' ? (input.hours ?? null) : null
  const documentFees = input.documentFees

  // Validate BEFORE any write (incl. the trace) so an invalid proposal leaves no trace
  // row behind. (The handler/normalizeCost validates again on write — defense in depth.)
  const validation = validateProposedCost({ costType: input.costType, amount, hours, documentFees })
  if (!validation.ok) {
    throw new Error(`Invalid cost proposal: ${validation.errors.join('; ')}`)
  }

  // The service must already exist (the wizard creates the shell first) — fail loudly
  // rather than silently no-op so the approve route returns a clear error.
  const existing = await getService(ctx, key)
  if (!existing) throw new Error(`Service not found: ${key}`)

  // The write is AS THE AGENT, not the attorney — the trace and the action source
  // attribute the billing decision to the Claude agent actor, exactly like
  // createTemplateAI. ONE legal.service.upsert carries the cost AND any per-document
  // fees (the same transitions patch setServiceCost / the billing editor writes), so
  // the whole billing declaration lands atomically in one new version.
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  await persistReasoningTrace(agentCtx, key, { costType: input.costType, amount, hours }, reasoning)

  const cost: ServiceCost = { type: input.costType, amount, hours }
  await submitAction(agentCtx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'adjustment',
    payload: {
      service_key: key,
      display_name: existing.displayName,
      transitions_patch: {
        cost,
        ...(documentFees && Object.keys(documentFees).length
          ? { document_fees: documentFees }
          : {}),
      },
    },
  })
  const updated = await getService(agentCtx, key)
  if (!updated) throw new Error('Service cost saved but the new row could not be read back.')
  return updated
}

// Honest confidence: an AI cost write must never claim certainty (ADR 0006). Same shape
// as serviceAuthoring.clampConfidence — capped at 0.99 (never 1.0), with a humble 0.6
// fallback (pricing is the attorney's call; the AI only proposes it).
function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.6
  return Math.min(0.99, Math.max(0, n))
}
