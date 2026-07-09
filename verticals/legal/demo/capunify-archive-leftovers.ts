// CAPABILITY-UNIFY-1 — archive leftover negative-fixture matters (from harness runs
// that crashed before their own cleanup). Append-only, via entity.archive.
//   node --import tsx --env-file=.env.local verticals/legal/demo/capunify-archive-leftovers.ts <id...>
import '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004'
const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }

async function main(): Promise<void> {
  const ids = process.argv.slice(2)
  if (!ids.length) throw new Error('usage: capunify-archive-leftovers.ts <entity_id...>')
  for (const id of ids) {
    await submitAction(ctx, {
      actionKindName: 'entity.archive',
      intentKind: 'correction',
      payload: { entity_id: id },
    })
    await submitAction(ctx, {
      actionKindName: 'event.record',
      intentKind: 'correction',
      payload: {
        event_kind_name: 'observation',
        primary_entity_id: id,
        data: {
          kind: 'matter_archived',
          reason:
            'CAPABILITY-UNIFY-1 negative-test fixture (capunify_negative_demo_do_not_use); archived test artifact.',
        },
        source_type: 'agent',
        source_ref: ADMIN,
      },
    })
    console.log(`archived ${id}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
