// BUILDER-CERT-1 (WP2.5) — library-pollution sweep: deprecate every echo-fixture
// capability (`demo_echo_note_*` from pre-cert runs, `echo_note_probe_*` from current
// runs) still offered as `available` in a tenant's capability library. These are
// acceptance-run residue, not real blocks; sitting `available` they are offered to
// the service-builder as composable steps. All writes go through core
// (legal.capability.upsert) — status flips to `deprecated`, entities stay (append-only).
//
//   node --import tsx --env-file=<main-worktree>/.env.local \
//     verticals/legal/demo/deprecate-echo-fixtures.ts [tenantId]
//
// Defaults to the sandbox tenant (where the residue lives); accepts tenant-zero as
// the one other known tenant. Only fixture-prefixed slugs are ever touched.
import '@exsto/legal'
import { listCapabilities, upsertCapability } from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

const SANDBOX = '00000000-0000-0000-00fe-000000000001'
const SANDBOX_ACTOR = '00000000-0000-0000-00fe-000000000002'
const TENANT_ZERO = '00000000-0000-0000-0000-000000000001'
const TENANT_ZERO_AGENT = '00000000-0000-0000-0001-000000000004'

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const tenantId = process.argv[2] ?? SANDBOX
  // Known tenants only: each write must carry an actor that belongs to its tenant
  // (review finding: an arbitrary tenant would have been swept with the SANDBOX
  // actor as the source — wrong-tenant provenance).
  if (tenantId !== SANDBOX && tenantId !== TENANT_ZERO) {
    throw new Error(
      `Unknown tenant ${tenantId} — this sweep knows actors only for the sandbox and tenant-zero.`,
    )
  }
  const actorId = tenantId === TENANT_ZERO ? TENANT_ZERO_AGENT : SANDBOX_ACTOR
  const ctx: ActionContext = { tenantId, actorId }

  const fixtures = (await listCapabilities(ctx)).filter(
    (c) => c.slug.startsWith('demo_echo_note_') || c.slug.startsWith('echo_note_probe_'),
  )
  const toDeprecate = fixtures.filter((c) => c.status !== 'deprecated')
  console.log(
    `tenant ${tenantId}: ${fixtures.length} fixture capabilities, ${toDeprecate.length} to deprecate`,
  )
  for (const cap of toDeprecate) {
    await upsertCapability(ctx, { slug: cap.slug, status: 'deprecated', spec: cap.spec })
    console.log(`deprecated: ${cap.slug}`)
  }
  console.log('Done.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
