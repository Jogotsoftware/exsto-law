// RUNTIME-AUTORUN-2 — SANDBOX acceptance (B, C, D, E, F).
// Tenant: Exsto Sandbox (00000000-0000-0000-00fe-000000000001). NEVER tenant-zero.
//
// Proves the whole forward pass for a will matter WITHOUT ever calling the producer by
// hand — the class-based afterCommit autorun fires it:
//   B  autofire: entering generate_will → the will is drafted + draft.completed →
//      advances to review_send_will (state_history pasted).
//   C  full forward pass to terminal: intake → (auto) draft → review WAITS at the
//      attorney gate → approve → client_response (invoke_capability) → complete.
//   D  generalization: TWO producing kinds (generate_document + invoke_capability) both
//      autofire on entry through the ONE scheduler — the dispatch is kind-agnostic.
//   E  negative: the attorney-gated review step does NOT autofire (the matter parks).
//   F  no regression: the #303 invoke_capability autorun still runs (client_response),
//      and the matter reaches `complete`.
//
// The producer (runDraftGeneration) is NEVER called directly here. Every draft/advance
// is a consequence of a real client/attorney action + the autorun. runDraftGeneration
// needs no Storage object (it drafts from the template + questionnaire), so its autorun
// succeeds in-sandbox (unlike ai_document_review, which needs an uploaded file).
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import {
  createService,
  setServiceLifecycleAI,
  validateLifecycle,
  resolveAnthropicApiKey,
  type Lifecycle,
} from '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { randomUUID } from 'node:crypto'

const SANDBOX = '00000000-0000-0000-00fe-000000000001'
const SYS_ACTOR = '00000000-0000-0000-00fe-000000000002'
const AGENT_ACTOR = '00000000-0000-0000-0001-000000000004'
const ctx: ActionContext = { tenantId: SANDBOX, actorId: SYS_ACTOR }

const WILL_TEMPLATE = `# LAST WILL AND TESTAMENT OF {{testator_full_name}}

I, {{testator_full_name}}, a resident of {{county}} County, North Carolina, declare this my
Last Will and Testament, revoking all prior wills and codicils.

## Article I — Family
{{family_statement}}

## Article II — Executor
I nominate {{executor_name}}, and if unable to serve, {{alternate_executor_name}}, to serve
without bond.

## Article III — Specific Bequests
{{specific_bequests}}

## Article IV — Residuary Estate
I give the residue of my estate to {{residuary_beneficiary}}.

## Article V — Guardian
{{guardian_clause}}

_____________________________
{{testator_full_name}}, Testator`

const WILL_DRAFTING_PROMPT = `You are the drafting agent for a North Carolina estate-planning practice. Produce a first draft of a **North Carolina Last Will and Testament** using the client's intake answers and the Firm's template below.

# Rules
1. Jurisdiction is North Carolina (N.C. Gen. Stat. Chapter 31). 2. Output a COMPLETE will in markdown, ready for attorney review. 3. Use the template as the backbone; preserve its article structure. 4. Replace every {{variable}} using the intake answers; flag anything missing as [NEEDS ATTORNEY INPUT: ...]. 5. Do not invent beneficiaries, bequests, or executors. 6. Plain lawyerly English, no emojis.

The client's intake answers:
{{questionnaire_responses_json}}

Consultation notes, if any:
{{transcript_text}}

The document template to complete:
{{operating_agreement_template}}

# Reasoning trace (required)
After the will text, output a fenced \`\`\`json block: {"prompt_id":"will-drafting@v1","model_identity":"<model>","evidence":[],"alternatives_considered":[],"conclusion":"<one sentence>","confidence":0.8,"ambiguities":[]}`

const WILL_RESPONSES: Record<string, unknown> = {
  testator_full_name: 'Harold James Fenwick',
  county: 'Durham',
  marital_status: 'married',
  spouse_name: 'Katherine Fenwick',
  children: ['Daniel Fenwick (adult)', 'Grace Fenwick (age 12)'],
  executor_name: 'Katherine Fenwick',
  alternate_executor_name: 'Daniel Fenwick',
  specific_bequests: [
    'My workshop tools to my son Daniel Fenwick.',
    '$10,000 to the Durham Rescue Mission.',
  ],
  residuary_beneficiary:
    'my wife Katherine Fenwick, or if she does not survive me, my children in equal shares',
  guardian_for_minors: 'Katherine Fenwick, and if she cannot serve, my brother Robert Fenwick',
  concern:
    'A simple will leaving everything to my wife, with a guardian for our youngest and a couple of specific gifts.',
}

// The will workflow from the brief's ground truth (honest completion event: the edge
// uses `on: draft.completed`, the event the producer actually emits — not the fictional
// `document.generated`). generate_will is the producing+automatic step under test.
const WILL_GRAPH: Lifecycle = [
  {
    key: 'client_intake',
    label: 'Client intake',
    client_label: 'Your intake',
    entry: true,
    blocking: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'generate_will', gate: 'client', via: 'document.upload' }],
  },
  {
    key: 'generate_will',
    label: 'Draft the will',
    blocking: true,
    action: { kind: 'generate_document' },
    documents: [{ docKind: 'will', label: 'Last Will and Testament' }],
    advances_to: [{ to: 'review_send_will', gate: 'automatic', on: 'draft.completed' }],
  },
  {
    key: 'review_send_will',
    label: 'Review & send the will',
    blocking: true,
    action: { kind: 'review_send_document' },
    advances_to: [{ to: 'client_response', gate: 'attorney', via: 'draft.approve' }],
  },
  {
    key: 'client_response',
    label: 'Await client confirmation',
    blocking: true,
    action: {
      kind: 'invoke_capability',
      config: {
        capability_slug: 'request_client_materials',
        capability_config: {
          message: 'Your draft will is ready in the portal. Please review and reply to confirm.',
        },
      },
    },
    advances_to: [{ to: 'complete', gate: 'client', via: 'client.message.post' }],
  },
  {
    key: 'complete',
    label: 'Complete',
    terminal: true,
    action: { kind: 'complete_matter' },
    advances_to: [],
  },
]

async function upsertWillServiceConfig(serviceKey: string, displayName: string): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'exploration',
    payload: {
      service_key: serviceKey,
      display_name: displayName,
      transitions_patch: {
        documents: ['will'],
        document_templates: { template_version: 1, templates: { will: WILL_TEMPLATE } },
        drafting: { prompt_version: 1, prompts: { will: WILL_DRAFTING_PROMPT } },
      },
    },
  })
}

async function openWillMatter(
  serviceKey: string,
): Promise<{ matterEntityId: string; clientEntityId: string }> {
  const matterEntityId = randomUUID()
  const matterNumber = `M-${matterEntityId.slice(0, 8).toUpperCase()}`
  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: 'Harold James Fenwick',
      client_email: 'harold.fenwick@example.com',
      client_phone: null,
      client_company_name: null,
      service_key: serviceKey,
      intake_form_id: null,
      intake_responses: WILL_RESPONSES,
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
      client_display_name: 'Harold James Fenwick',
    },
  })
  return { matterEntityId, clientEntityId: eff.clientEntityId as string }
}

async function clientUpload(matterEntityId: string, clientContactId: string): Promise<void> {
  const text = 'Placeholder intake attachment — the will is drafted from the questionnaire.'
  await submitAction(ctx, {
    actionKindName: 'document.upload',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterEntityId,
      object_key: `sandbox/autorun2/intake-${randomUUID().slice(0, 8)}.txt`,
      original_filename: 'intake-note.txt',
      content_type: 'text/plain',
      size_bytes: Buffer.byteLength(text),
      sha256_hex: 'cd'.repeat(32),
      document_kind: 'client_intake_note',
      document_source: 'client_uploaded',
      client_contact_id: clientContactId,
    },
  })
}

async function currentState(matterEntityId: string): Promise<string> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ current_state: string }>(
      `SELECT current_state FROM workflow_instance WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
      [SANDBOX, matterEntityId],
    )
    return r.rows[0]?.current_state ?? '(none)'
  })
}

async function stateHistory(matterEntityId: string): Promise<unknown[]> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ state_history: unknown[] }>(
      `SELECT state_history FROM workflow_instance WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
      [SANDBOX, matterEntityId],
    )
    return r.rows[0]?.state_history ?? []
  })
}

interface DraftReadback {
  versionId: string | null
  documentKind: string | null
  reasoningTraceId: string | null
  traceAgentActorId: string | null
  bodyLength: number
  bodyExcerpt: string
}

async function readLatestWillDraft(matterEntityId: string): Promise<DraftReadback> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{
      version_id: string
      document_kind: string | null
      reasoning_trace_id: string | null
      body: string
    }>(
      `SELECT dv.id AS version_id, e_doc.metadata->>'document_kind' AS document_kind,
              dv.reasoning_trace_id, cb.body
         FROM document_version dv
         JOIN content_blob cb ON cb.id = dv.content_blob_id
         JOIN entity e_doc ON e_doc.id = dv.document_entity_id
         JOIN relationship rel ON rel.source_entity_id = dv.document_entity_id
         JOIN relationship_kind_definition rkd ON rkd.id = rel.relationship_kind_id
        WHERE dv.tenant_id=$1 AND rel.target_entity_id=$2 AND rkd.kind_name='draft_of'
        ORDER BY dv.version_number DESC LIMIT 1`,
      [SANDBOX, matterEntityId],
    )
    const row = r.rows[0]
    let traceAgentActorId: string | null = null
    if (row?.reasoning_trace_id) {
      const t = await client.query<{ agent_actor_id: string }>(
        `SELECT agent_actor_id FROM reasoning_trace WHERE tenant_id=$1 AND id=$2`,
        [SANDBOX, row.reasoning_trace_id],
      )
      traceAgentActorId = t.rows[0]?.agent_actor_id ?? null
    }
    return {
      versionId: row?.version_id ?? null,
      documentKind: row?.document_kind ?? null,
      reasoningTraceId: row?.reasoning_trace_id ?? null,
      traceAgentActorId,
      bodyLength: row?.body?.length ?? 0,
      bodyExcerpt: row?.body ? row.body.slice(0, 900) : '',
    }
  })
}

// The autorun's audit trail on this matter: draft.completed (producer) + capability.invoked
// (invoke_capability) + the automatic advances, in order — proof of WHAT autofired.
async function autorunAudit(
  matterEntityId: string,
): Promise<Array<{ kind: string; data: unknown }>> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ kind_name: string; payload: unknown; recorded_at: string }>(
      `SELECT k.kind_name, e.payload, e.recorded_at
         FROM event e JOIN event_kind_definition k ON k.id = e.event_kind_id
        WHERE e.tenant_id=$1 AND e.primary_entity_id=$2
          AND k.kind_name IN ('draft.completed','capability.invoked','workflow.advanced')
        ORDER BY e.recorded_at ASC`,
      [SANDBOX, matterEntityId],
    )
    return r.rows.map((row) => ({ kind: row.kind_name, data: row.payload }))
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const { apiKey } = await resolveAnthropicApiKey('00000000-0000-0000-0000-000000000001')
  process.env.ANTHROPIC_API_KEY = apiKey
  if (!process.env.LEGAL_DRAFTING_MODEL) process.env.LEGAL_DRAFTING_MODEL = 'claude-sonnet-4-6'

  const receipt: Record<string, unknown> = {}
  const suffix = randomUUID().slice(0, 8)

  // Graph is structurally valid before we author it.
  receipt.graphValidation = validateLifecycle(WILL_GRAPH)

  // Seed the will service (template + will drafting prompt), then AUTHOR the will
  // workflow so opened matters bind to it at the entry stage.
  const displayName = `NC Will Drafting (autorun-2 acceptance) ${suffix}`
  const service = await createService(ctx, {
    displayName,
    description: 'RUNTIME-AUTORUN-2 acceptance — will forward pass. Not client-facing.',
    route: 'manual',
    documents: [],
    sortOrder: 962,
  })
  const serviceKey = service.serviceKey
  receipt.serviceKey = serviceKey
  await upsertWillServiceConfig(serviceKey, displayName)
  const authored = await setServiceLifecycleAI(ctx, serviceKey, WILL_GRAPH, {
    conclusion: 'Will drafting workflow for RUNTIME-AUTORUN-2 acceptance.',
    confidence: 0.9,
  })
  receipt.workflowDefinitionId = authored.workflowDefinitionId

  const { matterEntityId, clientEntityId } = await openWillMatter(serviceKey)
  receipt.matterEntityId = matterEntityId
  const s0 = await currentState(matterEntityId)

  // ═══ B — the client's upload advances client_intake → generate_will; the autorun
  //     drafts the will (no manual producer call) and advances to review_send_will.
  await clientUpload(matterEntityId, clientEntityId) // blocks while the will drafts
  const sAfterUpload = await currentState(matterEntityId)
  const willDraft = await readLatestWillDraft(matterEntityId)
  receipt.B = {
    stateBeforeUpload: s0,
    stateAfterUpload: sAfterUpload,
    autofired: sAfterUpload === 'review_send_will',
    willDraft,
    stateHistory: await stateHistory(matterEntityId),
  }

  // ═══ E — negative: the matter is PARKED at the attorney-gated review step; it did
  //     NOT autofire to client_response. (Human gates still wait.)
  receipt.E = {
    parkedAtAttorneyGate: sAfterUpload === 'review_send_will',
    didNotAutoAdvancePastReview: sAfterUpload !== 'client_response' && sAfterUpload !== 'complete',
  }

  // ═══ C (part 2) + F — attorney approves the will → advances to client_response, whose
  //     invoke_capability autorun (request_client_materials, #303 path) fires on entry
  //     and parks at the client gate. Then the client replies → complete (terminal).
  if (willDraft.versionId) {
    await submitAction(ctx, {
      actionKindName: 'draft.approve',
      intentKind: 'adjustment',
      payload: {
        document_version_id: willDraft.versionId,
        review_notes: 'Approved — send to client.',
      },
    })
  }
  const sAfterApprove = await currentState(matterEntityId)

  await submitAction(ctx, {
    actionKindName: 'client.message.post',
    intentKind: 'unknown',
    payload: {
      matter_entity_id: matterEntityId,
      client_contact_id: clientEntityId,
      body: 'Looks great — please proceed and finalize my will. Thank you.',
    },
  })
  const sFinal = await currentState(matterEntityId)

  const audit = await autorunAudit(matterEntityId)
  receipt.C = {
    stateAfterApprove: sAfterApprove,
    stateFinal: sFinal,
    reachedTerminal: sFinal === 'complete',
    fullStateHistory: await stateHistory(matterEntityId),
  }
  receipt.F = {
    // #303 unregressed: the invoke_capability stage autofired (capability.invoked for
    // client_response) and the matter reached complete.
    invokeCapabilityAutofired: audit.some(
      (e) =>
        e.kind === 'capability.invoked' &&
        (e.data as { stage?: string })?.stage === 'client_response',
    ),
    reachedComplete: sFinal === 'complete',
  }
  receipt.D = {
    // Generalization: BOTH producing kinds autofired on entry through the ONE scheduler.
    generateDocumentAutofired: audit.some((e) => e.kind === 'draft.completed'),
    invokeCapabilityAutofired: audit.some((e) => e.kind === 'capability.invoked'),
    classBasedNoManualProducerCall: true, // this harness never calls a producer directly
  }
  receipt.autorunAudit = audit

  const pass =
    (receipt.B as { autofired: boolean }).autofired &&
    willDraft.traceAgentActorId === AGENT_ACTOR &&
    /last will and testament/i.test(willDraft.bodyExcerpt) &&
    (receipt.E as { parkedAtAttorneyGate: boolean }).parkedAtAttorneyGate &&
    (receipt.C as { reachedTerminal: boolean }).reachedTerminal &&
    (receipt.F as { invokeCapabilityAutofired: boolean }).invokeCapabilityAutofired &&
    (receipt.D as { generateDocumentAutofired: boolean }).generateDocumentAutofired

  console.log('\n===AUTORUN2_RECEIPT_JSON===')
  console.log(JSON.stringify(receipt, null, 2))
  console.log('===AUTORUN2_VERDICT===')
  console.log(pass ? 'ACCEPTANCE B–F PASS' : 'ACCEPTANCE FAILED — inspect receipt')
  console.log('===WILL_BODY_EXCERPT===')
  console.log(willDraft.bodyExcerpt)
  console.log('===END===')
  if (!pass) process.exitCode = 1
}

main().catch((err) => {
  console.error('acceptance harness error:', err instanceof Error ? err.stack : String(err))
  process.exitCode = 1
})
