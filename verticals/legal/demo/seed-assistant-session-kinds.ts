// HARDENING-RESIDUALS-1 (WP-D items 1–2) — define the general-assistant
// conversation + per-attorney settings kinds at RUNTIME through core
// (kind.define; schema-as-data, zero SQL migrations). Mirrors
// seed-build-session-kinds.ts exactly. Idempotent: an already-defined kind is
// reported and skipped.
//
//   npx tsx --env-file=<main-worktree>/.env.local verticals/legal/demo/seed-assistant-session-kinds.ts [tenantId]
//
// What it defines (all through the audited kind.define action):
//   entity     assistant_chat_session         — ONE general-assistant conversation
//   attribute  chat_session_status            — open | closed
//   attribute  chat_session_scope             — global | matter | contact
//   attribute  chat_session_scope_entity      — the matter/contact the conversation
//                                               is grounded in (when scoped)
//   event      assistant.chat_session.started — a conversation opened
//   event      assistant.chat_session.closed  — a conversation closed
//   entity     assistant_settings             — per-attorney assistant settings
//   attribute  assistant_settings_actor       — the actor these settings belong to
//   attribute  assistant_settings_payload     — the settings JSON (superseding rows
//                                               = the audit history)
//
// NOTE: kind.define cannot mint ACTION kinds (MACHINE-COMMS-1 precedent) — none
// are needed; everything flows through entity.create / attribute.set /
// event.record (see api/chatSession.ts, api/assistantSettings.ts).
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

export const ASSISTANT_SESSION_KINDS: KindSeed[] = [
  {
    registry: 'entity',
    kindName: 'assistant_chat_session',
    displayName: 'Assistant conversation',
    description:
      'One general-assistant conversation in the chat widget: opened on its first turn, closed when the attorney starts a new chat. The turns are assistant.turn events carrying chat_session_id in their payload.',
  },
  {
    registry: 'attribute',
    kindName: 'chat_session_status',
    displayName: 'Conversation status',
    description: "The conversation's lifecycle: 'open' while active, 'closed' after.",
  },
  {
    registry: 'attribute',
    kindName: 'chat_session_scope',
    displayName: 'Conversation scope',
    description: "Where the conversation is grounded: 'global', 'matter', or 'contact'.",
  },
  {
    registry: 'attribute',
    kindName: 'chat_session_scope_entity',
    displayName: 'Conversation scope entity',
    description: 'The matter or contact entity id the conversation is grounded in (when scoped).',
  },
  {
    registry: 'event',
    kindName: 'assistant.chat_session.started',
    displayName: 'Assistant conversation started',
    description: 'A new general-assistant conversation opened in the chat widget.',
  },
  {
    registry: 'event',
    kindName: 'assistant.chat_session.closed',
    displayName: 'Assistant conversation closed',
    description: 'A general-assistant conversation was closed (new chat started or finished).',
  },
  {
    registry: 'entity',
    kindName: 'assistant_settings',
    displayName: 'Assistant settings',
    description:
      'Per-attorney assistant settings (model, effort, research/web-search, context depth), one entity per actor; the settings JSON rides assistant_settings_payload whose supersession history is the audit trail.',
  },
  {
    registry: 'attribute',
    kindName: 'assistant_settings_actor',
    displayName: 'Assistant settings actor',
    description: 'The actor (attorney) these assistant settings belong to.',
  },
  {
    registry: 'attribute',
    kindName: 'assistant_settings_payload',
    displayName: 'Assistant settings payload',
    description: 'The assistant settings as JSON (whole-payload supersession per save).',
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
  for (const k of ASSISTANT_SESSION_KINDS) {
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
