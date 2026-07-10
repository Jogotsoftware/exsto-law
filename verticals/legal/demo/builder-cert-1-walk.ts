// BUILDER-CERT-1 (WP4) — walk ONE real matter through the wizard-composed
// "NC Residential Lease Review" service in production, block by block, with each
// advance flowing through the same core actions the app fires. One subcommand per
// attorney/client act so the operator inspects state between blocks; producing
// stages run via autorun → the worker queue, exactly as deployed.
//
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/builder-cert-1-walk.ts <cmd> …
//     book                             # client books (intake-only, no lease attached)
//     status  <matterId>               # workflow state + jobs + drafts + envelopes + invoices
//     advance <matterId> <toState>     # attorney Continue (legal.matter.advance)
//     approve <matterId>               # attorney approves + sends the latest pending draft
//     sign    <matterId>               # client signs the open envelope (portal path)
//     upload  <matterId> <contactId> <objectKey> <sha256> <bytes>  # client delivers the lease
//     invoice <matterId> <clientId>    # attorney: accrue $450 service fee + issue + send
//     pay     <matterId>               # payment recorded via the manual path (invoice.pay)
//     complete <matterId>              # attorney completes + archives the matter
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import {
  submitBooking,
  approveDocument,
  recordSignatureForClient,
  addMatterFee,
  issueInvoice,
  sendInvoice,
  payInvoice,
  completeMatter,
  listMatterDraftVersions,
} from '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // seeded Joe Pacheco (human)
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005' // public booking actor
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
const publicCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }

const SERVICE_KEY = 'nc_residential_lease_review'

async function q<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  return withActionContext(attorneyCtx, async (client) => {
    const res = await client.query<T>(sql, params)
    return res.rows
  })
}

async function book(): Promise<void> {
  const res = await submitBooking(publicCtx, {
    clientFullName: 'Dana Whitfield',
    clientEmail: 'pachecojoseph824+leasecert@gmail.com',
    clientPhone: '9195550117',
    attributionSource: 'public_booking',
    serviceKey: SERVICE_KEY,
    intakeResponses: {
      client_name: 'Dana Whitfield',
      client_address: '412 Bellamy Court, Apt 2B, Durham, NC 27701',
      client_role: 'Renter (tenant)',
      property_address: '1847 Umstead Hollow Lane, Durham, NC 27713',
      client_concern:
        'The landlord wants two months of deposit plus a $95 late fee, and there is a clause saying I owe rent for the whole year if I leave early. I want to know what is enforceable before I sign.',
      // lease_upload deliberately omitted: the lease is delivered mid-matter at the
      // request_lease step (the composed request_client_materials block).
    },
  })
  console.log(JSON.stringify(res.effects, null, 2))
}

async function status(matterId: string): Promise<void> {
  const wf = await q(
    `SELECT current_state, state_history FROM workflow_instance
      WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
    [TENANT, matterId],
  )
  console.log('workflow:', JSON.stringify(wf, null, 2))
  const jobs = await q(
    `SELECT job_kind, status, attempts, left(coalesce(last_error,''),160) AS err, updated_at
       FROM worker_job WHERE tenant_id=$1 AND payload->>'matter_entity_id'=$2
      ORDER BY created_at DESC LIMIT 6`,
    [TENANT, matterId],
  )
  console.log('jobs:', JSON.stringify(jobs, null, 2))
  const drafts = await listMatterDraftVersions(attorneyCtx, matterId)
  console.log(
    'drafts:',
    JSON.stringify(
      drafts.map((d) => ({
        versionId: d.documentVersionId,
        kind: d.documentKind,
        status: d.status,
        v: d.versionNumber,
      })),
      null,
      2,
    ),
  )
  // Envelopes reach the matter via envelope_of → document → draft_of → matter.
  const env = await q(
    `SELECT eo.source_entity_id AS envelope_id,
        (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id=a.attribute_kind_id
          WHERE a.entity_id=eo.source_entity_id AND akd.kind_name='envelope_status' ORDER BY a.valid_from DESC LIMIT 1) AS status
       FROM relationship eo
       JOIN relationship_kind_definition eok ON eok.id=eo.relationship_kind_id AND eok.kind_name='envelope_of'
       JOIN relationship df ON df.source_entity_id=eo.target_entity_id AND df.tenant_id=eo.tenant_id
       JOIN relationship_kind_definition dfk ON dfk.id=df.relationship_kind_id AND dfk.kind_name='draft_of'
      WHERE eo.tenant_id=$1 AND df.target_entity_id=$2`,
    [TENANT, matterId],
  )
  console.log('envelopes:', JSON.stringify(env, null, 2))
}

async function advance(matterId: string, toState: string): Promise<void> {
  const res = await submitAction(attorneyCtx, {
    actionKindName: 'legal.matter.advance',
    intentKind: 'adjustment',
    payload: { matter_entity_id: matterId, to_state: toState, gate: 'attorney' },
  })
  console.log(JSON.stringify(res.effects, null, 2))
}

async function approveLatest(matterId: string): Promise<void> {
  const drafts = await listMatterDraftVersions(attorneyCtx, matterId)
  const pending = drafts.find((d) => d.status === 'pending_review')
  if (!pending) throw new Error('no pending_review draft on this matter')
  const r = await approveDocument(attorneyCtx, {
    documentVersionId: pending.documentVersionId,
    send: true,
  })
  console.log(
    `approved+sent ${pending.documentKind} (${pending.documentVersionId}):`,
    JSON.stringify(r),
  )
}

async function sign(matterId: string): Promise<void> {
  // A sign request reaches its matter via request_of → envelope, then
  // envelope_of → document, then draft_of → matter (the same chain
  // assertClientOwnsRequest walks).
  const reqs = await q<{ request_id: string; email: string | null }>(
    `SELECT r.id AS request_id,
        (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id=a.attribute_kind_id
          WHERE a.entity_id=r.id AND akd.kind_name='signer_email' ORDER BY a.valid_from DESC LIMIT 1) AS email
       FROM entity r
       JOIN entity_kind_definition rk ON rk.id=r.entity_kind_id
        AND rk.kind_name = 'signature_request'
       JOIN relationship ro ON ro.source_entity_id=r.id AND ro.tenant_id=r.tenant_id
       JOIN relationship_kind_definition rok ON rok.id=ro.relationship_kind_id AND rok.kind_name='request_of'
       JOIN relationship eo ON eo.source_entity_id=ro.target_entity_id AND eo.tenant_id=r.tenant_id
       JOIN relationship_kind_definition eok ON eok.id=eo.relationship_kind_id AND eok.kind_name='envelope_of'
       JOIN relationship df ON df.source_entity_id=eo.target_entity_id AND df.tenant_id=r.tenant_id
       JOIN relationship_kind_definition dfk ON dfk.id=df.relationship_kind_id AND dfk.kind_name='draft_of'
      WHERE r.tenant_id=$1 AND r.status='active' AND df.target_entity_id=$2`,
    [TENANT, matterId],
  )
  if (!reqs.length) throw new Error('no sign request found for this matter')
  const req = reqs[0]!
  const email = req.email ?? 'pachecojoseph824+leasecert@gmail.com'
  const r = await recordSignatureForClient(
    { tenantId: TENANT, clientContactId: '', email, matterIds: [matterId] },
    {
      requestId: req.request_id,
      signatureName: 'Dana Whitfield',
      consent: 'I agree to sign this document electronically.',
    },
  )
  console.log('signed:', JSON.stringify(r))
}

async function upload(
  matterId: string,
  contactId: string,
  objectKey: string,
  sha256: string,
  bytes: string,
): Promise<void> {
  const res = await submitAction(publicCtx, {
    actionKindName: 'document.upload',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterId,
      object_key: objectKey,
      original_filename: objectKey.split('/').pop(),
      content_type: 'text/plain',
      size_bytes: Number(bytes),
      sha256_hex: sha256,
      document_kind: 'client_lease',
      document_source: 'client_uploaded',
      client_contact_id: contactId,
    },
  })
  console.log(JSON.stringify(res.effects, null, 2))
}

async function invoice(matterId: string, clientId: string): Promise<void> {
  const fee = await addMatterFee(attorneyCtx, {
    matterEntityId: matterId,
    feeType: 'service',
    amount: '450.00',
    description: 'Residential lease review — flat fee',
  })
  const inv = await issueInvoice(attorneyCtx, {
    clientEntityId: clientId,
    matterEntityId: matterId,
    lines: [{ sourceEventId: fee.eventId, kind: 'service_fee' }],
  })
  console.log('issued:', JSON.stringify(inv))
  const sent = await sendInvoice(attorneyCtx, { invoiceEntityId: inv.invoiceEntityId })
  console.log('sent:', JSON.stringify(sent))
}

async function pay(invoiceEntityId: string): Promise<void> {
  const r = await payInvoice(attorneyCtx, {
    invoiceEntityId,
    method: 'manual',
    reference: 'Zelle — builder-cert-1 walk',
  })
  console.log('paid:', JSON.stringify(r))
}

async function complete(matterId: string): Promise<void> {
  const r = await completeMatter(attorneyCtx, matterId, { archive: true })
  console.log('completed:', JSON.stringify(r))
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'book') await book()
  else if (cmd === 'status') await status(rest[0]!)
  else if (cmd === 'advance') await advance(rest[0]!, rest[1]!)
  else if (cmd === 'approve') await approveLatest(rest[0]!)
  else if (cmd === 'sign') await sign(rest[0]!)
  else if (cmd === 'upload') await upload(rest[0]!, rest[1]!, rest[2]!, rest[3]!, rest[4]!)
  else if (cmd === 'invoice') await invoice(rest[0]!, rest[1]!)
  else if (cmd === 'pay') await pay(rest[0]!)
  else if (cmd === 'complete') await complete(rest[0]!)
  else throw new Error(`unknown command: ${cmd}`)
}

main().catch((e) => {
  console.error('WALK FAILED:', e instanceof Error ? e.stack : String(e))
  process.exit(1)
})
