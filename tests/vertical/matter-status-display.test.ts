// The matter STATUS chip is derived from the matter's LIVE workflow, not the stale
// `matter_status` mirror. Before this, the matters list read the mirror and matched
// it against a 5-bucket legacy set — so every real workflow state (esign, approve,
// await_payment …) fell through to "New Inquiry". These tests pin the mapping the
// list/home/detail now render: gate + catalog action → the attorney's vocabulary
// (waiting on client/attorney, awaiting billing/payment, ready to close, cancelled).
import { describe, it, expect } from 'vitest'
import { deriveStageFromWorkflow, deriveStageFromLegacyStatus, type Lifecycle } from '@exsto/legal'

// The single-member LLC operating-agreement graph (the live service), trimmed to the
// fields the derivation reads. Mirrors workflow_definition.states in prod.
const LLC: Lifecycle = [
  {
    key: 'intake',
    label: 'Client intake',
    entry: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'review_send', via: 'legal.client_request.accept', gate: 'client' }],
  },
  {
    key: 'review_send',
    label: 'Review & send operating agreement',
    action: { kind: 'review_send_document' },
    advances_to: [{ to: 'consultation', via: 'draft.approve', gate: 'attorney' }],
  },
  {
    key: 'consultation',
    label: 'Client consultation',
    action: { kind: 'view_consultation' },
    blocking: false,
    advances_to: [{ to: 'esign_operating_agreement', via: 'draft.approve', gate: 'attorney' }],
  },
  {
    key: 'esign_operating_agreement',
    label: 'eSign',
    action: { kind: 'esign', config: { document_kind: 'operating_agreement' } },
    advances_to: [{ on: 'esign.completed', to: 'approve_invoice', gate: 'system' }],
  },
  {
    key: 'approve_invoice',
    label: 'Approve & send invoice',
    action: { kind: 'approve_send_invoice' },
    advances_to: [{ to: 'await_payment', via: 'legal.matter.advance', gate: 'attorney' }],
  },
  {
    key: 'await_payment',
    label: 'Await payment',
    action: { kind: 'await_payment' },
    advances_to: [{ on: 'invoice.paid', to: 'complete', gate: 'system' }],
  },
  {
    key: 'complete',
    label: 'Complete matter',
    action: { kind: 'complete_matter' },
    blocking: false,
    terminal: true,
    advances_to: [],
  },
]

describe('deriveStageFromWorkflow — LLC operating-agreement lifecycle', () => {
  const cases: Array<[string, string, string]> = [
    // [currentState, expected category, expected label]
    ['intake', 'waiting_client', 'Waiting on client'], // client must accept
    ['review_send', 'waiting_attorney', 'Waiting on attorney'], // attorney reviews/sends
    ['consultation', 'waiting_attorney', 'Waiting on attorney'], // attorney-gated
    ['esign_operating_agreement', 'waiting_client', 'Waiting on client'], // client signs
    ['approve_invoice', 'awaiting_billing', 'Awaiting billing'], // attorney sends invoice
    ['await_payment', 'awaiting_payment', 'Awaiting payment'], // client pays
    ['complete', 'ready_to_close', 'Ready to close'], // terminal
  ]
  for (const [state, category, label] of cases) {
    it(`${state} → ${label}`, () => {
      const s = deriveStageFromWorkflow(LLC, state, 'active')
      expect(s.category).toBe(category)
      expect(s.label).toBe(label)
    })
  }

  it('a cancelled instance shows Cancelled regardless of where it stopped', () => {
    const s = deriveStageFromWorkflow(LLC, 'esign_operating_agreement', 'cancelled')
    expect(s).toEqual({ category: 'cancelled', label: 'Cancelled' })
  })

  it('a completed instance is Ready to close even mid-graph', () => {
    const s = deriveStageFromWorkflow(LLC, 'review_send', 'completed')
    expect(s.category).toBe('ready_to_close')
  })

  it('an unknown current state degrades to a humanized label, not "New Inquiry"', () => {
    const s = deriveStageFromWorkflow(LLC, 'some_new_state', 'active')
    expect(s.category).toBe('unknown')
    expect(s.label).toBe('Some new state')
  })
})

describe('deriveStageFromWorkflow — gate/event fallbacks without a catalog action', () => {
  it('a system edge on invoice.paid reads as awaiting payment', () => {
    const g: Lifecycle = [
      {
        key: 'p',
        label: 'Payment',
        advances_to: [{ on: 'invoice.paid', to: 'done', gate: 'system' }],
      },
    ]
    expect(deriveStageFromWorkflow(g, 'p', 'active').category).toBe('awaiting_payment')
  })
  it('a system edge on an esign event reads as waiting on client', () => {
    const g: Lifecycle = [
      {
        key: 's',
        label: 'Sign',
        advances_to: [{ on: 'esign.completed', to: 'done', gate: 'system' }],
      },
    ]
    expect(deriveStageFromWorkflow(g, 's', 'active').category).toBe('waiting_client')
  })
})

describe('deriveStageFromLegacyStatus — no running workflow instance', () => {
  it('maps intake-ish legacy statuses to a New inquiry (attorney to act)', () => {
    expect(deriveStageFromLegacyStatus('intake_submitted')).toEqual({
      category: 'waiting_attorney',
      label: 'New inquiry',
    })
  })
  it('maps closed/complete legacy statuses to Ready to close', () => {
    expect(deriveStageFromLegacyStatus('matter_closed').category).toBe('ready_to_close')
  })
  it('humanizes an unmapped legacy status instead of guessing', () => {
    expect(deriveStageFromLegacyStatus('some_legacy').label).toBe('Some legacy')
  })
})
