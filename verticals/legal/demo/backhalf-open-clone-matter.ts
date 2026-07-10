// BACKHALF-BLOCKS-1 — open one more matter on the receipt clone and wait for the
// deployed worker to draft v1, leaving it parked at review_send_will for the
// Contract W POSITIVE curl receipts (approve / regenerate / skip / complete).
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { randomUUID } from 'node:crypto'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
const SERVICE = 'nc_will_drafting_copy'

const RESPONSES: Record<string, unknown> = {
  testator_name: 'Dora Mae Ellison',
  testator_county: 'Orange',
  testator_address: '12 Quail Hollow Rd, Chapel Hill, NC 27514',
  marital_status: 'single',
  spouse_name: 'n/a',
  children_names: 'None',
  specific_bequests: 'My book collection to the Chapel Hill Public Library.',
  residuary_disposition: 'To my sister, Norma Ellison-Pryce.',
  executor_name: 'Norma Ellison-Pryce',
  successor_executor_name: 'n/a',
  guardian_name: 'n/a',
  execution_date: 'to be executed',
}

async function currentState(matterId: string): Promise<string> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ current_state: string }>(
      `SELECT current_state FROM workflow_instance WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
      [TENANT, matterId],
    )
    return r.rows[0]?.current_state ?? '(none)'
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const matterId = randomUUID()
  const matterNumber = `M-${matterId.slice(0, 8).toUpperCase()}`
  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: 'Dora Mae Ellison',
      client_email: 'dora.ellison@example.com',
      client_phone: null,
      client_company_name: null,
      service_key: SERVICE,
      intake_form_id: null,
      intake_responses: RESPONSES,
    },
  })
  const eff = intake.effects[0] as { clientEntityId?: string; questionnaireEntityId?: string }
  await submitAction(ctx, {
    actionKindName: 'matter.open',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterId,
      matter_number: matterNumber,
      service_key: SERVICE,
      workflow_route: 'manual',
      attribution_source: 'attorney_manual',
      client_entity_id: eff.clientEntityId,
      questionnaire_entity_id: eff.questionnaireEntityId,
      intake_action_id: intake.actionId,
      client_display_name: 'Dora Mae Ellison',
    },
  })
  await submitAction(ctx, {
    actionKindName: 'document.upload',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterId,
      object_key: `backhalf/${SERVICE}/intake-${matterId.slice(0, 8)}.txt`,
      original_filename: 'intake-note.txt',
      content_type: 'text/plain',
      size_bytes: 64,
      sha256_hex: 'ef'.repeat(32),
      document_kind: 'client_intake_note',
      document_source: 'client_uploaded',
      client_contact_id: eff.clientEntityId,
    },
  })
  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    const s = await currentState(matterId)
    if (s === 'review_send_will') break
    await new Promise((r) => setTimeout(r, 5000))
  }
  const version = await withActionContext(ctx, async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT dv.id FROM document_version dv
        JOIN relationship rel ON rel.source_entity_id=dv.document_entity_id
        JOIN relationship_kind_definition rkd ON rkd.id=rel.relationship_kind_id AND rkd.kind_name='draft_of'
       WHERE dv.tenant_id=$1 AND rel.target_entity_id=$2 ORDER BY dv.version_number DESC LIMIT 1`,
      [TENANT, matterId],
    )
    return r.rows[0]?.id ?? '(none)'
  })
  console.log(`MATTER_ID=${matterId}`)
  console.log(`MATTER_NUMBER=${matterNumber}`)
  console.log(`STATE=${await currentState(matterId)}`)
  console.log(`VERSION_ID=${version}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
