// CAPABILITY-UNIFY-1 — ACCEPTANCE #3 (PROD, tenant zero). REUSE PROOF: a SECOND
// service wires the SAME document_generation capability with a DIFFERENT
// template_entity_id (the firm Operating-Agreement template) and produces a document
// from THAT template in template_merge mode. Two services (nc_will_drafting +
// this one), one block, two documents.
//
// Creates a minimal demo service, authors a 3-step lifecycle whose drafting stage is
// invoke_capability{document_generation, <OA template id>, template_merge} (validated
// through setServiceLifecycleAI — the WP4 template_entity_id check runs here), then
// drives a matter: intake → upload advances into the drafting stage → the producing
// autorun enqueues legal.capability.run → the DEPLOYED worker renders the OA template
// deterministically (no model) → the document lands pending_review.
//   node --import tsx --env-file=.env.local verticals/legal/demo/capunify-reuse.ts
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import { listStandaloneTemplates, setServiceLifecycleAI, type Lifecycle } from '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { randomUUID } from 'node:crypto'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004'
const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }

const OA_TEMPLATE_NAME = 'NC Single-Member LLC — Operating Agreement'
const DEMO_DISPLAY_NAME = 'CAPUNIFY reuse demo (operating agreement)'

const OA_RESPONSES: Record<string, unknown> = {
  company_name: 'Whitfield Ventures LLC',
  member_name: 'Margaret Eleanor Whitfield',
  state: 'North Carolina',
  effective_date: '2026-07-09',
  principal_office_address: '412 Dogwood Lane, Raleigh, NC 27601',
}

function buildGraph(oaTemplateId: string): Lifecycle {
  return [
    {
      key: 'client_intake',
      label: 'Client intake',
      client_label: 'Your intake',
      entry: true,
      blocking: true,
      action: { kind: 'view_intake' },
      advances_to: [{ to: 'generate_oa', gate: 'client', via: 'document.upload' }],
    },
    {
      key: 'generate_oa',
      label: 'Draft the operating agreement',
      blocking: true,
      action: {
        kind: 'invoke_capability',
        config: {
          capability_slug: 'document_generation',
          capability_config: {
            template_entity_id: oaTemplateId,
            generation_mode: 'template_merge',
          },
        },
      },
      advances_to: [{ to: 'review_oa', gate: 'automatic', on: 'draft.completed' }],
    },
    {
      key: 'review_oa',
      label: 'Review & send the operating agreement',
      blocking: true,
      action: { kind: 'review_send_document' },
      advances_to: [{ to: 'complete', gate: 'attorney', via: 'draft.approve' }],
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
}

async function currentState(matterEntityId: string): Promise<string> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ current_state: string }>(
      `SELECT current_state FROM workflow_instance WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
      [TENANT, matterEntityId],
    )
    return r.rows[0]?.current_state ?? '(none)'
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')

  const oa = (await listStandaloneTemplates(ctx)).find((t) => t.name === OA_TEMPLATE_NAME)
  if (!oa) throw new Error(`OA template "${OA_TEMPLATE_NAME}" not found in the firm library.`)
  console.log(`reuse template (OA): ${oa.templateEntityId}`)

  // Create-or-reuse the demo service (idempotent by display-name → kind_name).
  const existing = await withActionContext(ctx, async (client) => {
    const r = await client.query<{ kind_name: string }>(
      `SELECT kind_name FROM workflow_definition WHERE tenant_id=$1 AND display_name=$2 AND valid_to IS NULL LIMIT 1`,
      [TENANT, DEMO_DISPLAY_NAME],
    )
    return r.rows[0]?.kind_name ?? null
  })
  let serviceKey: string
  if (existing) {
    serviceKey = existing
    console.log(`demo service exists: ${serviceKey}`)
  } else {
    const up = await submitAction(ctx, {
      actionKindName: 'legal.service.upsert',
      intentKind: 'exploration',
      payload: {
        display_name: DEMO_DISPLAY_NAME,
        description: 'CAPABILITY-UNIFY-1 reuse proof — document_generation with the OA template.',
        route: 'manual',
        documents: ['operating_agreement'],
      },
    })
    serviceKey = (up.effects[0] as { serviceKey: string }).serviceKey
    console.log(`demo service created: ${serviceKey}`)
  }

  // Author the lifecycle through the validated AI path (runs the WP4 template check).
  const authored = await setServiceLifecycleAI(ctx, serviceKey, buildGraph(oa.templateEntityId), {
    conclusion:
      'Reuse proof: a second service drafts the firm Operating-Agreement template via the shared document_generation capability (template_merge).',
    confidence: 0.9,
    modelIdentity: 'claude',
  })
  console.log(`lifecycle authored: ${serviceKey} v${authored.version}`)

  // Drive a matter through it.
  const matterEntityId = randomUUID()
  const matterNumber = `M-${matterEntityId.slice(0, 8).toUpperCase()}`
  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: 'Margaret Eleanor Whitfield',
      client_email: 'margaret.whitfield+oa@example.com',
      client_phone: null,
      client_company_name: 'Whitfield Ventures LLC',
      service_key: serviceKey,
      intake_form_id: null,
      intake_responses: OA_RESPONSES,
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
      client_display_name: 'Margaret Eleanor Whitfield',
    },
  })
  await submitAction(ctx, {
    actionKindName: 'document.upload',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterEntityId,
      object_key: `capunify/oa/intake-${matterEntityId.slice(0, 8)}.txt`,
      original_filename: 'intake-note.txt',
      content_type: 'text/plain',
      size_bytes: 64,
      sha256_hex: 'cd'.repeat(32),
      document_kind: 'client_intake_note',
      document_source: 'client_uploaded',
      client_contact_id: eff.clientEntityId,
    },
  })
  console.log(
    `opened OA matter ${matterNumber} (${matterEntityId}); state=${await currentState(matterEntityId)}`,
  )

  const deadline = Date.now() + 3 * 60 * 1000
  let last = ''
  while (Date.now() < deadline) {
    const state = await currentState(matterEntityId)
    const jobs = await withActionContext(ctx, async (client) => {
      const r = await client.query<{ status: string }>(
        `SELECT status FROM worker_job WHERE tenant_id=$1 AND job_kind='legal.capability.run' AND payload->>'matter_entity_id'=$2`,
        [TENANT, matterEntityId],
      )
      return r.rows.map((x) => x.status)
    })
    const line = `state=${state} jobs=${jobs.join(',') || '(none yet)'}`
    if (line !== last) console.log(`[poll] ${line}`)
    last = line
    if (jobs.includes('succeeded') && state === 'review_oa') break
    if (jobs.includes('dead_letter')) break
    await new Promise((r) => setTimeout(r, 5000))
  }
  console.log(
    `\nSERVICE: ${serviceKey}\nMATTER: ${matterNumber}\nMATTER_ENTITY_ID: ${matterEntityId}`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
