// BUILDER-CERT-1 (WP1) — the composed-billing read-out. One shared helper computes,
// from the service's DECLARED billing (per-document fees + the flat service cost) and
// an optionally PROPOSED replacement cost, the total per-matter charge the composed
// billing produces — so every workflow/cost approval card STATES that total and a
// double-bill is always deliberate and visible, never emergent.
//
// The charge model this reads out (the platform's actual accrual mechanics):
//   • transitions.document_fees[kind] accrues ONCE per matter+kind when that document
//     is approved (handlers/draft.ts, idempotent).
//   • transitions.cost type 'fixed' accrues ONCE per matter+service as the service
//     fee — at completion (legal.service.complete), or earlier if the attorney adds
//     the service fee by hand at an invoice step (handlers/fee.ts dedupes both paths
//     by matter+service_key, so it is one charge either way).
//   • an approve_send_invoice step COLLECTS accrued unbilled fees — it is a billing
//     POINT, not an additional charge.
//   • type 'hourly' bills rate × recorded time — indeterminate per matter up front.
import type { ActionContext } from '@exsto/substrate'
import { getService, type ServiceCost } from './services.js'
import type { Lifecycle } from '../lifecycle/index.js'

export interface BillingReadout {
  // One plain-language line per billing point, in accrual order.
  lines: string[]
  // The deterministic per-matter total (document fees + fixed service fee) as a
  // decimal string — null when the service bills hourly (indeterminate).
  totalFixed: string | null
  // How many distinct CHARGE declarations exist (document fees count as one point,
  // the fixed service fee as one). Invoice steps collect, they don't add.
  chargePoints: number
  // Set when BOTH a document fee and a fixed service fee are declared — a split
  // (double) billing composition. Legitimate only when deliberate.
  splitWarning: string | null
}

function money(n: number): string {
  return n.toFixed(2)
}

// Compute the read-out for a service, optionally as if `proposedCost` replaced the
// service's current cost (the propose_cost card) and optionally against a proposed
// `graph` (the propose_workflow card — used only to name invoice/completion steps).
export async function computeBillingReadout(
  ctx: ActionContext,
  serviceKey: string,
  opts?: {
    proposedCost?: { costType: 'fixed' | 'hourly'; amount: string; hours: number | null }
    // Per-document fees proposed alongside the cost (the propose_cost card) — when
    // present they REPLACE the service's declared fees in the read-out.
    proposedDocumentFees?: Record<string, string>
    graph?: Lifecycle
  },
): Promise<BillingReadout | null> {
  const svc = await getService(ctx, serviceKey)
  if (!svc) return null
  const cost: ServiceCost | null = opts?.proposedCost
    ? {
        type: opts.proposedCost.costType,
        amount: opts.proposedCost.amount,
        hours: opts.proposedCost.hours,
      }
    : svc.cost
  const documentFees = opts?.proposedDocumentFees ?? svc.documentFees

  const lines: string[] = []
  let total = 0
  let chargePoints = 0
  let hourly = false

  const feeKinds = Object.keys(documentFees)
  if (feeKinds.length > 0) {
    chargePoints++
    for (const kind of feeKinds) {
      const amt = Number(documentFees[kind])
      total += Number.isFinite(amt) ? amt : 0
      lines.push(
        `$${documentFees[kind]} accrues when the ${kind.replace(/_/g, ' ')} document is approved`,
      )
    }
  }

  if (cost?.type === 'fixed') {
    chargePoints++
    total += Number(cost.amount)
    lines.push(`$${cost.amount} service fee accrues at completion (or when invoiced mid-matter)`)
  } else if (cost?.type === 'hourly') {
    hourly = true
    chargePoints++
    const est =
      typeof cost.hours === 'number' && cost.hours > 0
        ? ` (est. ${cost.hours}h ≈ $${money(Number(cost.amount) * cost.hours)})`
        : ''
    lines.push(`hourly billing at $${cost.amount}/hour${est} — total depends on time recorded`)
  }

  const hasInvoiceStep = (opts?.graph ?? []).some((s) => s.action?.kind === 'approve_send_invoice')
  if (hasInvoiceStep) {
    lines.push(
      'an invoice step collects the accrued fees mid-matter (a billing point, not an extra charge)',
    )
  }

  if (lines.length === 0) {
    lines.push('no billing is declared on this service yet')
  }

  // Split = per-document fees PLUS a service cost of either type. Fixed doubles a
  // deterministic total; hourly stacks time-billing on top of document fees — both
  // are two charge declarations and legitimate only when deliberate.
  const splitWarning =
    feeKinds.length > 0 && cost
      ? cost.type === 'fixed'
        ? `this composition bills TWICE per matter — per-document fee(s) on approval AND a $${cost.amount} service fee at completion (total $${money(total)}). A split is legitimate only when the attorney chose it deliberately; if they wanted ONE billing point, drop either the document fee(s) or the service fee.`
        : `this composition bills TWICE per matter — per-document fee(s) on approval AND hourly billing at $${cost.amount}/hour. A split is legitimate only when the attorney chose it deliberately; if they wanted ONE billing point, drop either the document fee(s) or the hourly rate.`
      : null

  return {
    lines,
    totalFixed: hourly ? null : money(total),
    chargePoints,
    splitWarning,
  }
}

// The one-line card sentence: what this matter will be charged, stated on every
// workflow/cost approval card so the attorney owns the composed total explicitly.
export function formatBillingReadout(r: BillingReadout): string {
  const total =
    r.chargePoints === 0
      ? 'No charge is declared yet — the billing step sets it.'
      : r.totalFixed !== null
        ? `Total per matter: $${r.totalFixed}.`
        : 'Total per matter: hourly — depends on time recorded.'
  return `Billing read-out — ${r.lines.join('; ')}. ${total}`
}
