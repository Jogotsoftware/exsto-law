// TASK-QUEUE-1 — the unified attorney Task Queue aggregates document review,
// e-sign, billing, and client-request sources into one AttorneyTask row shape.
// Tested here against the PURE per-source normalizers/filters
// (verticals/legal/src/queries/attorneyTasks.ts) — no DB needed, mirrors
// esign-attorney-awaiting.test.ts's approach for esign.ts's pure planners.
import { describe, expect, it } from 'vitest'
import {
  humanizeKind,
  normalizeDocumentReviewTask,
  normalizeEsignTask,
  isUnsentIssuedInvoice,
  normalizeInvoiceTask,
  isOpenPaymentReport,
  normalizePaymentReportTask,
  normalizeClientRequestTask,
  normalizeWorkflowStepTask,
  normalizeTodoTask,
  type PendingDraftSummary,
  type AwaitingAttorneySignature,
  type InvoiceSummary,
  type PaymentReport,
  type AttorneyRequestItem,
  type WorkflowStepAwaitingAttorney,
  type AttorneyTodoTask,
} from '@exsto/legal'

function draft(overrides: Partial<PendingDraftSummary> = {}): PendingDraftSummary {
  return {
    documentVersionId: 'dv-1',
    documentEntityId: 'doc-1',
    matterEntityId: 'matter-1',
    matterNumber: 'M-0001',
    clientName: 'Jane Client',
    documentKind: 'operating_agreement',
    versionNumber: 1,
    status: 'pending_review',
    recordedAt: '2026-07-20T10:00:00+00:00',
    channel: 'document',
    emailSubject: null,
    emailToRole: null,
    voiceViolations: null,
    ...overrides,
  }
}

function signature(overrides: Partial<AwaitingAttorneySignature> = {}): AwaitingAttorneySignature {
  return {
    requestId: 'req-1',
    envelopeId: 'env-1',
    subject: 'Please sign',
    matterNumber: 'M-0002',
    matterEntityId: 'matter-2',
    contactEntityId: 'contact-1',
    contactName: 'John Signer',
    documentKind: 'engagement_letter',
    sentAt: '2026-07-19T09:00:00+00:00',
    ...overrides,
  }
}

function invoice(overrides: Partial<InvoiceSummary> = {}): InvoiceSummary {
  return {
    invoiceEntityId: 'inv-1',
    invoiceNumber: 'INV-0001',
    status: 'issued',
    clientName: 'Acme Co',
    total: '250.00',
    currency: 'USD',
    issuedDate: '2026-07-18',
    lineCount: 2,
    createdAt: '2026-07-18T08:00:00.000Z',
    ...overrides,
  }
}

function paymentReport(overrides: Partial<PaymentReport> = {}): PaymentReport {
  return {
    eventId: 'evt-1',
    invoiceEntityId: 'inv-2',
    invoiceNumber: 'INV-0002',
    invoiceStatus: 'issued',
    method: 'zelle',
    reference: 'ZL-123',
    payerName: 'Bob Payer',
    note: null,
    wallet: null,
    screenshotKey: null,
    reportedAt: '2026-07-17T12:00:00+00:00',
    status: 'open',
    dismissedReason: null,
    ...overrides,
  }
}

function clientRequest(overrides: Partial<AttorneyRequestItem> = {}): AttorneyRequestItem {
  return {
    requestEntityId: 'creq-1',
    requestType: 'document_change',
    status: 'requested',
    description: 'Please update the address on file',
    amount: '0.00',
    currency: 'USD',
    priceBasis: 'flat',
    createdAt: '2026-07-16T14:00:00+00:00',
    matterEntityId: 'matter-3',
    matterNumber: 'M-0003',
    clientName: 'Carla Client',
    ...overrides,
  }
}

function workflowStep(
  overrides: Partial<WorkflowStepAwaitingAttorney> = {},
): WorkflowStepAwaitingAttorney {
  return {
    matterEntityId: 'matter-4',
    matterNumber: 'M-0004',
    clientName: 'Dana Client',
    title: 'Review draft',
    since: '2026-07-15T11:00:00+00:00',
    ...overrides,
  }
}

function todoTask(overrides: Partial<AttorneyTodoTask> = {}): AttorneyTodoTask {
  return {
    taskId: 'task-1',
    matterEntityId: 'matter-5',
    matterNumber: 'M-0005',
    clientName: 'Evan Client',
    title: 'Call the county recorder',
    status: 'open',
    dueDate: '2026-07-25',
    createdAt: '2026-07-14T09:30:00.000Z',
    ...overrides,
  }
}

describe('humanizeKind', () => {
  it('replaces underscores with spaces', () => {
    expect(humanizeKind('operating_agreement')).toBe('operating agreement')
  })
  it('leaves a string with no underscores unchanged', () => {
    expect(humanizeKind('memo')).toBe('memo')
  })
})

describe('normalizeDocumentReviewTask', () => {
  it('uses the humanized document kind as title for a document channel', () => {
    const task = normalizeDocumentReviewTask(draft({ documentKind: 'operating_agreement' }))
    expect(task.title).toBe('operating agreement')
    expect(task.type).toBe('document_review')
    expect(task.typeLabel).toBe('Document Review')
    expect(task.subtype).toBe('document')
  })

  it('uses the email subject as title for a communication channel', () => {
    const task = normalizeDocumentReviewTask(
      draft({ channel: 'communication', emailSubject: 'Re: your matter', documentKind: 'memo' }),
    )
    expect(task.title).toBe('Re: your matter')
    expect(task.subtype).toBe('communication')
  })

  it('falls back to the humanized kind when a communication draft has no subject', () => {
    const task = normalizeDocumentReviewTask(
      draft({ channel: 'communication', emailSubject: null, documentKind: 'status_update' }),
    )
    expect(task.title).toBe('status update')
  })

  it('maps id/date/href/dateLabel', () => {
    const task = normalizeDocumentReviewTask(draft({ documentVersionId: 'dv-42' }))
    expect(task.id).toBe('dv-42')
    expect(task.workHref).toBe('/attorney/review/dv-42')
    expect(task.dateLabel).toBe('Generated')
    expect(task.date).toBe('2026-07-20T10:00:00+00:00')
    expect(task.viewHref).toBeNull()
  })

  it('carries matter/client through, and nulls contactEntityId', () => {
    const task = normalizeDocumentReviewTask(draft())
    expect(task.matterEntityId).toBe('matter-1')
    expect(task.matterNumber).toBe('M-0001')
    expect(task.clientName).toBe('Jane Client')
    expect(task.contactEntityId).toBeNull()
  })
})

describe('normalizeEsignTask', () => {
  it('uses the subject as title, falling back to humanized document kind', () => {
    expect(normalizeEsignTask(signature({ subject: 'Sign here' })).title).toBe('Sign here')
    expect(
      normalizeEsignTask(signature({ subject: null, documentKind: 'engagement_letter' })).title,
    ).toBe('engagement letter')
    expect(normalizeEsignTask(signature({ subject: null, documentKind: null })).title).toBe(
      'document',
    )
  })

  it('maps contactName to clientName (the shape has no client-name field of its own)', () => {
    const task = normalizeEsignTask(signature({ contactName: 'John Signer' }))
    expect(task.clientName).toBe('John Signer')
  })

  it('maps id/workHref/viewHref/dateLabel/date', () => {
    const task = normalizeEsignTask(signature({ requestId: 'req-9', envelopeId: 'env-9' }))
    expect(task.id).toBe('req-9')
    expect(task.type).toBe('esign')
    expect(task.typeLabel).toBe('E-Sign')
    expect(task.workHref).toBe('/attorney/sign/req-9')
    expect(task.viewHref).toBe('/attorney/esign/env-9')
    expect(task.dateLabel).toBe('Sent')
    expect(task.date).toBe('2026-07-19T09:00:00+00:00')
  })
})

describe('isUnsentIssuedInvoice', () => {
  it('is true for status "issued"', () => {
    expect(isUnsentIssuedInvoice({ status: 'issued' })).toBe(true)
  })
  it('is false once sent', () => {
    expect(isUnsentIssuedInvoice({ status: 'sent' })).toBe(false)
  })
  it('is false once paid', () => {
    expect(isUnsentIssuedInvoice({ status: 'paid' })).toBe(false)
  })
})

describe('normalizeInvoiceTask', () => {
  it('builds a title from the invoice number and amount', () => {
    const task = normalizeInvoiceTask(invoice({ invoiceNumber: 'INV-0007', total: '500.00' }))
    expect(task.title).toBe('Invoice INV-0007 · $500.00')
  })

  it('omits the amount suffix when total is empty', () => {
    const task = normalizeInvoiceTask(invoice({ total: '' }))
    expect(task.title).toBe('Invoice INV-0001')
  })

  it('formats a non-USD currency without the dollar sign', () => {
    const task = normalizeInvoiceTask(invoice({ total: '100.00', currency: 'EUR' }))
    expect(task.title).toBe('Invoice INV-0001 · 100.00 EUR')
  })

  it('maps id/clientName/dateLabel/date/workHref and nulls the matter fields', () => {
    const task = normalizeInvoiceTask(invoice())
    expect(task.id).toBe('inv-1')
    expect(task.type).toBe('billing')
    expect(task.subtype).toBe('invoice_unsent')
    expect(task.clientName).toBe('Acme Co')
    expect(task.matterEntityId).toBeNull()
    expect(task.matterNumber).toBeNull()
    expect(task.dateLabel).toBe('Issued')
    expect(task.date).toBe('2026-07-18')
    expect(task.workHref).toBe('/attorney/billing')
  })
})

describe('isOpenPaymentReport', () => {
  it('is true for status "open"', () => {
    expect(isOpenPaymentReport({ status: 'open' })).toBe(true)
  })
  it('is false once resolved', () => {
    expect(isOpenPaymentReport({ status: 'resolved' })).toBe(false)
  })
  it('is false once dismissed', () => {
    expect(isOpenPaymentReport({ status: 'dismissed' })).toBe(false)
  })
})

describe('normalizePaymentReportTask', () => {
  it('maps id/title/clientName/dateLabel/date/workHref', () => {
    const task = normalizePaymentReportTask(paymentReport())
    expect(task.id).toBe('evt-1')
    expect(task.type).toBe('billing')
    expect(task.subtype).toBe('payment_report')
    expect(task.title).toBe('Payment reported · INV-0002')
    expect(task.clientName).toBe('Bob Payer')
    expect(task.dateLabel).toBe('Reported')
    expect(task.date).toBe('2026-07-17T12:00:00+00:00')
    expect(task.workHref).toBe('/attorney/billing')
    expect(task.matterEntityId).toBeNull()
  })

  it('drops the invoice-number suffix when there is none', () => {
    const task = normalizePaymentReportTask(paymentReport({ invoiceNumber: '' }))
    expect(task.title).toBe('Payment reported')
  })
})

describe('normalizeClientRequestTask', () => {
  it('maps id/title/clientName/matter/dateLabel/date/workHref', () => {
    const task = normalizeClientRequestTask(clientRequest())
    expect(task.id).toBe('creq-1')
    expect(task.type).toBe('client_request')
    expect(task.typeLabel).toBe('Client Request')
    expect(task.title).toBe('Please update the address on file')
    expect(task.clientName).toBe('Carla Client')
    expect(task.matterEntityId).toBe('matter-3')
    expect(task.matterNumber).toBe('M-0003')
    expect(task.dateLabel).toBe('Requested')
    expect(task.date).toBe('2026-07-16T14:00:00+00:00')
    expect(task.workHref).toBe('/attorney/requests')
  })

  it('falls back to the humanized request type when description is empty', () => {
    const task = normalizeClientRequestTask(
      clientRequest({ description: '', requestType: 'fee_question' }),
    )
    expect(task.title).toBe('fee question')
  })

  it('leaves matter fields null when the request has no matter', () => {
    const task = normalizeClientRequestTask(
      clientRequest({ matterEntityId: null, matterNumber: null }),
    )
    expect(task.matterEntityId).toBeNull()
    expect(task.matterNumber).toBeNull()
  })
})

describe('normalizeWorkflowStepTask', () => {
  it('maps type/label/title/matter/client and the "Waiting since" date', () => {
    const task = normalizeWorkflowStepTask(workflowStep())
    expect(task.type).toBe('workflow_step')
    expect(task.typeLabel).toBe('Workflow Step')
    expect(task.title).toBe('Review draft')
    expect(task.matterEntityId).toBe('matter-4')
    expect(task.matterNumber).toBe('M-0004')
    expect(task.clientName).toBe('Dana Client')
    expect(task.dateLabel).toBe('Waiting since')
    expect(task.date).toBe('2026-07-15T11:00:00+00:00')
  })

  it('links its id and Open action to the matter workspace (no per-step deep link)', () => {
    const task = normalizeWorkflowStepTask(workflowStep({ matterEntityId: 'matter-9' }))
    expect(task.id).toBe('matter-9')
    expect(task.workHref).toBe('/attorney/matters/matter-9')
    expect(task.viewHref).toBeNull()
    expect(task.contactEntityId).toBeNull()
    expect(task.status).toBeNull()
  })

  it('nulls an empty matter number and a missing client name', () => {
    const task = normalizeWorkflowStepTask(workflowStep({ matterNumber: '', clientName: null }))
    expect(task.matterNumber).toBeNull()
    expect(task.clientName).toBeNull()
  })
})

describe('normalizeTodoTask', () => {
  it('dates off the due date with the "Due" label when a due date is set', () => {
    const task = normalizeTodoTask(todoTask({ dueDate: '2026-07-25' }))
    expect(task.type).toBe('todo')
    expect(task.typeLabel).toBe('To-Do')
    expect(task.dateLabel).toBe('Due')
    expect(task.date).toBe('2026-07-25')
  })

  it('falls back to the created date with the "Added" label when there is no due date', () => {
    const task = normalizeTodoTask(todoTask({ dueDate: null }))
    expect(task.dateLabel).toBe('Added')
    expect(task.date).toBe('2026-07-14T09:30:00.000Z')
  })

  it('maps id/title/status/matter/client and the per-task Open href', () => {
    const task = normalizeTodoTask(
      todoTask({ taskId: 'task-42', matterEntityId: 'matter-7', status: 'in_progress' }),
    )
    expect(task.id).toBe('task-42')
    expect(task.title).toBe('Call the county recorder')
    expect(task.status).toBe('in_progress')
    expect(task.matterEntityId).toBe('matter-7')
    expect(task.matterNumber).toBe('M-0005')
    expect(task.clientName).toBe('Evan Client')
    expect(task.workHref).toBe('/attorney/matters/matter-7/tasks/task-42')
    expect(task.viewHref).toBeNull()
    expect(task.contactEntityId).toBeNull()
  })
})
