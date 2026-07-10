import { getService, getServiceLifecycle, validateProposedLifecycle } from '@exsto/legal'
import type { Lifecycle } from '@exsto/legal'

const ctx = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000004',
}

async function main(): Promise<void> {
  for (const key of ['nc_smllc_formation', 'nc_llc_formation', 'document_review']) {
    const s = await getService(ctx, key).catch(() => null)
    if (s) console.log(key, 'documentFees:', JSON.stringify(s.documentFees))
  }
  const lc = await getServiceLifecycle(ctx, 'nc_will_drafting')
  if (!lc) throw new Error('no lifecycle')
  // Billing-rejection receipt: the will graph (document-producing, no invoice step)
  // validated against a service that declares NO document_fees.
  const noFeeKey = 'nc_smllc_formation'
  const res = await validateProposedLifecycle(ctx, lc.graph as Lifecycle, noFeeKey)
  console.log(`validate(will graph, ${noFeeKey}): ok=${res.ok}`)
  for (const e of res.errors) console.log('  REJECT:', e)
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
