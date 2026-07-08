// CAPABILITY-RUNTIME-1 CLEANUP — the live builder filed two near-duplicate
// matter-close notification capabilities (via request_capability) alongside the
// canonical seeded `step_close_notification`. Soft-retire the two dupes through the
// action layer (legal.capability.upsert → status 'deprecated', append-only
// supersession — no raw UPDATE, no delete). The canonical one stays `requested`.
// Idempotent (re-deprecating is a no-op supersession).
import { upsertCapability } from '@exsto/legal'
import { type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004' // seeded Claude agent actor

const DUPES = [
  { slug: 'attorney_notification_on_matter_close', name: 'Attorney notification on matter close' },
  {
    slug: 'notify_attorney_when_a_matter_auto_closes',
    name: 'Notify attorney when a matter auto-closes',
  },
]

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }
  for (const d of DUPES) {
    await upsertCapability(ctx, {
      slug: d.slug,
      status: 'deprecated',
      spec: {
        name: d.name,
        category: 'workflow',
        purpose:
          'Duplicate of step_close_notification — soft-retired. Use step_close_notification as the one canonical matter-close notification capability.',
        when_to_use: 'Deprecated. See step_close_notification.',
        step_invocable: false,
      },
    })
    console.log(`deprecated ${d.slug}`)
  }
  console.log('Done — 2 duplicates deprecated; step_close_notification kept canonical.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
