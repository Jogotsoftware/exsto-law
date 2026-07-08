// CAPABILITY-AUTORUN-1 — sandbox acceptance A–E. Tenant: Exsto Sandbox
// (00000000-0000-0000-00fe-000000000001). NEVER tenant-zero.
//
// THE AUTONOMY PROOF (A): drive a fresh employment-contract-review matter end to end
// playing both sides (intake, attorney approvals, CLIENT document.upload) WITHOUT
// calling invokeCapabilityForMatter in the flow — the AI reviews + the materials
// request fire AUTOMATICALLY on stage entry, from the advance handlers, post-commit.
// The main flow never imports the runtime; a separate probe (C) calls it once to
// prove idempotency. Real bytes are uploaded to Storage so the auto-run's REAL
// downloadObject works (no injected fake through the advance path). Anthropic key is
// borrowed from tenant-zero into the env; every substrate write stays sandbox.
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import {
  createService,
  createQuestionnaireAI,
  setServiceLifecycleAI,
  resolveAnthropicApiKey,
  addMatterFee,
  issueInvoice,
  payInvoice,
  // Imported ONLY for the idempotency probe (C) + failure probe (D) — NOT used in the
  // autonomy flow (A), which drives advances alone and relies on auto-run.
  invokeCapabilityForMatter,
  type Lifecycle,
} from '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SANDBOX = '00000000-0000-0000-00fe-000000000001'
const AGENT = '00000000-0000-0000-0001-000000000004'
const ctx: ActionContext = { tenantId: SANDBOX, actorId: AGENT }

const CONTRACT_1 = `EMPLOYMENT AGREEMENT
Between Acme Corp ("Company") and Jordan Lee ("Employee").
1. At-Will. Employment is at-will, terminable by either party at any time.
2. Non-Compete. For 3 years after termination, Employee shall not work for any competitor anywhere in the United States.
3. IP Assignment. All work product and any invention conceived during employment or for 12 months after belongs to Company.
4. Compensation. $95,000/yr. No severance on termination.`

const CONTRACT_2 = `OFFER LETTER (amendment)
Re: Jordan Lee. Supplements the Employment Agreement.
Signing bonus: $10,000, repayable in full if Employee resigns within 24 months.
The non-compete is acknowledged and reaffirmed.`

const storage = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
)

async function uploadBytes(objectKey: string, text: string): Promise<void> {
  const { error } = await storage.storage
    .from('matter-documents')
    .upload(objectKey, Buffer.from(text, 'utf8'), { contentType: 'text/plain', upsert: true })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
}

async function clientUpload(
  matter: string,
  clientContactId: string,
  objectKey: string,
  text: string,
): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'document.upload',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matter,
      object_key: objectKey,
      original_filename: objectKey.split('/').pop(),
      content_type: 'text/plain',
      size_bytes: Buffer.byteLength(text),
      sha256_hex: 'ab'.repeat(32),
      document_kind: 'client_contract',
      document_source: 'client_uploaded',
      client_contact_id: clientContactId,
    },
  })
}

async function currentState(matter: string): Promise<string> {
  return withActionContext(ctx, async (c) => {
    const r = await c.query<{ current_state: string }>(
      `SELECT current_state FROM workflow_instance WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
      [SANDBOX, matter],
    )
    return r.rows[0]?.current_state ?? '(none)'
  })
}

// The latest pending_review AI-review memo of the matter (what the attorney approves).
async function latestMemoVersion(matter: string): Promise<string | null> {
  return withActionContext(ctx, async (c) => {
    const r = await c.query<{ id: string }>(
      `SELECT dv.id FROM document_version dv
         JOIN entity e ON e.id = dv.document_entity_id
         JOIN relationship rel ON rel.source_entity_id = e.id
         JOIN relationship_kind_definition rk ON rk.id = rel.relationship_kind_id AND rk.kind_name='draft_of'
        WHERE dv.tenant_id=$1 AND rel.target_entity_id=$2
          AND dv.metadata->>'generation_mode'='ai_review' AND dv.status='pending_review'
        ORDER BY dv.recorded_at DESC LIMIT 1`,
      [SANDBOX, matter],
    )
    return r.rows[0]?.id ?? null
  })
}

async function memoCount(matter: string): Promise<number> {
  return withActionContext(ctx, async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM document_version dv
         JOIN entity e ON e.id = dv.document_entity_id
         JOIN relationship rel ON rel.source_entity_id = e.id
         JOIN relationship_kind_definition rk ON rk.id = rel.relationship_kind_id AND rk.kind_name='draft_of'
        WHERE dv.tenant_id=$1 AND rel.target_entity_id=$2 AND dv.metadata->>'generation_mode'='ai_review'`,
      [SANDBOX, matter],
    )
    return Number(r.rows[0]?.n ?? '0')
  })
}

async function openMatter(serviceKey: string): Promise<{ matter: string; client: string }> {
  const matter = randomUUID()
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
      intake_responses: { concern: 'Please review my employment contract.' },
    },
  })
  const eff = intake.effects[0] as { clientEntityId?: string; questionnaireEntityId?: string }
  await submitAction(ctx, {
    actionKindName: 'matter.open',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matter,
      matter_number: `M-${matter.slice(0, 8).toUpperCase()}`,
      service_key: serviceKey,
      workflow_route: 'manual',
      attribution_source: 'attorney_manual',
      client_entity_id: eff.clientEntityId,
      questionnaire_entity_id: eff.questionnaireEntityId,
      intake_action_id: intake.actionId,
      client_display_name: 'Jordan Lee',
    },
  })
  return { matter, client: eff.clientEntityId as string }
}

const GRAPH: Lifecycle = [
  {
    key: 'intake_submitted',
    label: 'Client intake',
    entry: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'first_review', gate: 'attorney', via: 'legal.matter.advance' }],
  },
  {
    key: 'first_review',
    label: 'AI review of the contract',
    action: {
      kind: 'invoke_capability',
      config: {
        capability_slug: 'ai_document_review',
        capability_config: {
          rubric:
            'Review this employment contract for the EMPLOYEE. Flag at-will, the non-compete scope/duration, IP breadth, severance. Summarize risks + requested changes.',
        },
      },
    },
    advances_to: [{ to: 'materials_requested', gate: 'attorney', via: 'draft.approve' }],
  },
  {
    key: 'materials_requested',
    label: 'Request follow-up materials',
    action: {
      kind: 'invoke_capability',
      config: {
        capability_slug: 'request_client_materials',
        capability_config: {
          message:
            'Thanks — please upload the signed offer letter and any amendments so I can finish the review.',
        },
      },
    },
    advances_to: [{ to: 'second_review', gate: 'client', via: 'document.upload' }],
  },
  {
    key: 'second_review',
    label: 'AI review of the follow-up',
    action: {
      kind: 'invoke_capability',
      config: {
        capability_slug: 'ai_document_review',
        capability_config: {
          rubric:
            'Re-review incorporating the amendment. State whether the earlier risks are resolved and flag any NEW issues.',
        },
      },
    },
    advances_to: [{ to: 'approved', gate: 'attorney', via: 'draft.approve' }],
  },
  {
    key: 'approved',
    label: 'Approve & send invoice',
    action: { kind: 'approve_send_invoice' },
    advances_to: [{ to: 'closed', gate: 'system', on: 'invoice.paid' }],
  },
  {
    key: 'closed',
    label: 'Complete',
    terminal: true,
    action: { kind: 'complete_matter' },
    advances_to: [],
  },
]

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required.')
  const { apiKey } = await resolveAnthropicApiKey('00000000-0000-0000-0000-000000000001')
  process.env.ANTHROPIC_API_KEY = apiKey
  const receipt: Record<string, unknown> = {}
  const tag = Date.now().toString(36)

  // ── A: THE AUTONOMY FLOW (advances only; no invokeCapabilityForMatter) ──────────
  const svc = await createService(ctx, {
    displayName: `Employment Contract Review AR ${tag}`,
    description: 'We review your employment agreement and tell you what to fix before you sign.',
    route: 'manual',
    documents: [],
    sortOrder: 902,
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
          ],
        },
      ],
    },
    { conclusion: 'Client uploads the contract; review outputs are internal.' },
  )
  await setServiceLifecycleAI(ctx, serviceKey, GRAPH, {
    conclusion: 'Auto-run two-round document review with a mid-service client-materials ask.',
  })

  const key1 = `sandbox/autorun/${tag}/contract1.txt`
  await uploadBytes(key1, CONTRACT_1)
  const { matter, client } = await openMatter(serviceKey)
  receipt.matter = matter
  await clientUpload(matter, client, key1, CONTRACT_1) // binds the doc at intake (no advance yet)
  receipt.stateAtIntake = await currentState(matter)

  // Attorney advances intake → first_review. AUTO-RUN fires ai_document_review.
  await submitAction(ctx, {
    actionKindName: 'legal.matter.advance',
    intentKind: 'adjustment',
    payload: { matter_entity_id: matter, to_state: 'first_review', gate: 'attorney' },
  })
  receipt.stateAfterAdvance1 = await currentState(matter) // parks at first_review (attorney gate)
  receipt.memosAfterAutoReview1 = await memoCount(matter) // expect 1 — fired with NO manual invoke

  // Attorney approves memo #1 → advances to materials_requested. AUTO-RUN fires request_client_materials.
  const memo1 = await latestMemoVersion(matter)
  receipt.memo1 = memo1
  await submitAction(ctx, {
    actionKindName: 'draft.approve',
    intentKind: 'adjustment',
    payload: { document_version_id: memo1, review_notes: 'Send the follow-up ask.' },
  })
  receipt.stateAfterApprove1 = await currentState(matter) // materials_requested (client gate; parked)

  // E (gate integrity): the materials-request auto-ran (sent the ask) then PARKED for
  // the client — it did NOT auto-advance past the client gate.
  receipt.parkedAtClientGate = (await currentState(matter)) === 'materials_requested'

  // Client delivers the follow-up. AUTO-RUN fires the SECOND ai_document_review.
  const key2 = `sandbox/autorun/${tag}/contract2.txt`
  await uploadBytes(key2, CONTRACT_2)
  await clientUpload(matter, client, key2, CONTRACT_2)
  receipt.stateAfterClientDelivery = await currentState(matter) // second_review (parked, attorney gate)
  receipt.memosAfterAutoReview2 = await memoCount(matter) // expect 2

  // ── C: IDEMPOTENCY — a manual invoke on the just-auto-run stage must NOT re-fire ─
  const idem = await invokeCapabilityForMatter(ctx, matter)
  receipt.idempotencyProbe = { ran: idem.ran, summary: idem.summary }
  receipt.memosAfterManualReinvoke = await memoCount(matter) // still 2 (no double memo)

  // Approve memo #2 → approved; invoice + pay → closed.
  const memo2 = await latestMemoVersion(matter)
  receipt.memo2 = memo2
  await submitAction(ctx, {
    actionKindName: 'draft.approve',
    intentKind: 'adjustment',
    payload: { document_version_id: memo2, review_notes: 'Approved — bill it.' },
  })
  const fee = await addMatterFee(ctx, {
    matterEntityId: matter,
    feeType: 'service',
    amount: '500.00',
    description: 'Employment contract review',
  })
  const inv = await issueInvoice(ctx, {
    clientEntityId: client,
    matterEntityId: matter,
    lines: [{ sourceEventId: fee.eventId, kind: 'service_fee' }],
  })
  receipt.invoiceNumber = inv.invoiceNumber
  await payInvoice(ctx, { invoiceEntityId: inv.invoiceEntityId, method: 'manual' })
  receipt.stateFinal = await currentState(matter)

  // ── D: FAILURE — auto-run of a contracted-but-unbuilt capability (esign) on entry ─
  const probe = await createService(ctx, {
    displayName: `Autorun Esign Probe ${tag}`,
    description: 'Probe: esignature auto-run fails loudly on entry.',
    route: 'manual',
    documents: [],
    sortOrder: 903,
  })
  const probeGraph: Lifecycle = [
    {
      key: 'start',
      label: 'Start',
      entry: true,
      action: { kind: 'view_intake' },
      advances_to: [{ to: 'sign', gate: 'attorney', via: 'legal.matter.advance' }],
    },
    {
      key: 'sign',
      label: 'Send for signature',
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
  await setServiceLifecycleAI(ctx, probe.serviceKey, probeGraph, { conclusion: 'Probe.' })
  const pm = await openMatter(probe.serviceKey)
  receipt.esignProbeMatter = pm.matter
  // Advance start → sign. AUTO-RUN fires esignature → fails (contracted, unbuilt).
  await submitAction(ctx, {
    actionKindName: 'legal.matter.advance',
    intentKind: 'adjustment',
    payload: { matter_entity_id: pm.matter, to_state: 'sign', gate: 'attorney' },
  })
  receipt.esignStateAfterAutoRun = await currentState(pm.matter) // stays 'sign' (no advance)
  // Still re-invocable via the manual route (not blocked by idempotency — no success recorded).
  try {
    await invokeCapabilityForMatter(ctx, pm.matter)
    receipt.esignManualReinvoke = { threw: false }
  } catch (e) {
    receipt.esignManualReinvoke = { threw: true, error: e instanceof Error ? e.message : String(e) }
  }

  console.log('\n===AUTORUN_RECEIPT_JSON===')
  console.log(JSON.stringify(receipt, null, 2))
  console.log('===END===')
}

main().catch((e) => {
  console.error('RUN FAILED:', e instanceof Error ? e.stack : String(e))
  process.exit(1)
})
