// RUNTIME-AUTORUN-2 — A0: PROVE THE PRODUCER FIRST (STOP-gate).
//
// Directly invoke the generate_document producer (runDraftGeneration) for a WILL in
// SANDBOX and confirm it produces a REAL document — the actual drafted will from
// template + intake + drafting instructions — written as a document_version whose
// content lives in content_blob, attributed to the in-app AI agent actor
// (00000000-0000-0000-0001-000000000004, the same actor #303 uses). If it does NOT
// produce a real will, the HANDLER is broken → STOP and report before touching autorun.
//
// This touches ONLY the producer (runDraftGeneration) and read-back queries. It does
// NOT touch autorun, the advance path, or any live tenant. runDraftGeneration is not
// on the package barrel, so it is imported by relative path (an internal import inside
// verticals/legal — the same pattern the WORKFLOW-AUTHORING-1 harness uses for
// chatWithAssistantDetailed), NOT a new public surface.
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import { createService, resolveAnthropicApiKey } from '@exsto/legal'
import { runDraftGeneration } from '../src/api/generateDraft.js'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { randomUUID } from 'node:crypto'

const SANDBOX = '00000000-0000-0000-00fe-000000000001'
const SYS_ACTOR = '00000000-0000-0000-00fe-000000000002'
const AGENT_ACTOR = '00000000-0000-0000-0001-000000000004' // #303's in-app AI agent actor
const ctx: ActionContext = { tenantId: SANDBOX, actorId: SYS_ACTOR }

// A real NC Last Will & Testament template with merge tokens the intake answers fill.
// The producer merges the intake answers into this via the drafting prompt.
const WILL_TEMPLATE = `# LAST WILL AND TESTAMENT OF {{testator_full_name}}

I, {{testator_full_name}}, a resident of {{county}} County, North Carolina, being of sound
mind, declare this to be my Last Will and Testament, revoking all wills and codicils I have
previously made.

## Article I — Family
{{family_statement}}

## Article II — Executor
I nominate {{executor_name}} to serve as Executor of this Will. If {{executor_name}} is unable
or unwilling to serve, I nominate {{alternate_executor_name}} as successor Executor. My Executor
shall serve without bond.

## Article III — Specific Bequests
{{specific_bequests}}

## Article IV — Residuary Estate
I give the residue of my estate to {{residuary_beneficiary}}.

## Article V — Guardian for Minor Children
{{guardian_clause}}

## Article VI — General Provisions
This Will shall be governed by the laws of the State of North Carolina.

_____________________________
{{testator_full_name}}, Testator`

// A will-appropriate drafting prompt (adapted from templates/drafting-prompt.md): same
// three fixed slots the assembler fills + the REQUIRED fenced ```json reasoning-trace
// block (splitDocumentAndTrace throws without it). Configured on the service so
// getDraftingPrompt resolves it config-first (the repo fallback is OA-specific).
const WILL_DRAFTING_PROMPT = `You are the drafting agent for a North Carolina estate-planning practice. Produce a first draft of a **North Carolina Last Will and Testament** for a client of the Firm, using the client's intake answers and the Firm's template below.

# Rules
1. **Jurisdiction is North Carolina.** All provisions must be consistent with N.C. Gen. Stat. Chapter 31 (Wills). Do not import default rules from other states.
2. **The output must be a complete last will and testament** in markdown, ready for attorney review — not a checklist or outline.
3. **Use the template provided** as the structural backbone; preserve its article structure.
4. **Replace every {{variable}} slot** using the intake answers. If a slot cannot be filled, write a clearly flagged placeholder like [NEEDS ATTORNEY INPUT: <what is missing>].
5. **Do not invent facts** (beneficiary names, bequests, executors) not present in the intake answers. Flag anything missing.
6. Write in plain, lawyerly English. No marketing language, no emojis.

The client's intake answers (use these to fill the document):
{{questionnaire_responses_json}}

Consultation notes, if any (additional context):
{{transcript_text}}

The document template to complete:
{{operating_agreement_template}}

# Reasoning trace (required)
After the will text, output a fenced \`\`\`json block with this shape (the review UI relies on it — do not skip it):
\`\`\`json
{
  "prompt_id": "will-drafting@v1",
  "model_identity": "<model id you used>",
  "evidence": [{ "source": "questionnaire", "field": "<field id>", "value": "<value>", "used_in": "<article>" }],
  "alternatives_considered": [],
  "conclusion": "<one-sentence summary of the will's posture>",
  "confidence": 0.8,
  "ambiguities": []
}
\`\`\``

// Rich will intake answers so the model has real facts to draft from.
const WILL_RESPONSES: Record<string, unknown> = {
  testator_full_name: 'Margaret Ellen Whitfield',
  county: 'Wake',
  marital_status: 'widowed',
  children: [
    'Thomas Whitfield (adult)',
    'Sarah Whitfield-Cole (adult)',
    'Emily Whitfield (age 15)',
  ],
  executor_name: 'Thomas Whitfield',
  alternate_executor_name: 'Sarah Whitfield-Cole',
  specific_bequests: [
    'My 1968 Steinway grand piano to my daughter Sarah Whitfield-Cole.',
    'My late husband’s gold pocket watch to my son Thomas Whitfield.',
    '$25,000 to the Wake County Public Library Foundation.',
  ],
  residuary_beneficiary: 'my three children in equal shares, per stirpes',
  minor_children: true,
  guardian_for_minors: 'Sarah Whitfield-Cole',
  concern:
    'I want a straightforward will leaving specific keepsakes to my two older children, a charitable gift, and everything else split equally, with a guardian named for my youngest.',
}

async function upsertWillServiceConfig(serviceKey: string, displayName: string): Promise<void> {
  // ONE legal.service.upsert that registers the docKind, binds the template, and sets
  // a proper will drafting prompt — exactly the transitions_patch shape createTemplateAI
  // uses, but with our own prompt (the seeded default omits the required trace block).
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

async function openWillMatter(serviceKey: string): Promise<string> {
  const matterEntityId = randomUUID()
  const matterNumber = `M-${matterEntityId.slice(0, 8).toUpperCase()}`
  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: 'Margaret Ellen Whitfield',
      client_email: 'margaret.whitfield@example.com',
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
      client_display_name: 'Margaret Ellen Whitfield',
    },
  })
  return matterEntityId
}

interface DraftReadback {
  versionId: string | null
  versionNumber: number | null
  status: string | null
  documentKind: string | null
  reasoningTraceId: string | null
  traceAgentActorId: string | null
  bodyLength: number
  bodyExcerpt: string
}

async function readBackLatestDraft(matterEntityId: string): Promise<DraftReadback> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{
      version_id: string
      version_number: number
      status: string
      document_kind: string | null
      reasoning_trace_id: string | null
      body: string
    }>(
      `SELECT dv.id AS version_id, dv.version_number, dv.status,
              e_doc.metadata->>'document_kind' AS document_kind,
              dv.reasoning_trace_id, cb.body
         FROM document_version dv
         JOIN content_blob cb ON cb.id = dv.content_blob_id
         JOIN entity e_doc ON e_doc.id = dv.document_entity_id
         JOIN relationship rel ON rel.source_entity_id = dv.document_entity_id
         JOIN relationship_kind_definition rkd ON rkd.id = rel.relationship_kind_id
        WHERE dv.tenant_id = $1 AND rel.target_entity_id = $2 AND rkd.kind_name = 'draft_of'
        ORDER BY dv.version_number DESC LIMIT 1`,
      [SANDBOX, matterEntityId],
    )
    const row = r.rows[0]
    let traceAgentActorId: string | null = null
    if (row?.reasoning_trace_id) {
      const t = await client.query<{ agent_actor_id: string }>(
        `SELECT agent_actor_id FROM reasoning_trace WHERE tenant_id = $1 AND id = $2`,
        [SANDBOX, row.reasoning_trace_id],
      )
      traceAgentActorId = t.rows[0]?.agent_actor_id ?? null
    }
    return {
      versionId: row?.version_id ?? null,
      versionNumber: row?.version_number ?? null,
      status: row?.status ?? null,
      documentKind: row?.document_kind ?? null,
      reasoningTraceId: row?.reasoning_trace_id ?? null,
      traceAgentActorId,
      bodyLength: row?.body?.length ?? 0,
      bodyExcerpt: row?.body ? row.body.slice(0, 1400) : '',
    }
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const { apiKey } = await resolveAnthropicApiKey('00000000-0000-0000-0000-000000000001')
  process.env.ANTHROPIC_API_KEY = apiKey
  if (!process.env.LEGAL_DRAFTING_MODEL) process.env.LEGAL_DRAFTING_MODEL = 'claude-sonnet-4-6'

  const suffix = randomUUID().slice(0, 8)
  const displayName = `NC Will Drafting (A0 producer proof) ${suffix}`
  const service = await createService(ctx, {
    displayName,
    description: 'A0 producer proof — drafts a NC will from template + intake. Not client-facing.',
    route: 'manual',
    documents: [],
    sortOrder: 960,
  })
  const serviceKey = service.serviceKey
  await upsertWillServiceConfig(serviceKey, displayName)
  const matterEntityId = await openWillMatter(serviceKey)

  // THE PRODUCER — the exact call an autorun trigger would make on generate_document.
  const genResult = await runDraftGeneration(ctx, { matterEntityId, documentKind: 'will' })

  const draft = await readBackLatestDraft(matterEntityId)
  const body = draft.bodyExcerpt
  const proof = {
    producedAction: genResult ? (genResult.effects[0] as Record<string, unknown>) : null,
    serviceKey,
    matterEntityId,
    draft,
    // Faithfulness checks: it is a REAL will from THIS template + THESE intake answers.
    checks: {
      hasDocumentVersion: !!draft.versionId,
      attributedToAgentActor: draft.traceAgentActorId === AGENT_ACTOR,
      hasReasoningTrace: !!draft.reasoningTraceId,
      mentionsTestator: body.includes('Margaret Ellen Whitfield'),
      mentionsExecutor: body.includes('Thomas Whitfield'),
      mentionsSpecificBequest: /piano|pocket watch|Wake County Public Library/i.test(body),
      looksLikeWill: /last will and testament/i.test(body),
      substantialLength: draft.bodyLength > 800,
    },
  }
  const pass =
    proof.checks.hasDocumentVersion &&
    proof.checks.attributedToAgentActor &&
    proof.checks.hasReasoningTrace &&
    proof.checks.looksLikeWill &&
    proof.checks.mentionsTestator &&
    proof.checks.substantialLength

  console.log('\n===A0_RECEIPT_JSON===')
  console.log(JSON.stringify(proof, null, 2))
  console.log('===A0_VERDICT===')
  console.log(
    pass ? 'A0 PASS — producer generates a real will.' : 'A0 FAIL — STOP, do not touch autorun.',
  )
  console.log('===A0_BODY_EXCERPT===')
  console.log(body)
  console.log('===END===')
  if (!pass) process.exitCode = 1
}

main().catch((err) => {
  console.error('A0 harness error:', err)
  process.exitCode = 1
})
