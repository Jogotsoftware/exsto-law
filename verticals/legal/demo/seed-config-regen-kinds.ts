// UI-BUILDER-FIX-1 Phase 9 — runtime event kinds for the config-regenerate
// worker loop (kind.define, zero migrations; mirrors seed-comms-kinds.ts).
//
//   npx tsx --env-file=<main-worktree>/.env.local verticals/legal/demo/seed-config-regen-kinds.ts [tenantId]
import { pathToFileURL } from 'node:url'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import '@exsto/legal'

const TENANT = process.argv[2] ?? '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004'

const KINDS = [
  {
    registry: 'event' as const,
    kindName: 'config.regenerate.completed',
    displayName: 'Config regenerate completed',
    description:
      'An AI regenerate of a config artifact (template/questionnaire/workflow/billing) produced a validated PROPOSAL — payload carries request_id, artifact_kind, target_id, prompt, proposed. Never auto-applied.',
  },
  {
    registry: 'event' as const,
    kindName: 'config.regenerate.failed',
    displayName: 'Config regenerate failed',
    description:
      'An AI regenerate of a config artifact failed generation or validation — payload carries request_id and errors.',
  },
]

async function kindExists(ctx: ActionContext, kindName: string): Promise<boolean> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM event_kind_definition WHERE tenant_id = $1 AND kind_name = $2`,
      [ctx.tenantId, kindName],
    )
    return Number(r.rows[0]?.n ?? '0') > 0
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }
  for (const k of KINDS) {
    if (await kindExists(ctx, k.kindName)) {
      console.log(`event:${k.kindName} — exists`)
      continue
    }
    await submitAction(ctx, {
      actionKindName: 'kind.define',
      intentKind: 'enforcement',
      payload: {
        registry: k.registry,
        kind_name: k.kindName,
        display_name: k.displayName,
        description: k.description,
      },
    })
    console.log(`event:${k.kindName} — defined`)
  }
  console.log('Done.')
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    })
}
