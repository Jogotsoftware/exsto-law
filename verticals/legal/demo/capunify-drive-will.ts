// CAPABILITY-UNIFY-1 — ACCEPTANCE #2 (PROD, tenant zero). Drive a FRESH will matter
// end-to-end and prove the ai_draft leg runs OFF the request on the deployed worker:
//   intake.submit → matter.open (binds the re-authored nc_will_drafting graph) →
//   client document.upload advances client_intake → generate_will (invoke_capability
//   {document_generation}) → the producing autorun ENQUEUES a legal.capability.run
//   worker job → the DEPLOYED worker claims it → document_generation drafts the will
//   via runDraftGeneration (ai_draft) → draft.completed → automatic edge advances the
//   matter to review_send_will, where it WAITS.
//
// This process only ENQUEUES (the fast INSERT); the model call happens on the worker.
// Requires the merge to be DEPLOYED first (the worker must know legal.capability.run).
//   node --import tsx --env-file=.env.local verticals/legal/demo/capunify-drive-will.ts
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { randomUUID } from 'node:crypto'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004'
const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }
const SERVICE = 'nc_will_drafting'

const WILL_RESPONSES: Record<string, unknown> = {
  testator_name: 'Margaret Eleanor Whitfield',
  testator_county: 'Wake',
  testator_address: '412 Dogwood Lane, Raleigh, NC 27601',
  marital_status: 'widowed',
  spouse_name: 'n/a',
  children_names: 'Thomas Whitfield (adult); Sarah Whitfield-Doyle (adult)',
  specific_bequests: 'My grandmother’s pearl necklace to my daughter Sarah Whitfield-Doyle.',
  residuary_disposition: 'To my two children, Thomas and Sarah, in equal shares.',
  executor_name: 'Thomas Whitfield',
  successor_executor_name: 'Sarah Whitfield-Doyle',
  guardian_name: 'n/a (no minor children)',
  execution_date: 'to be executed',
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

async function jobStatus(matterEntityId: string): Promise<{ id: string; status: string }[]> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM worker_job
        WHERE tenant_id=$1 AND job_kind='legal.capability.run'
          AND payload->>'matter_entity_id'=$2 ORDER BY created_at DESC`,
      [TENANT, matterEntityId],
    )
    return r.rows
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const matterEntityId = randomUUID()
  const matterNumber = `M-${matterEntityId.slice(0, 8).toUpperCase()}`

  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: 'Margaret Eleanor Whitfield',
      client_email: 'margaret.whitfield@example.com',
      client_phone: null,
      client_company_name: null,
      service_key: SERVICE,
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
      service_key: SERVICE,
      workflow_route: 'manual',
      attribution_source: 'attorney_manual',
      client_entity_id: eff.clientEntityId,
      questionnaire_entity_id: eff.questionnaireEntityId,
      intake_action_id: intake.actionId,
      client_display_name: 'Margaret Eleanor Whitfield',
    },
  })
  console.log(
    `opened will matter ${matterNumber} (${matterEntityId}); state=${await currentState(matterEntityId)}`,
  )

  // Client uploads a document → advances client_intake → generate_will, whose entry
  // schedules the producing autorun that enqueues the legal.capability.run job.
  await submitAction(ctx, {
    actionKindName: 'document.upload',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterEntityId,
      object_key: `capunify/will/intake-${matterEntityId.slice(0, 8)}.txt`,
      original_filename: 'intake-note.txt',
      content_type: 'text/plain',
      size_bytes: 64,
      sha256_hex: 'ab'.repeat(32),
      document_kind: 'client_intake_note',
      document_source: 'client_uploaded',
      client_contact_id: eff.clientEntityId,
    },
  })
  console.log(`client uploaded; state=${await currentState(matterEntityId)}`)

  // Poll for the DEPLOYED worker to claim + run the enqueued legal.capability.run job.
  const deadline = Date.now() + 4 * 60 * 1000
  let last = ''
  while (Date.now() < deadline) {
    const jobs = await jobStatus(matterEntityId)
    const state = await currentState(matterEntityId)
    const line = `state=${state} jobs=${jobs.map((j) => j.status).join(',') || '(none yet)'}`
    if (line !== last) console.log(`[poll] ${line}`)
    last = line
    if (jobs.some((j) => j.status === 'succeeded') && state === 'review_send_will') break
    if (jobs.some((j) => j.status === 'dead_letter')) {
      console.error('job dead-lettered — see worker_job.last_error')
      break
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  console.log(`\nMATTER: ${matterNumber}\nMATTER_ENTITY_ID: ${matterEntityId}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
