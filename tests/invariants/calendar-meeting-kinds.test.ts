// Guards migration 0112 (calendar meeting create/reschedule/cancel). A
// hand-assigned definition id that COLLIDES with an existing kind is silently
// dropped by `ON CONFLICT (id) DO NOTHING`, so the migration "succeeds" while the
// kind never gets created — and any submitAction for it then fails at runtime.
// This caught 0112 first shipping legal.meeting.create on ...1013-...030, already
// taken by draft.merge (0035). The DB-gated meeting BEHAVIOUR test lives in
// tests/vertical/ (local only); this lives in tests/invariants/ so CI — which runs
// the invariant suite against a fresh DB with every migration applied — fails loud
// if a meeting kind is missing. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'
import pg from 'pg'
import { closeDbPool } from '@exsto/shared'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'

run('calendar meeting kinds are defined (live DB)', { timeout: 60_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    await closeDbPool()
  })

  it('defines the app-created meeting action kinds + meeting_with relationship', async () => {
    const acts = await db.query<{ kind_name: string }>(
      `SELECT kind_name FROM action_kind_definition
       WHERE tenant_id = $1
         AND kind_name IN ('legal.meeting.create', 'legal.meeting.reschedule', 'legal.meeting.cancel')`,
      [TENANT],
    )
    expect(acts.rows.map((r) => r.kind_name).sort()).toEqual([
      'legal.meeting.cancel',
      'legal.meeting.create',
      'legal.meeting.reschedule',
    ])

    const rel = await db.query<{ kind_name: string }>(
      `SELECT kind_name FROM relationship_kind_definition
       WHERE tenant_id = $1 AND kind_name = 'meeting_with'`,
      [TENANT],
    )
    expect(rel.rows.map((r) => r.kind_name)).toEqual(['meeting_with'])
  })
})
