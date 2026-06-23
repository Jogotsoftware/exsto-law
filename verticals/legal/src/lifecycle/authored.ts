// Authored product workflows (PR3) — the deliberately-shaped lifecycle a service
// RUNS, distinct from derive.ts's faithful legacy backfill. The first is the
// founder's 5-step NC Single-Member LLC workflow. A service adopts one of these via
// legal.service.set_lifecycle (PR4): new matters then run these steps, while matters
// already in flight keep the workflow_definition version they were opened against
// (invariant 17). Stage `key`s ARE the live matter_status vocabulary so the running
// instance, the matter_status mirror, and the read path stay consistent.
import type { Lifecycle } from './types.js'

export const NC_SMLLC_AUTHORED: Lifecycle = [
  {
    key: 'intake_submitted',
    label: 'Client Intake',
    client_label: 'Intake',
    entry: true,
    action: { kind: 'view_intake' },
    // Client submits the intake + books the consultation.
    advances_to: [{ to: 'consultation_booked', gate: 'client', via: 'booking.create' }],
  },
  {
    key: 'consultation_booked',
    label: 'Client Consultation',
    client_label: 'Consultation',
    blocking: false, // informational — the Granola summary; never holds the matter up
    action: { kind: 'view_consultation' },
    // Attorney "Continue" advances the informational step.
    advances_to: [{ to: 'in_review', gate: 'attorney', via: 'legal.matter.advance' }],
  },
  {
    key: 'in_review',
    label: 'Review & Send document',
    client_label: 'Document review',
    action: { kind: 'review_send_document' },
    // The Operating Agreement template IS this task (a "whole task" document).
    documents: [{ docKind: 'operating_agreement', label: 'Operating Agreement' }],
    // Approving the document advances the matter; the same window sends it.
    advances_to: [{ to: 'approved', gate: 'attorney', via: 'draft.approve' }],
  },
  {
    key: 'approved',
    label: 'Approve & Send invoice',
    client_label: 'Invoice',
    action: { kind: 'approve_send_invoice' },
    // Attorney approves; invoice auto-sends; matter then waits for payment.
    advances_to: [{ to: 'closed', gate: 'system', on: 'invoice.paid' }],
  },
  {
    key: 'closed',
    label: 'Invoice paid — Matter complete',
    client_label: 'Complete',
    terminal: true,
    action: { kind: 'complete_matter' },
    advances_to: [],
  },
]

// Built-in authored workflows keyed by the service kind_name they target.
export const AUTHORED_WORKFLOWS: Record<string, Lifecycle> = {
  nc_single_member_llc_formation: NC_SMLLC_AUTHORED,
}
