// BACKHALF-BLOCKS-1 acceptance #1 — approve ACCRUES. Declares the demo service's
// per-document fee (its billing declaration), approves M-2C17EBD6's pending OA as
// the attorney, approves it AGAIN (idempotency), and prints the SQL receipts:
// draft.approve action + document_fee.recorded event recorded together, exactly one
// fee after two approves.
// Run with prod DATABASE_URL: tsx --env-file=<main>/.env.local this-file.
import { updateServiceMetadata, getService, approveDraft } from '@exsto/legal'
import { withActionContext, type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // Joe Pacheco (human)
const SERVICE_KEY = 'capunify_reuse_demo_operating_agreement'
const DOC_KIND = 'operating_agreement'
const FEE = '200.00'
const VERSION_ID = '7fe86ee3-9a69-43e3-90e3-b911f6eed7f3' // M-2C17EBD6 pending OA
const MATTER_ID = '2c17ebd6-443d-47c6-b4cc-def8b3c63c13'

async function feeEvents(ctx: ActionContext): Promise<unknown[]> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query(
      `SELECT e.id, ekd.kind_name, e.payload->>'document_kind' AS kind,
              e.payload->>'amount' AS amount, e.recorded_at
         FROM event e JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
        WHERE e.tenant_id = $1 AND e.primary_entity_id = $2
          AND ekd.kind_name IN ('document_fee.recorded')
        ORDER BY e.recorded_at`,
      [ctx.tenantId, MATTER_ID],
    )
    return r.rows
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

  // Billing declaration for the demo service (WP2): the OA accrues $200 on approve.
  const svc = await getService(ctx, SERVICE_KEY)
  if (!svc) throw new Error(`Service not found: ${SERVICE_KEY}`)
  if (!svc.documentFees[DOC_KIND]) {
    await updateServiceMetadata(ctx, {
      serviceKey: SERVICE_KEY,
      displayName: svc.displayName,
      documentFees: { ...svc.documentFees, [DOC_KIND]: FEE },
    })
    console.log(`✓ ${SERVICE_KEY} declares document_fees.${DOC_KIND} = ${FEE}`)
  }

  console.log('fees BEFORE approve:', JSON.stringify(await feeEvents(ctx)))

  // Approve (the WP1 path: reviewDecision + accrueDocumentFeeOnApproval).
  const first = await approveDraft(ctx, { documentVersionId: VERSION_ID })
  console.log('✓ draft.approve #1:', JSON.stringify(first.effects[0]))
  console.log('fees AFTER approve #1:', JSON.stringify(await feeEvents(ctx)))

  // Idempotency: a second approve must add NO second fee.
  const second = await approveDraft(ctx, { documentVersionId: VERSION_ID })
  console.log('✓ draft.approve #2 (idempotency):', JSON.stringify(second.effects[0]))
  console.log('fees AFTER approve #2:', JSON.stringify(await feeEvents(ctx)))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
