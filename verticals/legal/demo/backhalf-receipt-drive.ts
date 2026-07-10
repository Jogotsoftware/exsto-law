// BACKHALF-BLOCKS-1 — acceptance drive (PROD, tenant zero). Produces receipts #3,
// #4, #6 (+ the will-variant of #1) in two matter drives:
//
//   REAL will matter:  drive to draft v1 (DEPLOYED worker, old code — proves the
//     queue path) → REGENERATE locally with change notes → v2 on the SAME entity
//     (#4) → approve (will fee 350 accrues — #1 will variant) → matter parks on the
//     client_response CLIENT gate → attorney SKIP (#3-skip) → complete+archive.
//
//   CLONE service + matter: clone the will service, save a deliberately BARE
//     drafting prompt (auto-append receipt — #6A), author its graph with the
//     client_response edge via legal.client_request.accept (WP2-valid: fees +
//     complete_matter declared), drive to draft v1 — drafted FROM the bare-saved
//     prompt (#6B: parseable ai_draft, worker_job + document_version receipts) →
//     approve → client ACCEPT fires legal.client_request.accept (first fire ever)
//     and advances the client gate (#3-accept).
//
// Run:  LEGAL_DRAFTING_MODEL=claude-sonnet-4-6 tsx --env-file=<main>/.env.local this-file
// Phases are resumable-ish: pass PHASE=clone / PHASE=real to run one half.
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import {
  cloneService,
  updateServiceMetadata,
  updateDraftingPrompt,
  getDraftingPrompt,
  setServiceLifecycleAI,
  approveDraft,
  acceptClientStage,
  skipClientStage,
  completeMatter,
  regenerateStageDocument,
  listStandaloneTemplates,
} from '@exsto/legal'
import type { Lifecycle } from '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { randomUUID } from 'node:crypto'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // Joe Pacheco (human)
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
const WILL_SERVICE = 'nc_will_drafting'
const WILL_DOC_KIND = 'last_will_and_testament'

// The three required slots and NOTHING else — no trace contract. The save path
// (WP5) must auto-append it; the stored prompt is receipt #6A.
const BARE_PROMPT = `Draft a North Carolina last will and testament for the client below. Fill every {{variable}} in the template from the answers; flag anything missing as [NEEDS ATTORNEY INPUT].

## Questionnaire responses
\`\`\`json
{{questionnaire_responses_json}}
\`\`\`

## Consultation transcript
{{transcript_text}}

## Document template
{{operating_agreement_template}}`

const WILL_RESPONSES: Record<string, unknown> = {
  testator_name: 'Harold James Britt',
  testator_county: 'Durham',
  testator_address: '88 Cedar Ridge Ct, Durham, NC 27713',
  marital_status: 'married',
  spouse_name: 'Alice Britt',
  children_names: 'None',
  specific_bequests: 'My woodworking tools to my nephew, Carl Britt.',
  residuary_disposition: 'Entirely to my spouse, Alice Britt.',
  executor_name: 'Alice Britt',
  successor_executor_name: 'Carl Britt',
  guardian_name: 'n/a',
  execution_date: 'to be executed',
}

async function q<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  return withActionContext(ctx, async (client) => (await client.query<T>(sql, params)).rows)
}

async function currentState(matterId: string): Promise<string> {
  const r = await q<{ current_state: string }>(
    `SELECT current_state FROM workflow_instance WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
    [TENANT, matterId],
  )
  return r[0]?.current_state ?? '(none)'
}

async function draftVersions(
  matterId: string,
): Promise<{ entity: string; v: number; status: string }[]> {
  const r = await q<{ entity: string; v: number; status: string }>(
    `SELECT dv.document_entity_id AS entity, dv.version_number AS v, dv.status
       FROM document_version dv
       JOIN relationship rel ON rel.source_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = rel.relationship_kind_id AND rkd.kind_name='draft_of'
      WHERE dv.tenant_id=$1 AND rel.target_entity_id=$2 ORDER BY dv.version_number`,
    [TENANT, matterId],
  )
  return r
}

async function openAndUpload(serviceKey: string, clientName: string): Promise<string> {
  const matterId = randomUUID()
  const matterNumber = `M-${matterId.slice(0, 8).toUpperCase()}`
  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: clientName,
      client_email: `${clientName.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
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
      matter_entity_id: matterId,
      matter_number: matterNumber,
      service_key: serviceKey,
      workflow_route: 'manual',
      attribution_source: 'attorney_manual',
      client_entity_id: eff.clientEntityId,
      questionnaire_entity_id: eff.questionnaireEntityId,
      intake_action_id: intake.actionId,
      client_display_name: clientName,
    },
  })
  await submitAction(ctx, {
    actionKindName: 'document.upload',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterId,
      object_key: `backhalf/${serviceKey}/intake-${matterId.slice(0, 8)}.txt`,
      original_filename: 'intake-note.txt',
      content_type: 'text/plain',
      size_bytes: 64,
      sha256_hex: 'cd'.repeat(32),
      document_kind: 'client_intake_note',
      document_source: 'client_uploaded',
      client_contact_id: eff.clientEntityId,
    },
  })
  console.log(`  opened ${matterNumber} (${matterId}); state=${await currentState(matterId)}`)
  return matterId
}

// Wait for the DEPLOYED worker to draft v1 (the queue-path receipt).
async function waitForDraft(matterId: string, targetState: string): Promise<void> {
  const deadline = Date.now() + 5 * 60 * 1000
  let last = ''
  while (Date.now() < deadline) {
    const state = await currentState(matterId)
    const jobs = await q<{ status: string }>(
      `SELECT status FROM worker_job WHERE tenant_id=$1 AND payload->>'matter_entity_id'=$2 ORDER BY created_at DESC`,
      [TENANT, matterId],
    )
    const line = `  [poll] state=${state} jobs=${jobs.map((j) => j.status).join(',') || '(none)'}`
    if (line !== last) console.log(line)
    last = line
    if (state === targetState) return
    if (jobs.some((j) => j.status === 'dead_letter')) throw new Error('worker job dead-lettered')
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error(`timed out waiting for ${targetState}`)
}

async function willTemplateEntityId(): Promise<string> {
  const all = await listStandaloneTemplates(ctx)
  const t = all.find((x) => x.name === 'NC Last Will and Testament' && x.category === 'document')
  if (!t) throw new Error('will template not found')
  return t.templateEntityId
}

// ── Phase A: the REAL will matter — regenerate (#4), approve+fee, skip (#3-skip) ──
async function phaseReal(): Promise<void> {
  console.log('\n═══ PHASE REAL — nc_will_drafting matter ═══')
  // Resume support: REAL_MATTER_ID skips the open+draft (already done in a prior run).
  let matterId = (process.env.REAL_MATTER_ID ?? '').trim()
  if (!matterId) {
    matterId = await openAndUpload(WILL_SERVICE, 'Harold James Britt')
    await waitForDraft(matterId, 'review_send_will')
  }
  console.log('  draft v1 by DEPLOYED worker:', JSON.stringify(await draftVersions(matterId)))

  // #4 — regenerate locally (new code): version n+1 on the SAME entity.
  const regen = await regenerateStageDocument(
    ctx,
    matterId,
    'generate_will',
    'Change the successor executor to Sarah Britt-Womble and add a $2,000 bequest to the Durham Rescue Mission.',
  )
  console.log('  ✓ regenerate:', JSON.stringify(regen))
  const versions = await draftVersions(matterId)
  console.log('  RECEIPT #4 versions:', JSON.stringify(versions))

  // Approve v2 → will fee ($350, declared by the reseed) accrues — #1 will variant.
  const v2 = await q<{ id: string }>(
    `SELECT dv.id FROM document_version dv
      JOIN relationship rel ON rel.source_entity_id = dv.document_entity_id
      JOIN relationship_kind_definition rkd ON rkd.id=rel.relationship_kind_id AND rkd.kind_name='draft_of'
     WHERE dv.tenant_id=$1 AND rel.target_entity_id=$2 ORDER BY dv.version_number DESC LIMIT 1`,
    [TENANT, matterId],
  )
  await approveDraft(ctx, { documentVersionId: v2[0]!.id })
  const fees = await q(
    `SELECT ekd.kind_name, e.payload->>'amount' AS amount, e.payload->>'document_kind' AS kind
       FROM event e JOIN event_kind_definition ekd ON ekd.id=e.event_kind_id
      WHERE e.tenant_id=$1 AND e.primary_entity_id=$2 AND ekd.kind_name='document_fee.recorded'`,
    [TENANT, matterId],
  )
  console.log('  RECEIPT #1 (will variant) fee after approve:', JSON.stringify(fees))
  console.log(`  state after approve: ${await currentState(matterId)}`)

  // #3-skip — the matter is parked on client_response (client gate): attorney skips.
  const skipped = await skipClientStage(ctx, matterId, 'client_response')
  console.log('  ✓ skip:', JSON.stringify(skipped))
  const hist = await q(
    `SELECT state_history FROM workflow_instance
      WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
    [TENANT, matterId],
  )
  console.log('  RECEIPT #3-skip state_history:', JSON.stringify(hist[0]?.state_history))
  const obs = await q(
    `SELECT e.payload FROM event e JOIN event_kind_definition ekd ON ekd.id=e.event_kind_id
      WHERE e.tenant_id=$1 AND e.primary_entity_id=$2 AND ekd.kind_name='observation'
        AND e.payload->>'kind'='client_step_skipped_by_attorney'`,
    [TENANT, matterId],
  )
  console.log('  RECEIPT #3-skip observation:', JSON.stringify(obs))

  // Completion: service.complete + archive (WP2 execution path).
  const done = await completeMatter(ctx, matterId, { archive: true })
  console.log('  ✓ completeMatter:', JSON.stringify(done))
  console.log(`\n  REAL_MATTER_ID=${matterId}`)
}

// ── Phase B: the CLONE — bare prompt (#6), accept (#3-accept) ─────────────────────
async function phaseClone(): Promise<void> {
  console.log('\n═══ PHASE CLONE — bare prompt + client accept ═══')
  const clone = await cloneService(ctx, WILL_SERVICE)
  console.log(`  cloned → ${clone.serviceKey}`)

  // Billing declaration for the clone (the WP2 validator requires it below).
  await updateServiceMetadata(ctx, {
    serviceKey: clone.serviceKey,
    displayName: clone.displayName,
    documentFees: { [WILL_DOC_KIND]: '100.00' },
  })

  // #6A — save the deliberately BARE prompt; the save must auto-append the contract.
  await updateDraftingPrompt(ctx, clone.serviceKey, WILL_DOC_KIND, BARE_PROMPT)
  const saved = await getDraftingPrompt(ctx, clone.serviceKey, WILL_DOC_KIND)
  const stored = saved?.promptText ?? ''
  console.log('  RECEIPT #6A stored prompt (auto-appended contract):')
  console.log(
    stored.includes('Reasoning trace (required)') && stored.includes('"conclusion"')
      ? '  ✓ contract present in stored prompt'
      : `  ✗ CONTRACT MISSING — tail: ${stored.slice(-400)}`,
  )

  // Author the clone's graph: client_response advances via legal.client_request.accept.
  const templateId = await willTemplateEntityId()
  const graph: Lifecycle = [
    {
      key: 'client_intake',
      label: 'Client intake',
      entry: true,
      blocking: true,
      action: { kind: 'view_intake' },
      advances_to: [{ to: 'generate_will', gate: 'client', via: 'document.upload' }],
    },
    {
      key: 'generate_will',
      label: 'Draft the will',
      blocking: true,
      action: {
        kind: 'invoke_capability',
        config: {
          capability_slug: 'document_generation',
          capability_config: { template_entity_id: templateId, generation_mode: 'ai_draft' },
        },
      },
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
      label: 'Client reviews the draft',
      blocking: true,
      advances_to: [{ to: 'complete', gate: 'client', via: 'legal.client_request.accept' }],
    },
    {
      key: 'complete',
      label: 'Complete matter',
      blocking: false,
      action: { kind: 'complete_matter' },
      terminal: true,
      advances_to: [],
    },
  ]
  const authored = await setServiceLifecycleAI(ctx, clone.serviceKey, graph, {
    conclusion:
      'BACKHALF-BLOCKS-1 receipt clone: will pipeline whose client_response edge advances on the client Accept (legal.client_request.accept).',
    confidence: 0.9,
    modelIdentity: 'claude',
  })
  console.log(`  ✓ clone graph authored (v${authored.version}) — WP2 validator passed the write`)

  const matterId = await openAndUpload(clone.serviceKey, 'Eleanor Ruth Vance')
  await waitForDraft(matterId, 'review_send_will')
  console.log('  RECEIPT #6B draft v1 from the bare-saved prompt (DEPLOYED worker):')
  console.log('   ', JSON.stringify(await draftVersions(matterId)))
  const trace = await q<{ n: string }>(
    `SELECT count(*) AS n FROM document_version dv
      JOIN relationship rel ON rel.source_entity_id=dv.document_entity_id
      JOIN relationship_kind_definition rkd ON rkd.id=rel.relationship_kind_id AND rkd.kind_name='draft_of'
     WHERE dv.tenant_id=$1 AND rel.target_entity_id=$2 AND dv.reasoning_trace_id IS NOT NULL`,
    [TENANT, matterId],
  )
  console.log(`  parseable ai_draft with reasoning trace: ${trace[0]!.n} version(s)`)

  // Approve → matter parks on client_response (accept-gated).
  const v1 = await q<{ id: string }>(
    `SELECT dv.id FROM document_version dv
      JOIN relationship rel ON rel.source_entity_id=dv.document_entity_id
      JOIN relationship_kind_definition rkd ON rkd.id=rel.relationship_kind_id AND rkd.kind_name='draft_of'
     WHERE dv.tenant_id=$1 AND rel.target_entity_id=$2 ORDER BY dv.version_number DESC LIMIT 1`,
    [TENANT, matterId],
  )
  await approveDraft(ctx, { documentVersionId: v1[0]!.id })
  console.log(`  state after approve: ${await currentState(matterId)}`)

  // #3-accept — the CLIENT accepts: first legal.client_request.accept fire ever.
  const before = await q<{ n: string }>(
    `SELECT count(*) AS n FROM action a JOIN action_kind_definition akd ON akd.id=a.action_kind_id
      WHERE akd.kind_name='legal.client_request.accept'`,
    [],
  )
  const accepted = await acceptClientStage(ctx, { matterEntityId: matterId })
  const after = await q<{ n: string }>(
    `SELECT count(*) AS n FROM action a JOIN action_kind_definition akd ON akd.id=a.action_kind_id
      WHERE akd.kind_name='legal.client_request.accept'`,
    [],
  )
  console.log(
    `  RECEIPT #3-accept: fires before=${before[0]!.n} after=${after[0]!.n}; result=${JSON.stringify(accepted)}`,
  )
  console.log(`  state after accept: ${await currentState(matterId)}`)
  console.log(`\n  CLONE_SERVICE=${clone.serviceKey}\n  CLONE_MATTER_ID=${matterId}`)
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  if (!process.env.LEGAL_DRAFTING_MODEL) throw new Error('Set LEGAL_DRAFTING_MODEL explicitly.')
  const phase = (process.env.PHASE ?? 'all').toLowerCase()
  if (phase === 'real' || phase === 'all') await phaseReal()
  if (phase === 'clone' || phase === 'all') await phaseClone()
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
    process.exit(1)
  })
