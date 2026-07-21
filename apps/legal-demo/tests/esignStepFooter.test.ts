// ESIGN-UNIFY-1 ES-4 — the runner footer doctrine (#442), pinned against the
// pure predicate the matter workflow window renders from (shared.tsx
// stepAdvanceControls). The e-sign step's ONLY edge is the system gate on
// esign.completed, so the footer must offer NO bare Continue and NO Skip — its
// own Review & send is the completing action; the workflow advances when the
// envelope completes.
import { describe, expect, it } from 'vitest'
import { stepAdvanceControls, type WfStage } from '../app/attorney/matters/[id]/shared'

const esignStage: WfStage = {
  key: 'esign_operating_agreement',
  label: 'eSign — send for signature',
  action: { kind: 'esign', config: { document_kind: 'operating_agreement' } },
  documents: [{ docKind: 'operating_agreement', label: 'Operating agreement' }],
  advances_to: [{ to: 'approved', gate: 'system', on: 'esign.completed' }],
}

describe('no-dead-Continue: the e-sign step footer (#442)', () => {
  it('current e-sign step: no Continue, no Skip — it waits on esign.completed', () => {
    const c = stepAdvanceControls(esignStage, true)
    expect(c.continueEdge).toBeNull()
    expect(c.skipEdge).toBeNull()
    expect(c.waitsOnSystem).toBe(true)
  })

  it('non-current e-sign step: nothing at all', () => {
    const c = stepAdvanceControls(esignStage, false)
    expect(c.continueEdge).toBeNull()
    expect(c.skipEdge).toBeNull()
    expect(c.waitsOnSystem).toBe(false)
  })
})

describe('stepAdvanceControls matches the pre-extraction runner behavior', () => {
  it('an attorney edge via its own completing action (draft.approve) hides Continue', () => {
    const review: WfStage = {
      key: 'in_review',
      label: 'Review & Send document',
      action: { kind: 'review_send_document' },
      advances_to: [{ to: 'esign_operating_agreement', gate: 'attorney', via: 'draft.approve' }],
    }
    const c = stepAdvanceControls(review, true)
    expect(c.continueEdge).toBeNull()
    expect(c.skipEdge).toBeNull()
    expect(c.waitsOnSystem).toBe(false)
  })

  it('a plain attorney advance (legal.matter.advance) shows Continue', () => {
    const consultation: WfStage = {
      key: 'consultation_booked',
      label: 'Client Consultation',
      action: { kind: 'view_consultation' },
      advances_to: [{ to: 'in_review', gate: 'attorney', via: 'legal.matter.advance' }],
    }
    const c = stepAdvanceControls(consultation, true)
    expect(c.continueEdge).toEqual({
      to: 'in_review',
      gate: 'attorney',
      via: 'legal.matter.advance',
    })
    expect(c.skipEdge).toBeNull()
  })

  it('a client-gated step shows Skip (advance without the client), never Continue', () => {
    const clientWait: WfStage = {
      key: 'materials',
      label: 'Client materials',
      advances_to: [{ to: 'in_review', gate: 'client', via: 'document.upload' }],
    }
    const c = stepAdvanceControls(clientWait, true)
    expect(c.continueEdge).toBeNull()
    expect(c.skipEdge).toEqual({ to: 'in_review', gate: 'client', via: 'document.upload' })
  })

  it('billing precedent (approve_send_invoice → invoice.paid) waits on system exactly like e-sign', () => {
    const billing: WfStage = {
      key: 'approved',
      label: 'Approve & Send invoice',
      action: { kind: 'approve_send_invoice' },
      advances_to: [{ to: 'closed', gate: 'system', on: 'invoice.paid' }],
    }
    const c = stepAdvanceControls(billing, true)
    expect(c.continueEdge).toBeNull()
    expect(c.waitsOnSystem).toBe(true)
  })
})
