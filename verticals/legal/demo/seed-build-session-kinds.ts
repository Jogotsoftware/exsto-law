// UI-BUILDER-FIX-1 Phase 5 — define the service-build session kinds at RUNTIME
// through core (kind.define; schema-as-data, zero SQL migrations). Mirrors
// seed-comms-kinds.ts exactly. Idempotent: an already-defined kind is reported
// and skipped.
//
//   npx tsx --env-file=<main-worktree>/.env.local verticals/legal/demo/seed-build-session-kinds.ts [tenantId]
//
// What it defines (all through the audited kind.define action):
//   entity     service_build_session            — ONE guided service build in the chat
//   attribute  build_session_status             — open | closed (on the session)
//   attribute  build_session_service_key        — the workflow_definition kind_name the
//                                                 build is assembling (set once known).
//                                                 An ATTRIBUTE, not a relationship —
//                                                 workflow_definition is versioned CONFIG,
//                                                 not an entity, so a relationship row
//                                                 cannot target it; the stable kind_name
//                                                 survives version seals.
//   event      service_build.session.started    — a build session opened
//   event      service_build.message.appended   — one message (user or assistant) landed
//                                                 in a build session
//   event      service_build.session.closed     — the build finished or was abandoned
//
// NOTE: kind.define cannot mint ACTION kinds (MACHINE-COMMS-1 precedent, see
// api/notes.ts) — the brief's service_build.session.start / .message.append are
// implemented as api/buildSession.ts functions flowing through the EXISTING core
// actions entity.create / attribute.set / event.record.
import { pathToFileURL } from 'node:url'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import '@exsto/legal'

const TENANT = process.argv[2] ?? '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004' // seeded Claude agent actor

interface KindSeed {
  registry: 'entity' | 'attribute' | 'relationship' | 'event'
  kindName: string
  displayName: string
  description: string
}

export const BUILD_SESSION_KINDS: KindSeed[] = [
  {
    registry: 'entity',
    kindName: 'service_build_session',
    displayName: 'Service build session',
    description:
      'One guided service build in the assistant: opened when a build starts, closed when the service is enabled or the attorney moves on. Messages append as service_build.message.appended events; the service under construction is build_session_service_key.',
  },
  {
    registry: 'attribute',
    kindName: 'build_session_status',
    displayName: 'Build session status',
    description: "The session's lifecycle: 'open' while the build runs, 'closed' after.",
  },
  {
    registry: 'attribute',
    kindName: 'build_session_service_key',
    displayName: 'Build session service key',
    description:
      'The workflow_definition kind_name this build assembles (attribute, not relationship: service definitions are versioned config rows, not entities).',
  },
  {
    registry: 'event',
    kindName: 'service_build.session.started',
    displayName: 'Service build session started',
    description: 'A new guided service build opened in the assistant.',
  },
  {
    registry: 'event',
    kindName: 'service_build.message.appended',
    displayName: 'Service build message appended',
    description:
      'One message of a build conversation persisted to its session: data carries role (user|assistant), the text, and the assistant.turn event id it came from.',
  },
  {
    registry: 'event',
    kindName: 'service_build.session.closed',
    displayName: 'Service build session closed',
    description: 'A guided service build finished (service enabled) or was closed/superseded.',
  },
]

const REGISTRY_TABLE: Record<KindSeed['registry'], string> = {
  entity: 'entity_kind_definition',
  attribute: 'attribute_kind_definition',
  relationship: 'relationship_kind_definition',
  event: 'event_kind_definition',
}

async function kindExists(ctx: ActionContext, k: KindSeed): Promise<boolean> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${REGISTRY_TABLE[k.registry]}
        WHERE tenant_id = $1 AND kind_name = $2`,
      [ctx.tenantId, k.kindName],
    )
    return Number(r.rows[0]?.n ?? '0') > 0
  })
}

async function defineOne(ctx: ActionContext, k: KindSeed): Promise<'defined' | 'exists'> {
  if (await kindExists(ctx, k)) return 'exists'
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
  return 'defined'
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }
  for (const k of BUILD_SESSION_KINDS) {
    const outcome = await defineOne(ctx, k)
    console.log(`${k.registry}:${k.kindName} — ${outcome}`)
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
