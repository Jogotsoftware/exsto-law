// ESIGN-BLOCK-1 (WP1) — one-shot activation seeder: define the `template_signature`
// attribute kind (on the `template` entity kind, json) through core kind.define.
// Schema-as-data, NO migration: the declaration a template carries is payload; this
// row is what lets a fresh environment carry it at all. Idempotent — an existing
// kind is reported and skipped (defineKind's validator rejects duplicates).
// Run with the target DATABASE_URL: tsx --env-file=<worktree>/.env.local this-file.
import { defineKind } from '../src/api/kindAuthoring.js'
import type { ActionContext } from '@exsto/substrate'

const TENANT = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004' // seeded Claude agent actor

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }
  try {
    const r = await defineKind(ctx, {
      registry: 'attribute',
      kindName: 'template_signature',
      displayName: 'Template signature declaration',
      description:
        'ESIGN-BLOCK-1 (WP1): whether the finished document requires signature and by whom — { required: boolean, signer_roles: (client|attorney|witness|notary)[] }. Absent = unsigned.',
      onEntityKind: 'template',
      valueType: 'json',
    })
    console.log(`kind: defined ${r.registry}/${r.kindName}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('already exists')) {
      console.log('kind: template_signature already defined — skipped (idempotent).')
    } else {
      throw e
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
