// PORTAL-1 — receipts driver (run with tsx --env-file=<main>/.env.local).
// Each step is one arg so the walk can interleave with HTTP-driven steps:
//   add-fee <matterId>                 attorney records the lease-review fee
//   anon-booking <slug> <startIso> <endIso>   standalone public booking (Public Intake actor)
//   pay-token <invoiceNumber>          mint the invoice pay magic link token
//   draft-token <documentVersionId>    mint a /d share token
//   send-email <matterId> <to>         Contract B markdown send (WP6 render receipt)
//   approve-latest-comm                approve the newest pending communication draft (approve = send)
import { submitAction, type ActionContext } from '@exsto/substrate'
import '../src/handlers/index.js'
import {
  submitPublicBooking,
  signInvoicePayToken,
  signDraftLinkToken,
  enqueueClientEmail,
  approveDraft,
  issueInvoice,
  sendInvoice,
  payInvoice,
  inviteClientToPortal,
} from '../src/index.js'
import { withSuperuser } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // Juan Carlos (human)
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

const [cmd, ...args] = process.argv.slice(2)

async function main(): Promise<void> {
  if (cmd === 'add-fee') {
    const res = await submitAction(ctx, {
      actionKindName: 'legal.matter.add_fee',
      intentKind: 'enforcement',
      payload: {
        matter_entity_id: args[0],
        fee_type: 'document',
        amount: '450.00',
        description: 'Residential lease review — fixed fee',
        document_kind: 'lease_review',
      },
    })
    console.log(JSON.stringify(res.effects))
  } else if (cmd === 'issue-invoice') {
    // issue-invoice <clientParentId> <matterId> <sourceEventId>
    const res = await issueInvoice(ctx, {
      clientEntityId: args[0]!,
      matterEntityId: args[1]!,
      lines: [{ sourceEventId: args[2]!, kind: 'document_fee' }],
    })
    console.log(JSON.stringify(res))
  } else if (cmd === 'send-invoice') {
    // send-invoice <invoiceEntityId> — mints the pay MAGIC LINK into the email
    const res = await sendInvoice(ctx, {
      invoiceEntityId: args[0]!,
      payUrlBase: process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3111',
    })
    console.log(JSON.stringify(res))
  } else if (cmd === 'pay-invoice') {
    const res = await payInvoice(ctx, {
      invoiceEntityId: args[0]!,
      method: 'manual',
      reference: args[1] ?? null,
    })
    console.log(JSON.stringify(res))
  } else if (cmd === 'invite') {
    // invite <contactEntityId> — the attorney's "Invite to portal" (same handler
    // the send_portal_invite capability wraps)
    console.log(JSON.stringify(await inviteClientToPortal(ctx, args[0]!)))
  } else if (cmd === 'anon-booking') {
    const res = await submitPublicBooking({
      slug: args[0]!,
      clientName: 'Avery Whitfield',
      clientEmail: 'pachecojoseph824+portal1anon@gmail.com',
      reason: 'General consultation',
      startIso: args[1]!,
      endIso: args[2]!,
    })
    console.log(JSON.stringify(res))
  } else if (cmd === 'pay-token') {
    console.log(signInvoicePayToken({ invoiceNumber: args[0]!, tenantId: TENANT }))
  } else if (cmd === 'draft-token') {
    console.log(signDraftLinkToken({ documentVersionId: args[0]!, tenantId: TENANT }))
  } else if (cmd === 'send-email') {
    const res = await enqueueClientEmail(ctx, {
      to: args[1]!,
      subject: 'Your lease review — what happens next',
      body: [
        'Hi Riley,',
        '',
        'Thanks for sending your lease. Here is what happens next:',
        '',
        '- We review the **early-termination** and **pet** clauses first.',
        '- You will get a written summary with our recommendations.',
        '- Anything urgent, message us from your portal.',
        '',
        'You can follow progress any time in your client portal.',
        '',
        'Best,',
      ].join('\n'),
      matterId: args[0],
    })
    console.log(JSON.stringify({ messageId: res.messageId, from: res.from, to: res.to }))
  } else if (cmd === 'approve-latest-comm') {
    const versionId = await withSuperuser(async (client) => {
      const r = await client.query<{ id: string }>(
        `SELECT dv.id FROM document_version dv
         JOIN entity e ON e.id = dv.document_entity_id
         JOIN entity_kind_definition k ON k.id = e.entity_kind_id
         WHERE dv.tenant_id = $1 AND dv.status = 'pending_review'
           AND k.kind_name = 'communication_draft'
         ORDER BY dv.recorded_at DESC LIMIT 1`,
        [TENANT],
      )
      return r.rows[0]?.id ?? null
    })
    if (!versionId) throw new Error('no pending communication draft found')
    const res = await approveDraft(ctx, versionId)
    console.log(JSON.stringify({ versionId, ...res }))
  } else {
    throw new Error(`unknown cmd: ${cmd}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
