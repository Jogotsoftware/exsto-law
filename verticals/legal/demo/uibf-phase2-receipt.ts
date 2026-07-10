// UI-BUILDER-FIX-1 Phase 2 receipt — LIVE prod exercise of the client-copy write
// path: createServiceAI populates both client fields; an over-70 client_description
// is capped SERVER-SIDE by the upsert handler (truncate-and-flag); carry-forward
// holds across a metadata revision; then the throwaway service is retired (sealed,
// append-only). Run from the uibf worktree with prod DATABASE_URL.
import { createServiceAI, updateServiceMetadata, getService, retireService } from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx = { tenantId: TENANT, actorId: ATTORNEY }

const LONG_DESC =
  'A complete trademark registration package covering search, filing, and every office action response you might ever need'

async function main() {
  // 1. Propose→approve equivalent: the SAME write the approve route makes.
  const res = await createServiceAI(
    ctx,
    {
      displayName: 'UIBF Phase2 Receipt Service',
      description: 'Attorney-facing: NC trademark registration, USPTO filing workflow.',
      clientDisplayName: 'Trademark Registration',
      clientDescription: LONG_DESC, // 118 chars — must come back capped at <=70
      route: 'manual',
      generationMode: 'template_merge',
      appointmentRequired: false,
    },
    { conclusion: 'UI-BUILDER-FIX-1 Phase 2 live receipt.', confidence: 0.9 },
  )
  console.log('created:', res)

  const v1 = await getService(ctx, res.serviceKey)
  console.log('v1 clientDisplayName:', JSON.stringify(v1!.clientDisplayName))
  console.log('v1 clientDescription:', JSON.stringify(v1!.clientDescription))
  console.log('v1 clientDescription length:', v1!.clientDescription!.length)

  // 2. Carry-forward: a metadata revision that never mentions the client fields.
  const v2 = await updateServiceMetadata(ctx, {
    serviceKey: res.serviceKey,
    displayName: 'UIBF Phase2 Receipt Service (renamed)',
  })
  console.log('v2 carry-forward clientDisplayName:', JSON.stringify(v2.clientDisplayName))
  console.log('v2 carry-forward clientDescription:', JSON.stringify(v2.clientDescription))

  // 3. Clean up: seal the throwaway (append-only retire, no hard delete).
  await retireService(ctx, res.serviceKey)
  console.log('retired:', res.serviceKey)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => closeDbPool())
