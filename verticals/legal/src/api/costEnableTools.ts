// Billing + Enable chat tools (Build-Wizard Phase 6, gated) — two CAPTURE-ONLY
// ClientTools the attorney's Claude turn registers alongside the rest of the wizard,
// mirroring serviceAuthoringTools.ts exactly:
//   • buildProposeCostTool — the model calls it with a proposed fee model (hourly rate
//     or flat fixed fee). It is validated (the money decimal contract, ADR 0044) and
//     CAPTURED into a per-turn array the caller surfaces as an inline approval card. It
//     writes NOTHING — the live cost write happens only when the attorney approves.
//   • buildProposeEnableTool — the TERMINAL step. The model calls it (after
//     get_service_completeness returns ready:true) to propose ENABLING the service. It
//     captures the enable request as an approval card; the live status flip to 'active'
//     happens only on approve. This is the step the old wizard never reached — without
//     it the service stays a disabled draft (status 'deprecated' on the current row),
//     which is exactly why the founder's wizard-built service was never live.
//
// Both are capture-only (no DB read/write in run()) so they stay within the per-op
// budget and are pure to construct (the dormancy test builds them with a minimal ctx).
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import { validateProposedCost, SERVICE_COST_TYPES, type CostProposal } from './costAuthoring.js'
import { computeBillingReadout, formatBillingReadout } from './billingReadout.js'
import type { ServiceCostType } from './services.js'

// ─── propose_cost ───────────────────────────────────────────────────────────

const PROPOSE_COST_TOOL_DEF = {
  name: 'propose_cost',
  description:
    "Propose the BILLING (fee model) for a service for the attorney to review and APPROVE. This does NOT save anything — it captures the proposal so the attorney sees it as an approval card; the cost is written only when they approve. Use this AFTER the workflow, once you've asked the attorney how they price the work: 'fixed' (a flat fee — amount is the total) or 'hourly' (amount is the rate; optionally include an estimate of hours). Money is a decimal string like '350.00'. Call this ONLY when you have the attorney's price; put the proposal ONLY in this tool call, not in your chat reply.",
  input_schema: {
    type: 'object',
    properties: {
      service_key: {
        type: 'string',
        description:
          "The kind_name of the service to price (e.g. 'nc_single_member_llc_formation').",
      },
      cost_type: {
        type: 'string',
        enum: SERVICE_COST_TYPES as unknown as string[],
        description: "'fixed' (a flat fee) or 'hourly' (a per-hour rate).",
      },
      amount: {
        type: 'string',
        description:
          "The money amount as a decimal string, e.g. '1500.00' for a flat fee or '350.00' for an hourly rate.",
      },
      hours: {
        type: 'number',
        description: "For 'hourly' only: the estimated number of hours (optional).",
      },
      document_fees: {
        type: 'object',
        description:
          'For the PER-DOCUMENT billing model: one decimal-string fee per document kind (e.g. {"engagement_letter": "150.00"}), each accrued once per matter the moment the attorney approves that document. Combine with cost_type/amount ONLY for a deliberate split the attorney confirmed — the card will state the combined total and a split warning.',
        additionalProperties: { type: 'string' },
      },
      summary: {
        type: 'string',
        description:
          'A one-line plain-language summary of the pricing (shown to the attorney and recorded as the reasoning trace on approve).',
      },
      confidence: {
        type: 'number',
        description: 'Your honest confidence in this proposal, 0–1 (never 1.0).',
      },
    },
    required: ['service_key', 'cost_type', 'amount'],
    additionalProperties: false,
  },
}

// Build the propose_cost tool for this turn. Its run() validates the price (the SAME
// money contract the write path applies) and, on success, CAPTURES it into `captured`
// (read back by the caller to surface the approval card) — it never writes. It READS
// the service (BUILDER-CERT-1 WP1) to compute the composed-billing read-out the card
// states: the total per-matter charge this cost + the service's declared document
// fees produce, so a double-bill is deliberate and visible.
export function buildProposeCostTool(ctx: ActionContext, captured: CostProposal[]): ClientTool {
  return {
    definition: PROPOSE_COST_TOOL_DEF,
    name: 'propose_cost',
    run: async (raw) => {
      const args = (raw ?? {}) as {
        service_key?: string
        cost_type?: string
        amount?: string
        hours?: number
        document_fees?: Record<string, string>
        summary?: string
        confidence?: number
      }
      const serviceKey = (args.service_key ?? '').trim()
      if (!serviceKey) return 'A service_key is required to propose billing; nothing was captured.'
      const costType = (args.cost_type ?? '') as ServiceCostType
      const amount = (args.amount ?? '').trim()
      const hours = costType === 'hourly' && typeof args.hours === 'number' ? args.hours : null
      const documentFees =
        args.document_fees &&
        typeof args.document_fees === 'object' &&
        Object.keys(args.document_fees).length
          ? args.document_fees
          : undefined
      const validation = validateProposedCost({ costType, amount, hours, documentFees })
      if (!validation.ok) {
        return `The proposed billing is not valid and was NOT captured. Fix these and call propose_cost AGAIN — NEVER paste the artifact into your prose reply (prose has no Approve button): ${validation.errors.join('; ')}`
      }
      const confidence =
        typeof args.confidence === 'number' && Number.isFinite(args.confidence)
          ? Math.min(0.99, Math.max(0, args.confidence))
          : 0.6 // matches costAuthoring.clampConfidence / serviceAuthoring (humble default)
      // BUILDER-CERT-1 (WP1) — the cost card STATES the total per-matter charge the
      // composed billing produces (this proposed cost + the service's declared
      // per-document fees), computed from the real service row, never model prose.
      const readout = await computeBillingReadout(ctx, serviceKey, {
        proposedCost: { costType, amount, hours },
        ...(documentFees ? { proposedDocumentFees: documentFees } : {}),
      })
      const billingLine = readout ? ` ${formatBillingReadout(readout)}` : ''
      const warningText = readout?.splitWarning
        ? ` WARNING (non-blocking — the card shows it; relay it to the attorney in one short line): ${readout.splitWarning}`
        : ''
      captured.push({
        serviceKey,
        costType,
        amount,
        hours,
        ...(documentFees ? { documentFees } : {}),
        summary:
          ((args.summary ?? '').trim() ||
            `Proposed ${costType} billing of ${amount} for ${serviceKey}.`) +
          billingLine +
          (readout?.splitWarning ? ` ⚠ ${readout.splitWarning}` : ''),
        confidence,
      })
      return `The proposed ${costType} fee (${amount}) is shown to the attorney as an approval card; it is NOT saved until they approve.${billingLine}${warningText} The card renders BELOW your reply (never say "above"). If you already wrote a framing sentence this turn, reply with an EMPTY message — otherwise ONE short sentence; NEVER repeat the price in prose.`
    },
  }
}

// ─── propose_enable (the TERMINAL step) ──────────────────────────────────────

// A captured request to ENABLE (publish) a service — the terminal wizard step. The
// chat surfaces it as an approval card; the attorney approves it, which posts the
// lifecycle enable route (the only place set_active(true) is called). Capturing it as
// a proposal — not auto-enabling — keeps the human gate: the attorney owns going live.
export interface EnableProposal {
  serviceKey: string
  summary: string
}

const PROPOSE_ENABLE_TOOL_DEF = {
  name: 'propose_enable',
  description:
    "Propose ENABLING a service — making it live and bookable — for the attorney to approve. This is the FINAL step of a guided build and does NOT change anything: it shows the attorney an Enable approval card; the service goes live only when they approve. Call this ONLY after get_service_completeness returns ready:true (a service that isn't complete cannot be enabled). Once you propose this, the build is DONE — do not start another step. Put the proposal ONLY in this tool call; your chat reply is ONE short sentence telling the attorney this is the last step.",
  input_schema: {
    type: 'object',
    properties: {
      service_key: {
        type: 'string',
        description: 'The kind_name of the completed service to enable (make bookable).',
      },
      summary: {
        type: 'string',
        description: 'A one-line summary confirming the service is complete and ready to go live.',
      },
    },
    required: ['service_key'],
    additionalProperties: false,
  },
}

// Build the propose_enable tool for this turn. Capture-only: it records the enable
// request so the caller can surface the terminal Enable card. The completeness gate is
// re-checked server-side by the set_active handler on approve, so a not-yet-ready
// enable is rejected at the write even if the model proposed it early.
export function buildProposeEnableTool(ctx: ActionContext, captured: EnableProposal[]): ClientTool {
  void ctx
  return {
    definition: PROPOSE_ENABLE_TOOL_DEF,
    name: 'propose_enable',
    run: async (raw) => {
      const args = (raw ?? {}) as { service_key?: string; summary?: string }
      const serviceKey = (args.service_key ?? '').trim()
      if (!serviceKey) return 'A service_key is required to propose enabling; nothing was captured.'
      captured.push({
        serviceKey,
        summary:
          (args.summary ?? '').trim() ||
          `${serviceKey} is complete — approve to make it live and bookable.`,
      })
      return `The Enable step for "${serviceKey}" is shown to the attorney as the final approval card; the service goes live only when they approve. This is the LAST step — the build is complete. Reply with ONE short sentence telling them to approve it to go live. Do NOT start another step or claim it is live yet.`
    },
  }
}
