// MACHINE-COMMS-1 (WP1.2) — backfill DIRECT transcript links for the transcripts
// that predate them: transcript_of_matter (via the existing two-hop transcript_of →
// call_of) and transcript_of_client (via the matter's matter_of). All writes go
// through core (relationship.create). Idempotent: an existing direct link is
// skipped. Transcripts whose chain does not reach a matter are REPORTED, not
// guessed at — honesty over completeness.
//
//   npx tsx --env-file=<main-worktree>/.env.local verticals/legal/demo/backfill-transcript-links.ts [--apply]
import { pathToFileURL } from 'node:url'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: process.env.SEED_TENANT ?? '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000004', // seeded Claude agent actor
}
const APPLY = process.argv.includes('--apply')

interface Row {
  transcript_id: string
  matter_id: string | null
  matter_number: string | null
  client_id: string | null
  has_direct_matter: boolean
  has_direct_client: boolean
  call_name: string | null
}

async function load(): Promise<Row[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<Row>(
      `SELECT t.id AS transcript_id,
              m.id AS matter_id, m.name AS matter_number,
              cl.target_entity_id AS client_id,
              c.name AS call_name,
              EXISTS (SELECT 1 FROM relationship dr
                        JOIN relationship_kind_definition drk ON drk.id = dr.relationship_kind_id
                       WHERE dr.tenant_id = t.tenant_id AND dr.source_entity_id = t.id
                         AND drk.kind_name = 'transcript_of_matter') AS has_direct_matter,
              EXISTS (SELECT 1 FROM relationship dr
                        JOIN relationship_kind_definition drk ON drk.id = dr.relationship_kind_id
                       WHERE dr.tenant_id = t.tenant_id AND dr.source_entity_id = t.id
                         AND drk.kind_name = 'transcript_of_client') AS has_direct_client
         FROM entity t
         JOIN entity_kind_definition tk ON tk.id = t.entity_kind_id AND tk.kind_name = 'transcript'
         LEFT JOIN relationship r1 ON r1.source_entity_id = t.id
         LEFT JOIN relationship_kind_definition r1k ON r1k.id = r1.relationship_kind_id
              AND r1k.kind_name = 'transcript_of'
         LEFT JOIN entity c ON c.id = r1.target_entity_id AND r1k.id IS NOT NULL
         LEFT JOIN relationship r2 ON r2.source_entity_id = c.id
         LEFT JOIN relationship_kind_definition r2k ON r2k.id = r2.relationship_kind_id
              AND r2k.kind_name = 'call_of'
         LEFT JOIN entity m ON m.id = r2.target_entity_id AND r2k.id IS NOT NULL
         LEFT JOIN (
           SELECT r.source_entity_id, r.target_entity_id
             FROM relationship r
             JOIN relationship_kind_definition k ON k.id = r.relationship_kind_id
            WHERE k.kind_name = 'matter_of' AND (r.valid_to IS NULL OR r.valid_to > now())
         ) cl ON cl.source_entity_id = m.id
        WHERE t.tenant_id = $1
        ORDER BY t.created_at`,
      [ctx.tenantId],
    )
    return res.rows
  })
}

async function link(sourceId: string, targetId: string, kind: string): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'relationship.create',
    intentKind: 'correction', // correcting the graph: the link was always true, never recorded
    payload: {
      source_entity_id: sourceId,
      target_entity_id: targetId,
      relationship_kind_name: kind,
    },
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const rows = await load()
  console.log(`${rows.length} transcripts${APPLY ? ' (APPLY)' : ' (dry-run)'}\n`)
  let linkedMatter = 0
  let linkedClient = 0
  const underivable: Row[] = []
  for (const r of rows) {
    if (!r.matter_id) {
      underivable.push(r)
      continue
    }
    if (!r.has_direct_matter) {
      console.log(`  transcript ${r.transcript_id} → matter ${r.matter_number}`)
      if (APPLY) await link(r.transcript_id, r.matter_id, 'transcript_of_matter')
      linkedMatter++
    }
    if (r.client_id && !r.has_direct_client) {
      console.log(`  transcript ${r.transcript_id} → client ${r.client_id}`)
      if (APPLY) await link(r.transcript_id, r.client_id, 'transcript_of_client')
      linkedClient++
    }
  }
  console.log(
    `\n${APPLY ? 'Linked' : 'Would link'}: ${linkedMatter} transcript→matter, ${linkedClient} transcript→client.`,
  )
  if (underivable.length) {
    console.log(`\nNOT derivable to a matter (reported, untouched):`)
    for (const r of underivable) {
      console.log(`  ${r.transcript_id} (call: ${r.call_name ?? 'none'})`)
    }
  }
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
