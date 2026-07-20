// WF-FIX-1 — SANDBOX acceptance (A–E) for the service-workflow fixes.
// Tenant: Exsto Sandbox (00000000-0000-0000-00fe-000000000001). NEVER tenant-zero.
//
// RUN AGAINST A MAIN THAT HAS ALL WF-FIX-1 PRs MERGED (settle #410, review-step
// drafting #411, intake.completed #415, repin) AND migrations 0176/0177 applied to
// the target DB (the event/action kinds must exist in the sandbox tenant — the 0174
// vocab sweep propagates them).
//
//   A  settle: the Pacheco v5 shape (NON-BLOCKING consultation entry → intake gated
//      system on:transcript.received) — matter.open settles PAST consultation in the
//      same action (pass_through hop in state_history) and parks at intake (the
//      transcript gate: still wrong, but now the matter is one honest stage further).
//   B  intake.completed: the corrected shape (view_intake entry → on:intake.completed
//      → doc-annotated review) — matter.open lands the matter AT review in ONE action
//      (create → settle → dispatch), intake.completed event recorded.
//   C  review-step drafting: B's landing enqueued legal.draft.run with the stage's
//      template; driving the worker runtime drafts the document, the matter STAYS
//      parked at review with the draft; a second run no-ops (idempotent).
//   D  repin: save v2 of the service → the in-flight A matter repins to it
//      (successor instance, old one cancelled, workflow.repinned, settle ran);
//      negatives: already-latest no-op; a v3 with renamed stages refuses without
//      target_state and lists the valid keys.
//   E  retro-unstick: a matter parked on a stage that a per-matter override marks
//      non-blocking gets settled forward by the NEXT event that touches it
//      (settle-first in signalEvent), even when the event matches no edge.
//
// Usage (root .env.local carries DATABASE_URL):
//   npx tsx --env-file=.env.local verticals/legal/demo/service-flow-fix-acceptance.ts
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import { createService, setServiceLifecycleAI, type Lifecycle } from '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { randomUUID } from 'node:crypto'

const SANDBOX = '00000000-0000-0000-00fe-000000000001'
const SYS_ACTOR = '00000000-0000-0000-00fe-000000000002'
const ctx: ActionContext = { tenantId: SANDBOX, actorId: SYS_ACTOR }

const OA_TEMPLATE = `# OPERATING AGREEMENT OF {{company_name}}

This Operating Agreement of {{company_name}}, a single-member limited liability company,
is adopted by {{member_name}}, its sole member, effective {{effective_date}}.

## Article I — Formation
{{formation_statement}}

## Article II — Member
The sole member is {{member_name}}.

_____________________________
{{member_name}}, Sole Member`

const RESPONSES: Record<string, unknown> = {
  company_name: 'Fenwick Woodworks LLC',
  member_name: 'Harold James Fenwick',
  effective_date: '2026-07-20',
  formation_statement: 'The company was formed by filing Articles of Organization.',
}

let failures = 0
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// ── graph shapes ────────────────────────────────────────────────────────────────

// A: the live Pacheco v5 shape (what the attorney actually authored).
function pachecoShape(): Lifecycle {
  return [
    {
      key: 'consultation',
      label: 'Client consultation',
      entry: true,
      blocking: false,
      action: { kind: 'view_consultation' },
      advances_to: [{ to: 'client_intake', gate: 'system', on: 'transcript.received' }],
    },
    {
      key: 'client_intake',
      label: 'Client intake',
      blocking: true,
      action: { kind: 'view_intake' },
      advances_to: [{ to: 'review_send_oa', gate: 'system', on: 'transcript.received' }],
    },
    {
      key: 'review_send_oa',
      label: 'Review & send operating agreement',
      blocking: true,
      action: { kind: 'review_send_document' },
      documents: [{ docKind: 'operating_agreement', label: 'Operating agreement' }],
      advances_to: [{ to: 'complete', gate: 'attorney', via: 'legal.matter.advance' }],
    },
    {
      key: 'complete',
      label: 'Complete',
      terminal: true,
      action: { kind: 'complete_matter' },
      advances_to: [],
    },
  ]
}

// B/C: the corrected shape the new defaults steer to.
function correctedShape(): Lifecycle {
  return [
    {
      key: 'client_intake',
      label: 'Client intake',
      entry: true,
      blocking: true,
      action: { kind: 'view_intake' },
      advances_to: [{ to: 'review_send_oa', gate: 'system', on: 'intake.completed' }],
    },
    {
      key: 'review_send_oa',
      label: 'Review & send operating agreement',
      blocking: true,
      action: { kind: 'review_send_document' },
      documents: [{ docKind: 'operating_agreement', label: 'Operating agreement' }],
      advances_to: [{ to: 'complete', gate: 'attorney', via: 'legal.matter.advance' }],
    },
    {
      key: 'complete',
      label: 'Complete',
      terminal: true,
      action: { kind: 'complete_matter' },
      advances_to: [],
    },
  ]
}

// ── helpers (autorun-2 harness patterns) ────────────────────────────────────────

async function makeService(name: string, graph: Lifecycle): Promise<string> {
  // createService GENERATES the service key (input keys are ignored) — use the
  // returned one for every subsequent write.
  const created = await createService(ctx, {
    displayName: name,
    description: `${name} (WF-FIX-1 acceptance — not client-facing)`,
    route: 'manual',
    documents: [],
    sortOrder: 963,
  })
  const serviceKey = created.serviceKey
  await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'exploration',
    payload: {
      service_key: serviceKey,
      display_name: name,
      transitions_patch: {
        documents: ['operating_agreement'],
        document_templates: {
          template_version: 1,
          templates: { operating_agreement: OA_TEMPLATE },
        },
        generation: { modes: { operating_agreement: 'template_merge' } },
        // The enable gate requires a questionnaire (one section, one field).
        intake_schema: {
          sections: [
            {
              id: 'basics',
              title: 'Company basics',
              fields: [
                { id: 'company_name', label: 'Company name', type: 'text', required: true },
                { id: 'member_name', label: 'Sole member', type: 'text', required: true },
                { id: 'effective_date', label: 'Effective date', type: 'text' },
                { id: 'formation_statement', label: 'Formation statement', type: 'text' },
              ],
            },
          ],
        },
      },
    },
  })
  await setServiceLifecycleAI(ctx, serviceKey, graph, {
    conclusion: 'WF-FIX-1 acceptance lifecycle.',
    confidence: 0.9,
  })
  // New services (and their authored definitions) start 'deprecated' so they never
  // surface publicly by accident — matter.open requires an ACTIVE definition.
  await submitAction(ctx, {
    actionKindName: 'legal.service.set_active',
    intentKind: 'enforcement',
    payload: { service_key: serviceKey, active: true },
  })
  return serviceKey
}

async function openMatter(serviceKey: string): Promise<{ matterEntityId: string }> {
  const matterEntityId = randomUUID()
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
      intake_responses: RESPONSES,
    },
  })
  const eff = intake.effects[0] as { clientEntityId?: string; questionnaireEntityId?: string }
  await submitAction(ctx, {
    actionKindName: 'matter.open',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterEntityId,
      matter_number: `M-${matterEntityId.slice(0, 8).toUpperCase()}`,
      service_key: serviceKey,
      workflow_route: 'manual',
      attribution_source: 'attorney_manual',
      client_entity_id: eff.clientEntityId,
      questionnaire_entity_id: eff.questionnaireEntityId,
      intake_action_id: intake.actionId,
      client_display_name: 'Harold James Fenwick',
    },
  })
  return { matterEntityId }
}

interface InstanceRow {
  id: string
  workflow_definition_id: string
  current_state: string
  status: string
  state_history: Array<Record<string, unknown>>
}
async function instances(matterEntityId: string): Promise<InstanceRow[]> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<InstanceRow>(
      `SELECT id, workflow_definition_id, current_state, status, state_history
         FROM workflow_instance WHERE tenant_id=$1 AND subject_entity_id=$2
        ORDER BY started_at DESC`,
      [SANDBOX, matterEntityId],
    )
    return r.rows
  })
}

async function eventCount(matterEntityId: string, kind: string): Promise<number> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM event e
         JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
        WHERE e.tenant_id=$1 AND e.primary_entity_id=$2 AND ekd.kind_name=$3`,
      [SANDBOX, matterEntityId, kind],
    )
    return Number(r.rows[0]?.n ?? '0')
  })
}

async function draftJobs(matterEntityId: string): Promise<Array<Record<string, unknown>>> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM worker_job
        WHERE tenant_id=$1 AND job_kind='legal.draft.run'
          AND payload->>'matter_entity_id'=$2`,
      [SANDBOX, matterEntityId],
    )
    return r.rows.map((x) => x.payload)
  })
}

// ── the run ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tag = randomUUID().slice(0, 6)

  // A — settle past the non-blocking consultation.
  const svcA = await makeService(`WF-FIX A (Pacheco shape) ${tag}`, pachecoShape())
  const a = await openMatter(svcA)
  const aInst = (await instances(a.matterEntityId))[0]
  check('A: settled past the non-blocking consultation', aInst?.current_state === 'client_intake')
  check(
    'A: pass_through hop recorded in state_history',
    aInst?.state_history.some((h) => h.pass_through === true && h.state === 'client_intake'),
  )

  // B — intake.completed carries the matter to review in ONE action.
  const svcB = await makeService(`WF-FIX B (corrected shape) ${tag}`, correctedShape())
  const b = await openMatter(svcB)
  const bInst = (await instances(b.matterEntityId))[0]
  check(
    'B: matter.open landed the matter at review in one action',
    bInst?.current_state === 'review_send_oa',
  )
  check(
    'B: intake.completed event recorded',
    (await eventCount(b.matterEntityId, 'intake.completed')) >= 1,
  )

  // C — the doc-annotated review step enqueued drafting; drive the worker inline.
  const jobs = await draftJobs(b.matterEntityId)
  check(
    'C: legal.draft.run enqueued for the annotated review stage',
    jobs.some((j) => j.producing_autorun === true && j.document_kind === 'operating_agreement'),
  )
  const { generateDocumentForMatter } = await import('../src/api/generateDocumentRuntime.js')
  const run1 = await generateDocumentForMatter(ctx, b.matterEntityId)
  check('C: worker drafted the operating agreement', run1.ran === true, run1.summary)
  const bAfter = (await instances(b.matterEntityId))[0]
  check(
    'C: matter stays parked at review with the draft',
    bAfter?.current_state === 'review_send_oa',
  )
  const run2 = await generateDocumentForMatter(ctx, b.matterEntityId)
  check('C: second run no-ops (draft-exists idempotency)', run2.ran === false, run2.summary)

  // D — repin the A matter to v2.
  const v2 = pachecoShape()
  v2[1]!.advances_to = [{ to: 'review_send_oa', gate: 'system', on: 'intake.completed' }]
  await setServiceLifecycleAI(ctx, svcA, v2, { conclusion: 'v2', confidence: 0.9 })
  const repin = await submitAction(ctx, {
    actionKindName: 'legal.matter.repin_workflow',
    intentKind: 'correction',
    payload: { matter_entity_id: a.matterEntityId },
  })
  const repinEff = repin.effects[0] as Record<string, unknown>
  const aAll = await instances(a.matterEntityId)
  check('D: repin created a successor instance', repinEff.repinned === true && aAll.length >= 2)
  check(
    'D: old instance closed out as cancelled',
    aAll.some((i) => i.id === repinEff.supersededInstanceId && i.status === 'cancelled'),
  )
  check(
    'D: successor bound to a different definition',
    aAll[0]!.workflow_definition_id !==
      (aAll.find((i) => i.status === 'cancelled')?.workflow_definition_id ?? ''),
  )
  check(
    'D: workflow.repinned recorded',
    (await eventCount(a.matterEntityId, 'workflow.repinned')) >= 1,
  )
  const noop = await submitAction(ctx, {
    actionKindName: 'legal.matter.repin_workflow',
    intentKind: 'correction',
    payload: { matter_entity_id: a.matterEntityId },
  })
  check(
    'D: already-latest is a no-op',
    (noop.effects[0] as Record<string, unknown>).repinned === false,
  )
  const v3 = correctedShape().map((s) => ({ ...s, key: `${s.key}_v3` }))
  v3.forEach((s) => {
    s.advances_to = s.advances_to.map((e) => ({ ...e, to: `${e.to}_v3` }))
  })
  ;(v3[0] as { entry?: boolean }).entry = true
  await setServiceLifecycleAI(ctx, svcA, v3 as Lifecycle, { conclusion: 'v3', confidence: 0.9 })
  let renamedErr = ''
  try {
    await submitAction(ctx, {
      actionKindName: 'legal.matter.repin_workflow',
      intentKind: 'correction',
      payload: { matter_entity_id: a.matterEntityId },
    })
  } catch (e) {
    renamedErr = e instanceof Error ? e.message : String(e)
  }
  check(
    'D: renamed stages refuse without target_state and list the valid keys',
    renamedErr.includes('target_state') && renamedErr.includes('client_intake_v3'),
    renamedErr.slice(0, 140),
  )

  // E — retro-unstick: matter A (still on v2, parked at the blocking client_intake)
  // gets a per-matter override marking client_intake NON-blocking (view_intake is
  // not a producing kind, so settle may pass it). Dispatching an event that matches
  // NO edge must still settle-first the matter forward to the blocking review stage.
  const retroGraph = pachecoShape().map((s) =>
    s.key === 'client_intake' ? { ...s, blocking: false } : s,
  )
  await submitAction(ctx, {
    actionKindName: 'legal.matter.set_workflow',
    intentKind: 'adjustment',
    payload: { matter_entity_id: a.matterEntityId, states: retroGraph },
  })
  const probe = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'automatic_sync',
    payload: {
      event_kind_name: 'observation',
      primary_entity_id: a.matterEntityId,
      data: { kind: 'wffix_retro_probe' },
      source_type: 'system',
    },
  })
  const { dispatchLifecycleEvent } = await import('../src/lifecycle/executor.js')
  await withActionContext(ctx, async (client) => {
    // A real action wraps every dispatch in production; the probe action above
    // stands in for the retro drive.
    await dispatchLifecycleEvent(
      client,
      ctx,
      a.matterEntityId,
      'wffix.no_such_edge',
      probe.actionId,
    )
  })
  const aRetro = (await instances(a.matterEntityId))[0]
  check(
    'E: settle-first drained the overridden non-blocking stage on an unrelated event',
    aRetro?.current_state === 'review_send_oa',
    `now at ${aRetro?.current_state}`,
  )

  console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
