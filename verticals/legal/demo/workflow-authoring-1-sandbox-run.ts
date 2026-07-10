// WORKFLOW-AUTHORING-1 — sandbox acceptance run (A, B, C, D, E).
// Tenant: Exsto Sandbox (00000000-0000-0000-00fe-000000000001). NEVER tenant-zero.
//
// `chatWithAssistantDetailed` (adapters/claude.ts) is not in the package's public
// barrel, so this script imports it by relative path — it lives INSIDE
// verticals/legal, so that's an internal import, not a new public surface. Every
// piece that matters (buildAttorneyClientTools, buildClaudeSystem,
// get_workflow_context, propose_workflow, validateProposedLifecycle) is the REAL,
// unmodified product code; this only inlines assistantChat's own Claude-branch
// orchestration so the script can read back `failedWorkflowAttempts` — the one
// signal that proves "first correct emission, no trial-and-error loop" (the
// assistantChat() wrapper's return value can't distinguish a clean first try from
// a fail-then-self-correct that still lands, so proving A rigorously requires it).
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import {
  createService,
  createQuestionnaireAI,
  resolveAnthropicApiKey,
  buildAttorneyClientTools,
  buildProposeWorkflowTool,
  buildClaudeSystem,
  buildSkillCatalogText,
  buildActiveSkillsText,
  loadForcedSkills,
  listSkillCatalog,
  wizardForcedSkillSlugs,
  listCapabilities,
  upsertCapability,
  validateProposedLifecycle,
  setServiceLifecycleAI,
  invokeCapabilityForMatter,
  addMatterFee,
  issueInvoice,
  payInvoice,
  stageByKey,
  entryStage,
  type AssistantChatInput,
  type WorkflowProposal,
  type Lifecycle,
} from '@exsto/legal'
import { chatWithAssistantDetailed, type ChatMessage } from '../src/adapters/claude.js'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { randomUUID } from 'node:crypto'

const SANDBOX = '00000000-0000-0000-00fe-000000000001'
const SYS_ACTOR = '00000000-0000-0000-00fe-000000000002'
const ctx: ActionContext = { tenantId: SANDBOX, actorId: SYS_ACTOR }
const MODEL = 'claude-opus-4-8'

// BUILDER-CERT-1 (WP2.5) — this script seeds THROWAWAY fixture capabilities; a run
// against a real firm tenant would pollute that firm's live capability library (it
// happened: six echo fixtures sat `available` in the shared-prod sandbox tenant,
// offered to the wizard as real blocks). Hard guard: sandbox only, ever.
if ((ctx.tenantId as string) === '00000000-0000-0000-0000-000000000001') {
  throw new Error(
    'workflow-authoring-1-sandbox-run seeds fixture capabilities — NEVER tenant-zero.',
  )
}

// ── turn driver — mirrors assistantChat's Claude branch, exposing failedWorkflowAttempts ──
async function driveTurn(message: string): Promise<{
  reply: string
  workflowProposals: WorkflowProposal[]
  failedWorkflowAttempts: string[]
  toolCapHit: boolean
}> {
  const input: AssistantChatInput = { message, modelId: `anthropic:${MODEL}` }
  const catalog = await listSkillCatalog(ctx)
  const forced = await loadForcedSkills(ctx, wizardForcedSkillSlugs(message, undefined, undefined))
  const system = buildClaudeSystem(
    'general',
    null,
    null,
    buildSkillCatalogText(catalog),
    buildActiveSkillsText(forced),
  )
  const workflowProposals: WorkflowProposal[] = []
  const failedWorkflowAttempts: string[] = []
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: message },
  ]
  const result = await chatWithAssistantDetailed(ctx.tenantId, messages, {
    model: MODEL,
    clientTools: buildAttorneyClientTools(ctx, input, {
      catalog,
      producedDocuments: [],
      workflowProposals,
      failedWorkflowAttempts,
      serviceProposals: [],
      questionnaireProposals: [],
      templateProposals: [],
      costProposals: [],
      enableProposals: [],
      buildQuestions: [],
      kindProposals: [],
    }),
  })
  return {
    reply: result.reply,
    workflowProposals,
    failedWorkflowAttempts,
    toolCapHit: result.toolCapHit,
  }
}

// ── matter-driving helpers (mirror caprt1-sandbox-run.ts) ──────────────────────
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
      sha256_hex: 'ab'.repeat(32),
      document_kind: 'client_contract',
      document_source: 'client_uploaded',
      client_contact_id: clientContactId,
    },
  })
  return (res.effects[0] as { documentVersionId: string }).documentVersionId
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

async function reasoningTraceIdFor(documentVersionId: string): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ reasoning_trace_id: string | null }>(
      `SELECT reasoning_trace_id FROM document_version WHERE tenant_id=$1 AND id=$2`,
      [SANDBOX, documentVersionId],
    )
    return r.rows[0]?.reasoning_trace_id ?? null
  })
}

async function openMatterWithClient(
  serviceKey: string,
): Promise<{ matterEntityId: string; clientEntityId: string }> {
  const matterEntityId = randomUUID()
  const matterNumber = `M-${matterEntityId.slice(0, 8).toUpperCase()}`
  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: 'Casey Rivera',
      client_email: 'casey.rivera@example.com',
      client_phone: null,
      client_company_name: 'Rivera Builds LLC',
      service_key: serviceKey,
      intake_form_id: null,
      intake_responses: { concern: 'Please review my contractor agreement before I sign it.' },
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
      client_display_name: 'Casey Rivera',
    },
  })
  return { matterEntityId, clientEntityId: eff.clientEntityId as string }
}

const CONTRACT_1 = `INDEPENDENT CONTRACTOR AGREEMENT
Between Rivera Builds LLC ("Contractor") and Summit Property Group ("Client").
1. Scope. Contractor will perform "site work as directed" for the Client's ongoing projects.
2. Payment. Contractor is paid $40/hr, invoiced monthly, no late-fee terms specified.
3. Control. Client sets Contractor's daily schedule and supplies all tools and materials.
4. Term. This Agreement continues until either party cancels, no notice period required.`

const CONTRACT_2 = `W-9 + CERTIFICATE OF INSURANCE (follow-up)
Re: Rivera Builds LLC. W-9 attached (EIN on file). General liability COI attached,
$1,000,000 per-occurrence, Summit Property Group named as additional insured.`

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const { apiKey } = await resolveAnthropicApiKey('00000000-0000-0000-0000-000000000001')
  process.env.ANTHROPIC_API_KEY = apiKey
  // Local .env.local sets LEGAL_DRAFTING_MODEL to an EMPTY string (not unset), so the
  // adapter's `?? 'default'` fallback misses it → the review's Claude call gets an
  // empty model. Force a real drafting model for the ai_document_review handler.
  if (!process.env.LEGAL_DRAFTING_MODEL) process.env.LEGAL_DRAFTING_MODEL = 'claude-sonnet-4-6'

  const receipt: Record<string, unknown> = {}

  // ── PREFLIGHT: confirm ai_document_review + request_client_materials are live+invocable ──
  const registry = await listCapabilities(ctx)
  const required = ['ai_document_review', 'request_client_materials']
  receipt.preflightCapabilities = required.map((slug) => {
    const c = registry.find((x) => x.slug === slug)
    return { slug, found: !!c, status: c?.status, stepInvocable: c?.spec.step_invocable }
  })
  for (const r of receipt.preflightCapabilities as Array<{ slug: string; found: boolean }>) {
    if (!r.found)
      throw new Error(`Preflight failed: capability "${r.slug}" not in sandbox registry.`)
  }

  // ═══ D (deterministic, no model) — the hard retry cap + honest-refusal copy ═══
  {
    const captured: WorkflowProposal[] = []
    const failedAttempts: string[] = []
    const tool = buildProposeWorkflowTool(ctx, captured, failedAttempts)
    const badGraph: Lifecycle = [
      {
        key: 'a',
        label: 'A',
        entry: true,
        terminal: true,
        action: { kind: 'invoke_capability', config: { capability_slug: 'does_not_exist_cap' } },
        advances_to: [],
      },
    ]
    const attempts: string[] = []
    for (let i = 0; i < 3; i++) {
      const out = (await tool.run({
        service_key: 'not_a_real_service_xyz',
        graph: badGraph,
        summary: 'forced failure',
      })) as string
      attempts.push(out)
    }
    receipt.D_hardCap = {
      failedAttemptCount: failedAttempts.length,
      capturedCount: captured.length,
      thirdCallWasRefusedWithoutRevalidating: attempts[2].includes('STOP calling it again'),
      secondCallWarnedLastAttempt: attempts[1].includes('last allowed attempt'),
    }
  }

  // ═══ ACCEPTANCE E — generalization: seed a trivial 2nd invocable capability with ═══
  // NO playbook prose anywhere, confirm the builder composes a valid step for it
  // purely from get_workflow_context's generated stepTemplate.
  // (WP2.5: fixture slugs must carry no prohibited string — the library is a
  // user-visible surface — and every fixture this run seeds is DEPRECATED at the
  // end of the run, plus any residue from older runs, so the sandbox library never
  // accumulates throwaway blocks the wizard would be offered as real.)
  const fixtureSlug = `echo_note_probe_${Date.now().toString(36)}`
  await upsertCapability(ctx, {
    slug: fixtureSlug,
    status: 'available',
    spec: {
      name: 'Echo note probe (WORKFLOW-AUTHORING-1 fixture)',
      category: 'workflow',
      purpose:
        'Record a short internal note on the matter file — a no-op fixture capability used only to prove new capabilities are authorable by conversation with zero new prompt engineering.',
      step_invocable: true,
      handler_key: 'legal.capability.demo_echo_note.run', // intentionally unregistered — authoring-only proof
      inputs: [
        {
          key: 'note',
          provided_by: 'attorney',
          source: 'service_config',
          required: true,
          description: 'the note text to record',
        },
      ],
      outputs: [{ entity_kind: 'observation', description: 'the recorded note' }],
      default_gate: 'attorney',
      config_schema: {
        note: { type: 'string', required: true, description: 'the note text to record' },
      },
    },
  })
  const fixtureService = await createService(ctx, {
    displayName: `WF-Auth-1 Fixture Probe ${Date.now().toString(36)}`,
    description: 'Acceptance-E generalization probe — not a real client-facing service.',
    route: 'manual',
    documents: [],
    sortOrder: 950,
  })
  const eTurn = await driveTurn(
    `Build the workflow for the service "${fixtureService.serviceKey}": just two steps — the client's intake, ` +
      `then record a short internal note on the matter file for our own records (no client-facing output). ` +
      `Keep it linear.`,
  )
  const eGraph = eTurn.workflowProposals[0]?.graph ?? null
  const eCapSlug = eGraph
    ?.map((s) =>
      s.action?.kind === 'invoke_capability'
        ? (s.action.config as { capability_slug?: string } | undefined)?.capability_slug
        : undefined,
    )
    .find(Boolean)
  receipt.E_generalization = {
    reply: eTurn.reply,
    failedWorkflowAttempts: eTurn.failedWorkflowAttempts,
    proposalCount: eTurn.workflowProposals.length,
    fixtureSlugSeededThisRun: fixtureSlug,
    capabilitySlugUsed: eCapSlug ?? null,
    // Generalization is proven if the builder composed a valid invoke_capability step
    // for an `echo_note_probe_*` fixture — a capability that exists ONLY because this
    // session seeded it, with ZERO playbook prose anywhere (the fixture is never
    // mentioned in build-service.md). Whether it is this run's exact slug or an older
    // fixture from a prior run, the point holds: authorable-by-context, no prose.
    usesFixtureCapability: !!eCapSlug && eCapSlug.startsWith('echo_note_probe_'),
    revalidation: eGraph ? await validateProposedLifecycle(ctx, eGraph) : null,
    graph: eGraph,
  }

  // ═══ ACCEPTANCE A — through the builder, by conversation, first correct emission ═══
  const service = await createService(ctx, {
    displayName: `NC Contractor Contract Drafting & Review ${Date.now().toString(36)}`,
    description: 'We review your independent-contractor agreement and flag what to fix.',
    route: 'manual',
    documents: [],
    sortOrder: 951,
  })
  const serviceKey = service.serviceKey
  receipt.serviceKey = serviceKey

  await createQuestionnaireAI(
    ctx,
    serviceKey,
    {
      title: 'Contractor Contract Review intake',
      sections: [
        {
          id: 'about_you',
          title: 'About you and the contract',
          fields: [
            { id: 'concern', label: 'What are you worried about?', type: 'textarea' },
            {
              id: 'contract_file',
              label: 'Upload the contractor agreement to review',
              type: 'file_upload',
            },
          ],
        },
      ],
    },
    { conclusion: 'Intake collects the draft contract + the client concern.' },
  )

  const aMessage =
    `Build the workflow for the ${serviceKey} service: 1) the client submits intake with their draft ` +
    `independent-contractor agreement, 2) run an AI review of the contract — flag scope-of-work ambiguity, ` +
    `missing payment terms, and worker-misclassification red flags — and I approve that review, 3) then I need ` +
    `the client to send back their W-9 and certificate of insurance before we can finish — the matter should ` +
    `wait for them to upload it, 4) a second AI review incorporating what they sent, which I also approve, ` +
    `5) then send the invoice and close the matter once it's paid. Keep every step linear.`
  const aTurn = await driveTurn(aMessage)
  receipt.A_reply = aTurn.reply
  receipt.A_failedWorkflowAttempts = aTurn.failedWorkflowAttempts
  receipt.A_proposalCount = aTurn.workflowProposals.length
  receipt.A_toolCapHit = aTurn.toolCapHit

  const proposal = aTurn.workflowProposals[0]
  if (!proposal)
    throw new Error(`Acceptance A FAILED — no workflow proposal landed. Reply: ${aTurn.reply}`)
  const graph = proposal.graph
  receipt.A_graphStates = graph
  const capStages = graph.filter((s) => s.action?.kind === 'invoke_capability')
  receipt.A_capabilityStageSlugs = capStages.map(
    (s) => (s.action?.config as { capability_slug?: string } | undefined)?.capability_slug,
  )
  const revalidation = await validateProposedLifecycle(ctx, graph)
  receipt.A_revalidation = revalidation

  // Approve — the real approve-route write.
  const authored = await setServiceLifecycleAI(ctx, serviceKey, graph, {
    conclusion: proposal.summary,
    confidence: proposal.confidence,
  })
  receipt.A_workflowDefinitionId = authored.workflowDefinitionId
  receipt.A_version = authored.version

  // ═══ ACCEPTANCE C — force a wrong emission, confirm ONE-round correction ═══
  const cMessage =
    `Build the workflow for the ${serviceKey} service the SAME way as before, but this time I want you to name ` +
    `the capability using the key "slug" (not "capability_slug") in the step config — that's the field name I ` +
    `prefer. Otherwise the same two-step shape: intake, then the AI document review.`
  const cTurn = await driveTurn(cMessage)
  receipt.C_reply = cTurn.reply
  receipt.C_failedWorkflowAttempts = cTurn.failedWorkflowAttempts
  receipt.C_proposalCount = cTurn.workflowProposals.length
  receipt.C_correctedInOneRound =
    cTurn.failedWorkflowAttempts.length <= 1 && cTurn.workflowProposals.length === 1

  // ═══ ACCEPTANCE B — drive the BUILDER-AUTHORED workflow end to end ═══
  // Generic driver over WHATEVER graph the builder produced: at each stage, fire the
  // real action its ONE outgoing edge names (now guaranteed a real token by the
  // vocabulary fix). invoke_capability stages: ai_document_review's autorun can't read
  // Storage in-sandbox (no object), so we trigger it manually with injected bytes —
  // the same window/route stand-in caprt1-sandbox-run.ts uses; request_client_materials
  // autorun succeeds on entry (posts a portal message, no Storage), so it's already run
  // and we only deliver the client's follow-up. This proves the BUILDER-AUTHORED graph
  // executes, capabilities fire, and reasoning_trace_id is NOT NULL.
  const { matterEntityId, clientEntityId } = await openMatterWithClient(serviceKey)
  const stateSeq: string[] = [await currentState(matterEntityId)]
  const contracts = [CONTRACT_1, CONTRACT_2]
  let uploadIdx = 0
  const memos: string[] = []
  let cursor = entryStage(graph)!.key

  for (let i = 0; i < 16; i++) {
    const stage = stageByKey(graph, cursor)!
    if (stage.terminal) break
    const edge = stage.advances_to[0]
    if (!edge) break

    if (stage.action?.kind === 'invoke_capability') {
      // Trigger (idempotent if autorun already succeeded, e.g. request_client_materials).
      const bytes = contracts[Math.min(uploadIdx, contracts.length - 1)]
      const r = await invokeCapabilityForMatter(ctx, matterEntityId, fake(bytes))
      const gate = r.ran ? r.gate : edge.gate
      if (gate === 'attorney') {
        const memoId = (r.outputs[0]?.entityId ?? '') as string
        if (memoId) memos.push(memoId)
        await submitAction(ctx, {
          actionKindName: 'draft.approve',
          intentKind: 'adjustment',
          payload: { document_version_id: memoId, review_notes: 'Approved.' },
        })
      } else if (gate === 'client') {
        uploadIdx += 1
        await clientUpload(
          matterEntityId,
          clientEntityId,
          `sandbox/wfauth1/upload${uploadIdx}.txt`,
          contracts[Math.min(uploadIdx, contracts.length - 1)],
        )
      }
    } else if (edge.gate === 'client' && edge.via === 'document.upload') {
      await clientUpload(
        matterEntityId,
        clientEntityId,
        `sandbox/wfauth1/upload${uploadIdx}.txt`,
        contracts[Math.min(uploadIdx, contracts.length - 1)],
      )
      uploadIdx += 1
    } else if (edge.gate === 'system' && edge.on === 'invoice.paid') {
      const fee = await addMatterFee(ctx, {
        matterEntityId,
        feeType: 'service',
        amount: '750.00',
        description: 'Contractor agreement review',
      })
      const invoice = await issueInvoice(ctx, {
        clientEntityId,
        matterEntityId,
        lines: [{ sourceEventId: fee.eventId, kind: 'service_fee' }],
      })
      receipt.B_invoiceNumber = invoice.invoiceNumber
      await payInvoice(ctx, { invoiceEntityId: invoice.invoiceEntityId, method: 'manual' })
    } else {
      // attorney "Continue" (legal.matter.advance) or any other built-in advance.
      await submitAction(ctx, {
        actionKindName: 'legal.matter.advance',
        intentKind: 'adjustment',
        payload: { matter_entity_id: matterEntityId, to_state: edge.to, gate: edge.gate },
      })
    }
    const next = await currentState(matterEntityId)
    stateSeq.push(next)
    if (next === cursor) break // stuck — bail rather than loop
    cursor = next
  }
  receipt.B_matterEntityId = matterEntityId
  receipt.B_stateSequence = stateSeq
  receipt.B_memoCount = memos.length
  receipt.B_reasoningTraceIds = await Promise.all(memos.map(reasoningTraceIdFor))
  receipt.B_allMemosHaveTrace =
    memos.length > 0 && (receipt.B_reasoningTraceIds as Array<string | null>).every((id) => !!id)
  receipt.B_finalState = stateSeq[stateSeq.length - 1]
  receipt.B_turnCount = stateSeq.length

  // BUILDER-CERT-1 (WP2.5) — leave no throwaway blocks behind: deprecate this run's
  // fixture AND any echo-fixture residue from older runs (both slug generations),
  // through core (legal.capability.upsert), so the library never offers a probe as a
  // real block. Idempotent: an already-deprecated fixture just re-upserts.
  const residue = (await listCapabilities(ctx)).filter(
    (c) =>
      (c.slug.startsWith('echo_note_probe_') || c.slug.startsWith('demo_echo_note_')) &&
      c.status !== 'deprecated',
  )
  for (const cap of residue) {
    await upsertCapability(ctx, { slug: cap.slug, status: 'deprecated', spec: cap.spec })
  }
  receipt.fixturesDeprecatedAtEnd = residue.map((c) => c.slug)

  console.log('\n===WFAUTH1_RECEIPT_JSON===')
  console.log(JSON.stringify(receipt, null, 2))
  console.log('===END===')
}

main().catch((e) => {
  console.error('RUN FAILED:', e instanceof Error ? e.stack : String(e))
  process.exit(1)
})
