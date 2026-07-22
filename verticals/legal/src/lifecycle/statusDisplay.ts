// The attorney-facing STATUS chip for a matter, derived from its RUNNING workflow —
// the real source of truth for where a matter is. (The `matter_status` attribute is
// only a mirror and drifts: a matter can be at `esign` in its instance while the
// mirror still reads `approved`/`consultation_cancelled`. Reading the instance's
// current state fixes the list, which used to render every matter as "New Inquiry"
// because the mirror's raw values matched none of the old chip buckets.)
//
// The category is resolved CONFIG-FIRST: the step's catalog `action.kind`, then its
// outgoing gate/event. Nothing here is keyed to the LLC service's specific state
// names, so it labels any service's authored graph correctly.
import type { Lifecycle } from './types.js'
import { stageByKey } from './resolve.js'

export type StageCategory =
  | 'waiting_client' // the matter is held until the client does something (accept, sign)
  | 'waiting_attorney' // the matter is held until the attorney does something (review, approve)
  | 'awaiting_billing' // the attorney still has to approve + send the invoice
  | 'awaiting_payment' // the invoice is out; waiting for the client to pay
  | 'ready_to_close' // terminal / completed — nothing left but to close it out
  | 'cancelled' // the workflow was cancelled
  | 'unknown' // no legible signal (e.g. an automatic hop, or an unmapped legacy status)

export interface StageDisplay {
  category: StageCategory
  label: string
}

const LABELS: Record<StageCategory, string> = {
  waiting_client: 'Waiting on client',
  waiting_attorney: 'Waiting on attorney',
  awaiting_billing: 'Awaiting billing',
  awaiting_payment: 'Awaiting payment',
  ready_to_close: 'Ready to close',
  cancelled: 'Cancelled',
  unknown: 'In progress',
}

function humanize(s: string): string {
  const t = s.replace(/_/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : LABELS.unknown
}

// Derive the chip from a matter's running instance: the bound graph, the instance's
// current state, and the instance status. This is the primary path — used whenever a
// matter HAS a workflow instance.
export function deriveStageFromWorkflow(
  graph: Lifecycle,
  currentState: string,
  wfStatus: string,
): StageDisplay {
  if (wfStatus === 'cancelled') return { category: 'cancelled', label: LABELS.cancelled }
  if (wfStatus === 'completed') return { category: 'ready_to_close', label: LABELS.ready_to_close }

  const stage = stageByKey(graph, currentState)
  if (!stage) return { category: 'unknown', label: humanize(currentState) }
  if (stage.terminal) return { category: 'ready_to_close', label: LABELS.ready_to_close }

  // Config-first: the step's catalog action names the wait directly, independent of
  // how the graph is wired.
  switch (stage.action?.kind) {
    case 'await_payment':
      return { category: 'awaiting_payment', label: LABELS.awaiting_payment }
    case 'approve_send_invoice':
      return { category: 'awaiting_billing', label: LABELS.awaiting_billing }
    case 'esign':
      return { category: 'waiting_client', label: LABELS.waiting_client } // the client signs
    case 'complete_matter':
      return { category: 'ready_to_close', label: LABELS.ready_to_close }
    default:
      break
  }

  // Otherwise the outgoing edge's gate says who must act to advance the matter.
  const edges = stage.advances_to ?? []
  if (edges.some((e) => e.gate === 'client')) {
    return { category: 'waiting_client', label: LABELS.waiting_client }
  }
  if (edges.some((e) => e.gate === 'attorney')) {
    return { category: 'waiting_attorney', label: LABELS.waiting_attorney }
  }
  // A system/automatic gate waits on an external callback; the event names it.
  const sysEdge = edges.find((e) => e.gate === 'system' || e.gate === 'automatic')
  if (sysEdge) {
    const on = (sysEdge.on ?? '').toLowerCase()
    if (on.includes('paid') || on.includes('payment')) {
      return { category: 'awaiting_payment', label: LABELS.awaiting_payment }
    }
    if (on.includes('sign')) return { category: 'waiting_client', label: LABELS.waiting_client }
  }

  return { category: 'unknown', label: humanize(stage.label ?? currentState) }
}

// Fallback for a matter with NO running workflow instance (engine flag was off at
// open, or the service has no authored lifecycle): the legacy `matter_status`
// attribute is all we have. Map the values we know; humanize the rest.
export function deriveStageFromLegacyStatus(status: string): StageDisplay {
  switch (status) {
    case 'inquiry':
    case 'intake_submitted':
    case 'questionnaire_pending':
    case 'questionnaire_submitted':
      return { category: 'waiting_attorney', label: 'New inquiry' }
    case 'matter_closed':
    case 'complete':
    case 'completed':
      return { category: 'ready_to_close', label: LABELS.ready_to_close }
    default:
      return { category: 'unknown', label: humanize(status) }
  }
}
