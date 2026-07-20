// Backfill mapping (ADR 0045 §6): today's hardcoded matter lifecycle expressed as
// data. This is the SINGLE SOURCE OF TRUTH for what an existing service's `states`
// should be, used both by the backfill script and by the equality invariant that
// proves the data reproduces current behavior before the engine ever reads it (PR3).
//
// Faithfulness is the whole point. The only thing the engine branches on today is
// `route === 'auto'` in api/granolaIngestion.ts (auto-draft on transcript ingest).
// So the ONLY `automatic` edge this produces is `consulted → in_review`, and only
// when route === 'auto'. Everything else is client/attorney/system gated — i.e. it
// happens exactly when a person or an external callback makes it happen, just like
// today. Downstream stages that no handler writes yet (e.g. `completed`) are present
// but only reachable through non-automatic gates, so a matter sits where it sits now.
import type { Lifecycle, LifecycleStage } from './types.js'

export interface DeriveInput {
  route: 'auto' | 'manual'
  // Whether the service offers consultation booking (adds the booking branch).
  bookingEnabled: boolean
}

// The matter_status vocabulary handlers write today (the Explore map of the engine).
// derive() must only emit stages from this set (+ the forward-looking terminal).
export const WRITTEN_STATUSES = [
  'inquiry',
  'intake_submitted',
  'questionnaire_submitted',
  'consultation_booked',
  'consultation_cancelled',
  'consulted',
  'in_review',
  'approved',
] as const

// `completed` has a client label today but no handler writes it; it is the natural
// terminal and is only ever reached by an attorney/system gate, so including it
// changes no current behavior (a matter still stops at `approved`).
export const FORWARD_TERMINAL = 'completed' as const

export function deriveLifecycleFromService(input: DeriveInput): Lifecycle {
  const { route, bookingEnabled } = input

  const stages: LifecycleStage[] = [
    {
      key: 'inquiry',
      label: 'Inquiry',
      client_label: 'Inquiry received',
      entry: true,
      advances_to: [{ to: 'intake_submitted', gate: 'client', via: 'matter.open' }],
    },
    {
      key: 'intake_submitted',
      label: 'Intake submitted',
      client_label: 'Intake received',
      advances_to: [
        { to: 'questionnaire_submitted', gate: 'client', via: 'legal.questionnaire.submit' },
        // A client can always have a transcript ingested directly (call.ingest),
        // booking or not — so consulted is reachable without the booking branch.
        { to: 'consulted', gate: 'system', on: 'call.ingest' },
        // B1.1 parity fix: same structural bug as authored.ts's stage 1 — a CLIENT
        // edge gated on `via: 'booking.create'` can never be reached by the system
        // `intake.completed` dispatch matter.open fires (signalEvent only matches
        // system/automatic `on:` edges). Mirror the authored.ts fix so a service on
        // the derived (legacy-backfill) lifecycle does not strand the same way.
        ...(bookingEnabled
          ? [{ to: 'consultation_booked', gate: 'system' as const, on: 'intake.completed' }]
          : []),
      ],
    },
    {
      key: 'questionnaire_submitted',
      label: 'Questionnaire submitted',
      client_label: 'Questionnaire received',
      advances_to: [{ to: 'consulted', gate: 'system', on: 'call.ingest' }],
    },
    ...(bookingEnabled
      ? ([
          {
            key: 'consultation_booked',
            label: 'Consultation booked',
            client_label: 'Consultation booked',
            advances_to: [
              { to: 'consulted', gate: 'system', on: 'call.ingest' },
              { to: 'consultation_cancelled', gate: 'client', via: 'booking.cancel' },
            ],
          },
          {
            key: 'consultation_cancelled',
            label: 'Consultation cancelled',
            client_label: 'Consultation cancelled',
            advances_to: [{ to: 'consultation_booked', gate: 'client', via: 'booking.create' }],
          },
        ] as LifecycleStage[])
      : []),
    {
      key: 'consulted',
      label: 'Consulted',
      client_label: 'Consultation complete',
      // THE route hinge: auto ⇒ the worker auto-drafts (automatic); manual ⇒ an
      // attorney triggers drafting. Mirrors `route !== 'auto'` in granolaIngestion.
      advances_to: [
        route === 'auto'
          ? { to: 'in_review', gate: 'automatic', on: 'draft.completed' }
          : { to: 'in_review', gate: 'attorney', via: 'draft.request' },
      ],
    },
    {
      key: 'in_review',
      label: 'Attorney review',
      client_label: 'Under attorney review',
      advances_to: [{ to: 'approved', gate: 'attorney', via: 'draft.approve' }],
    },
    {
      key: 'approved',
      label: 'Approved',
      client_label: 'Approved',
      // Forward-looking, non-automatic: a matter rests here today (no handler writes
      // `completed`), exactly as now.
      advances_to: [{ to: FORWARD_TERMINAL, gate: 'attorney', via: 'document.complete' }],
    },
    {
      key: FORWARD_TERMINAL,
      label: 'Completed',
      client_label: 'Completed',
      terminal: true,
      advances_to: [],
    },
  ]

  return stages
}
