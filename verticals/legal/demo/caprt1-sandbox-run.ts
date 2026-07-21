// CAPABILITY-RUNTIME-1 — sandbox end-to-end run (WP4 + acceptance B–G).
// Tenant: Exsto Sandbox (00000000-0000-0000-00fe-000000000001). NEVER tenant-zero.
//
// Authors "Employment Contract Review" as a multi-turn exchange and drives a test
// matter through it, playing BOTH sides:
//   intake + client uploads contract → ai_document_review → attorney approves →
//   request client materials (client gate) → client delivers → ai_document_review
//   again → attorney approves → invoice step → complete.
//
// The two AI reviews call the REAL model (Contract A). Storage bytes are injected
// (the sandbox has no Storage object), and the Anthropic key is borrowed from
// tenant-zero into the env (LLM credential only — every substrate write stays
// sandbox). Prints a JSON receipt block of ids for independent SQL verification.
process.env.LEGAL_WORKFLOW_ENGINE = '1' // the engine must be ON for this run

import '@exsto/legal' // register all action handlers (side effect)
import {
  createService,
  createQuestionnaireAI,
  setServiceLifecycleAI,
  validateProposedLifecycle,
  invokeCapabilityForMatter,
  resolveAnthropicApiKey,
  addMatterFee,
  issueInvoice,
  payInvoice,
  type Lifecycle,
} from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { randomUUID } from 'node:crypto'

const SANDBOX = '00000000-0000-0000-00fe-000000000001'
const AGENT = '00000000-0000-0000-0001-000000000004' // seeded Claude agent actor
const ctx: ActionContext = { tenantId: SANDBOX, actorId: AGENT }

const CONTRACT_1 = `EMPLOYMENT AGREEMENT
This Agreement is between Acme Corp ("Company") and Jordan Lee ("Employee").
1. At-Will. Employment is at-will and may be terminated by either party at any time.
2. Non-Compete. For 3 years after termination, Employee shall not work for any competitor anywhere in the United States.
3. IP Assignment. All work product, and any invention conceived during employment or for 12 months after, belongs to Company.
4. Compensation. $95,000/yr. No severance is provided on termination.`

const CONTRACT_2 = `OFFER LETTER (amendment)
Re: Jordan Lee. This offer letter supplements the Employment Agreement.
Signing bonus: $10,000, repayable in full if Employee resigns within 24 months.
The non-compete in the Employment Agreement is acknowledged and reaffirmed.`

const fake = (text: string): { downloadObject: () => Promise<Buffer> } => ({
  downloadObject: async () => Buffer.from(text, 'utf8'),
})

async function clientUpload(
  matterEntityId: string,
  clientContactId: string,
  objectKey: string,
  text: string,
): Promise<string> {
  const res = await submitAction(ctx, {
    actionKindName: 'document.upload',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterEntityId,
      object_key: objectKey,
      original_filename: objectKey.split('/').pop(),
      content_type: 'text/plain',
      size_bytes: Buffer.byteLength(text),
      sha256_hex: 'de'.repeat(32),
      document_kind: 'client_contract',
      document_source: 'client_uploaded',
      client_contact_id: clientContactId,
    },
  })
  return (res.effects[0] as { documentVersionId: string }).documentVersionId
}

async function currentState(matterEntityId: string): Promise<string> {
  const { withActionContext } = await import('@exsto/substrate')
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ current_state: string }>(
      `SELECT current_state FROM workflow_instance WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
      [SANDBOX, matterEntityId],
    )
    return r.rows[0]?.current_state ?? '(none)'
  })
}

const GRAPH: Lifecycle = [
  {
    key: 'intake_submitted',
    label: 'Client intake',
    client_label: 'Intake',
    entry: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'first_review', gate: 'attorney', via: 'legal.matter.advance' }],
  },
  {
    key: 'first_review',
    label: 'AI review of the contract',
    client_label: 'Under review',
    action: {
      kind: 'invoke_capability',
      config: {
        capability_slug: 'ai_document_review',
        capability_config: {
          rubric:
            'Review this employment contract for the EMPLOYEE. Flag: at-will language, the non-compete scope and duration, IP-assignment breadth, severance, and any clause unfavorable to the employee. Summarize the key risks and the changes you would request.',
        },
      },
    },
    advances_to: [{ to: 'materials_requested', gate: 'attorney', via: 'draft.approve' }],
  },
  {
    key: 'materials_requested',
    label: 'Request follow-up materials from the client',
    client_label: 'Action needed',
    action: {
      kind: 'invoke_capability',
      config: {
        capability_slug: 'request_client_materials',
        capability_config: {
          message:
            'Thanks — I reviewed your employment agreement. Please upload the signed offer letter and any amendments so I can finish the review.',
        },
      },
    },
    advances_to: [{ to: 'second_review', gate: 'client', via: 'document.upload' }],
  },
  {
    key: 'second_review',
    label: 'AI review of the follow-up materials',
    client_label: 'Under review',
    action: {
      kind: 'invoke_capability',
      config: {
        capability_slug: 'ai_document_review',
        capability_config: {
          rubric:
            'Re-review incorporating the newly provided offer letter/amendment. State whether the earlier risks are resolved and flag any NEW issues the amendment introduces.',
        },
      },
    },
    advances_to: [{ to: 'approved', gate: 'attorney', via: 'draft.approve' }],
  },
  {
    key: 'approved',
    label: 'Approve & send invoice',
    client_label: 'Invoice',
    action: { kind: 'approve_send_invoice' },
    advances_to: [{ to: 'closed', gate: 'system', on: 'invoice.paid' }],
  },
  {
    key: 'closed',
    label: 'Complete',
    client_label: 'Complete',
    terminal: true,
    action: { kind: 'complete_matter' },
    advances_to: [],
  },
]

async function openMatterWithClient(
  serviceKey: string,
): Promise<{ matterEntityId: string; clientEntityId: string }> {
  const matterEntityId = randomUUID()
  const matterNumber = `M-${matterEntityId.slice(0, 8).toUpperCase()}`
  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: 'Jordan Lee',
      client_email: 'jordan.lee@example.com',
      client_phone: null,
      client_company_name: null,
      service_key: serviceKey,
      intake_form_id: null,
      intake_responses: { concern: 'Please review my employment contract before I sign.' },
    },
  })
  const eff = intake.effects[0] as { clientEntityId?: string; questionnaireEntityId?: string }
  await submitAction(ctx, {
    actionKindName: 'matter.open',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterEntityId,
      matter_number: matterNumber,
      service_key: serviceKey,
      workflow_route: 'manual',
      attribution_source: 'attorney_manual',
      client_entity_id: eff.clientEntityId,
      questionnaire_entity_id: eff.questionnaireEntityId,
      intake_action_id: intake.actionId,
      client_display_name: 'Jordan Lee',
    },
  })
  return { matterEntityId, clientEntityId: eff.clientEntityId as string }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  // Borrow tenant-zero's Anthropic key into the env (LLM credential only).
  const { apiKey } = await resolveAnthropicApiKey('00000000-0000-0000-0000-000000000001')
  process.env.ANTHROPIC_API_KEY = apiKey

  const receipt: Record<string, unknown> = {}

  // 1. Author the service (disabled draft), its questionnaire (with an INTERNAL
  //    field — WP5-in-data), and the workflow graph.
  const svc = await createService(ctx, {
    displayName: `Employment Contract Review ${Date.now().toString(36)}`,
    description: 'We review your employment agreement and tell you what to fix before you sign.',
    route: 'manual',
    documents: [],
    sortOrder: 900,
  })
  const serviceKey = svc.serviceKey
  receipt.serviceKey = serviceKey

  await createQuestionnaireAI(
    ctx,
    serviceKey,
    {
      title: 'Employment Contract Review intake',
      sections: [
        {
          id: 'about_you',
          title: 'About you and the contract',
          fields: [
            { id: 'concern', label: 'What are you worried about?', type: 'textarea' },
            { id: 'contract_file', label: 'Upload the contract to review', type: 'file_upload' },
          ],
        },
        {
          id: 'attorney_review',
          title: 'Attorney review — completed during review',
          fields: [
            {
              id: 'review_summary',
              label: 'Review summary',
              type: 'textarea',
              internal: true,
              required: false,
            },
            {
              id: 'requested_changes',
              label: 'Requested changes',
              type: 'textarea',
              internal: true,
              required: false,
            },
          ],
        },
      ],
    },
    { conclusion: 'Intake collects the client contract + concern; review outputs are internal.' },
  )

  const authored = await setServiceLifecycleAI(ctx, serviceKey, GRAPH, {
    conclusion: 'Two-round document-review exchange with a mid-service client-materials request.',
  })
  receipt.workflowDefinitionId = authored.workflowDefinitionId

  // 2. Open a matter; the client uploads the contract at intake.
  const { matterEntityId, clientEntityId } = await openMatterWithClient(serviceKey)
  receipt.matterEntityId = matterEntityId
  receipt.stateAfterOpen = await currentState(matterEntityId)
  await clientUpload(matterEntityId, clientEntityId, 'sandbox/caprt1/contract1.txt', CONTRACT_1)

  // Attorney opens the matter → moves to the review stage.
  await submitAction(ctx, {
    actionKindName: 'legal.matter.advance',
    intentKind: 'adjustment',
    payload: { matter_entity_id: matterEntityId, to_state: 'first_review', gate: 'attorney' },
  })
  receipt.stateBeforeFirstReview = await currentState(matterEntityId)

  // 3. Run the FIRST AI review (real model, injected bytes) → review memo #1.
  const r1 = await invokeCapabilityForMatter(ctx, matterEntityId, fake(CONTRACT_1))
  receipt.firstReview = r1
  const memo1 = r1.outputs[0]?.entityId
  receipt.memo1VersionId = memo1
  receipt.stateAfterFirstReview = await currentState(matterEntityId) // parks at first_review

  // 4. Attorney approves memo #1 → advances first_review → materials_requested.
  await submitAction(ctx, {
    actionKindName: 'draft.approve',
    intentKind: 'adjustment',
    payload: { document_version_id: memo1, review_notes: 'Looks right — send the follow-up ask.' },
  })
  receipt.stateAfterApprove1 = await currentState(matterEntityId)

  // 5. Run request_client_materials → posts the portal message; parks at client gate.
  const r2 = await invokeCapabilityForMatter(ctx, matterEntityId)
  receipt.materialsRequest = r2
  receipt.stateAfterMaterialsRequest = await currentState(matterEntityId)

  // 6. NEGATIVE G: an UNRELATED client action (a portal message) must NOT advance a
  //    stage that waits on document.upload.
  await submitAction(ctx, {
    actionKindName: 'client.message.post',
    intentKind: 'unknown',
    payload: {
      matter_entity_id: matterEntityId,
      client_contact_id: clientEntityId,
      body: 'Quick question — is the offer letter enough or do you need the handbook too?',
    },
  })
  receipt.stateAfterUnrelatedMessage = await currentState(matterEntityId) // still materials_requested

  // 7. The client DELIVERS (uploads the follow-up) → dispatchClientDelivery advances
  //    materials_requested → second_review with NO legal.matter.advance.
  await clientUpload(matterEntityId, clientEntityId, 'sandbox/caprt1/contract2.txt', CONTRACT_2)
  receipt.stateAfterClientDelivery = await currentState(matterEntityId)

  // 8. Run the SECOND AI review on the newly delivered doc → review memo #2.
  const r3 = await invokeCapabilityForMatter(ctx, matterEntityId, fake(CONTRACT_2))
  receipt.secondReview = r3
  const memo2 = r3.outputs[0]?.entityId
  receipt.memo2VersionId = memo2

  // 9. Attorney approves memo #2 → advances second_review → approved.
  await submitAction(ctx, {
    actionKindName: 'draft.approve',
    intentKind: 'adjustment',
    payload: { document_version_id: memo2, review_notes: 'Approved — proceed to billing.' },
  })
  receipt.stateAfterApprove2 = await currentState(matterEntityId)

  // 10. Billing + completion (the faithful path). Add the service fee, issue an
  //     invoice, and pay it → invoice.pay dispatches invoice.paid, which fires the
  //     approved→closed SYSTEM edge via signalEvent (no manual advance, no actor
  //     guard). Both the invoice row AND the terminal completion come from this.
  const fee = await addMatterFee(ctx, {
    matterEntityId,
    feeType: 'service',
    amount: '500.00',
    description: 'Employment contract review',
  })
  const invoice = await issueInvoice(ctx, {
    clientEntityId,
    matterEntityId,
    lines: [{ sourceEventId: fee.eventId, kind: 'service_fee' }],
  })
  receipt.invoiceEntityId = invoice.invoiceEntityId
  receipt.invoiceNumber = invoice.invoiceNumber
  await payInvoice(ctx, { invoiceEntityId: invoice.invoiceEntityId, method: 'manual' })
  receipt.stateFinal = await currentState(matterEntityId)

  // 11. NEGATIVE E — authoring rejects a non-invocable slug and a nonexistent slug.
  const badGraph: Lifecycle = [
    {
      key: 'a',
      label: 'A',
      entry: true,
      action: { kind: 'invoke_capability', config: { capability_slug: 'client_portal' } },
      advances_to: [{ to: 'b', gate: 'attorney', via: 'draft.approve' }],
    },
    {
      key: 'b',
      label: 'B',
      action: { kind: 'invoke_capability', config: { capability_slug: 'does_not_exist_cap' } },
      advances_to: [{ to: 'c', gate: 'attorney', via: 'draft.approve' }],
    },
    { key: 'c', label: 'C', terminal: true, action: { kind: 'complete_matter' }, advances_to: [] },
  ]
  const badValidation = await validateProposedLifecycle(ctx, badGraph)
  receipt.negativeE = { ok: badValidation.ok, errors: badValidation.errors }

  // 12. NEGATIVE F — a contracted-but-unbuilt capability (esignature) raises a clear
  //     error + records an observation, no output, no advance. Own tiny service.
  const probe = await createService(ctx, {
    displayName: `Esign Probe ${Date.now().toString(36)}`,
    description: 'Probe service for the not-yet-executable capability path.',
    route: 'manual',
    documents: [],
    sortOrder: 901,
  })
  const probeGraph: Lifecycle = [
    {
      key: 'sign_step',
      label: 'eSign',
      entry: true,
      action: { kind: 'invoke_capability', config: { capability_slug: 'esignature' } },
      advances_to: [{ to: 'done', gate: 'system', on: 'esign.completed' }],
    },
    {
      key: 'done',
      label: 'Done',
      terminal: true,
      action: { kind: 'complete_matter' },
      advances_to: [],
    },
  ]
  await setServiceLifecycleAI(ctx, probe.serviceKey, probeGraph, {
    conclusion: 'Probe: esignature is contracted but not yet executable.',
  })
  const probeMatter = await openMatterWithClient(probe.serviceKey)
  receipt.esignProbeMatterId = probeMatter.matterEntityId
  try {
    await invokeCapabilityForMatter(ctx, probeMatter.matterEntityId)
    receipt.negativeF = { threw: false }
  } catch (e) {
    receipt.negativeF = {
      threw: true,
      error: e instanceof Error ? e.message : String(e),
      stateStayed: await currentState(probeMatter.matterEntityId),
    }
  }

  console.log('\n===CAPRT1_RECEIPT_JSON===')
  console.log(JSON.stringify(receipt, null, 2))
  console.log('===END===')
}

main().catch((e) => {
  console.error('RUN FAILED:', e instanceof Error ? e.stack : String(e))
  process.exit(1)
})
