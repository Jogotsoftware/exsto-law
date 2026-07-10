// MACHINE-COMMS-1 — define the memory + voice kinds at RUNTIME through core
// (kind.define; schema-as-data, zero SQL migrations). Idempotent: an already-
// defined kind is reported and skipped, exactly like seed-template-signature-kind.
//
//   npx tsx --env-file=<main-worktree>/.env.local verticals/legal/demo/seed-comms-kinds.ts [tenantId]
//
// What it defines (all through the audited kind.define action — each mint lands in
// schema_migration + configuration_change):
//   entity        note                 — a freeform annotation on a matter or client
//   entity        communication_draft  — an email draft under attorney review
//   attribute     note_body            — the note's text (on note)
//   attribute     note_source          — who/what produced it: attorney | ai_summary | ai_extraction (on note)
//   relationship  note_of              — note → matter OR client (the attachment point)
//   relationship  note_about           — note → its source entity (e.g. a transcript)
//   relationship  comm_draft_of        — communication_draft → matter (the queue scope;
//                                        deliberately NOT draft_of, so document reads —
//                                        runner latest-draft, e-sign picker, /d share —
//                                        never see an email)
//   relationship  transcript_of_matter — transcript → matter (direct; replaces two-hop-only)
//   relationship  transcript_of_client — transcript → client
//   event         comm_draft.completed — an email draft landed in the review queue
//   event         transcript.extracted — a transcript was distilled into notes
//   event         workflow.started     — a workflow instance was stood up for an
//                                        EXISTING matter (the WP0 repair control)
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

export const COMMS_KINDS: KindSeed[] = [
  {
    registry: 'entity',
    kindName: 'note',
    displayName: 'Note',
    description:
      'A freeform annotation attached to a matter or a client — attorney-written or AI-extracted (from a transcript); body in note_body, origin in note_source.',
  },
  {
    registry: 'entity',
    kindName: 'communication_draft',
    displayName: 'Communication draft',
    description:
      'An outbound email under attorney review. Versions live in document_version (same append-only shape as document_draft); approve = send through the mail rails. Linked to its matter by comm_draft_of.',
  },
  {
    registry: 'attribute',
    kindName: 'note_body',
    displayName: 'Note body',
    description: 'The note text (markdown allowed). Edits supersede append-only.',
  },
  {
    registry: 'attribute',
    kindName: 'note_source',
    displayName: 'Note source',
    description:
      "How the note came to be: 'attorney' (hand-written), 'ai_summary' (transcript summary), 'ai_extraction' (extracted fact / action item).",
  },
  {
    registry: 'relationship',
    kindName: 'note_of',
    displayName: 'Note of',
    description: 'Attaches a note to the matter or client it annotates.',
  },
  {
    registry: 'relationship',
    kindName: 'note_about',
    displayName: 'Note about',
    description: 'Points a note at the source entity it was derived from (e.g. a transcript).',
  },
  {
    registry: 'relationship',
    kindName: 'comm_draft_of',
    displayName: 'Communication draft of',
    description:
      'Scopes a communication_draft to its matter. Deliberately distinct from draft_of so document reads never surface an email draft.',
  },
  {
    registry: 'relationship',
    kindName: 'transcript_of_matter',
    displayName: 'Transcript of matter',
    description: 'Direct transcript → matter link (the two-hop transcript_of→call_of made whole).',
  },
  {
    registry: 'relationship',
    kindName: 'transcript_of_client',
    displayName: 'Transcript of client',
    description: 'Direct transcript → client link, so client memory assembles without hops.',
  },
  {
    registry: 'event',
    kindName: 'comm_draft.completed',
    displayName: 'Communication draft completed',
    description:
      'An email draft landed in the attorney review queue (the comm sibling of draft.completed — deliberately separate so the client portal never announces an internal email draft as “a document is ready”).',
  },
  {
    registry: 'event',
    kindName: 'transcript.extracted',
    displayName: 'Transcript extracted',
    description: 'A transcript was distilled into notes (summary + facts/action items).',
  },
  {
    registry: 'event',
    kindName: 'workflow.started',
    displayName: 'Workflow started',
    description:
      'A workflow instance was stood up for an existing matter via the attorney repair control (legal.matter.set_workflow start mode) — distinct from an advance.',
  },
]

// Raw kind.define submission — NOT the api/kindAuthoring wrapper, because the
// wrapper's normalizeKindName strips dots and event kinds are dotted by
// convention (draft.completed). The core handler stores kind_name verbatim but
// does a blind INSERT, so idempotency is a pre-check here, not a constraint catch.
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
  for (const k of COMMS_KINDS) {
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
