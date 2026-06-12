// Granola folder-import: pure matcher unit tests (no DB/network) + a DB-gated
// recording test that exercises importNotes → call.ingest with the Granola
// adapter STUBBED, so no live Granola key is required. DB-gated like the rest of
// tests/vertical: skips (not fails) when no DB URL is wired.
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

// Importing @exsto/legal cold pulls in the whole vertical + substrate (~several
// seconds). Pay that once up front rather than inside the first test, so no
// single test trips the default 5s timeout on the cold module load.
type LegalModule = typeof import('@exsto/legal')
let legal: LegalModule
beforeAll(async () => {
  legal = await import('@exsto/legal')
}, 60_000)

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
const SYSTEM_ACTOR = '00000000-0000-0000-0001-000000000001'

// A far-future weekday slot randomized per run so reruns never collide with
// earlier test bookings (test data persists on the dev DB) — same pattern as
// booking-flow.test.ts / granola-ingestion.test.ts.
function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 60 + Math.floor(Math.random() * 3000)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0)
  const end = new Date(start.getTime() + 30 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

// ── Pure matcher (no DB, always runs) ────────────────────────────────────────
describe('matchNoteToMatter (pure)', () => {
  it('matches an exact attendee email to its matter', () => {
    const index = new Map([
      ['client@example.test', { matterEntityId: 'm1', matterNumber: 'M-1', clientName: 'Ann' }],
    ])
    const m = legal.matchNoteToMatter(['client@example.test'], index)
    expect(m?.matterEntityId).toBe('m1')
    expect(m?.matchedEmail).toBe('client@example.test')
  })

  it('matches case-insensitively (and trims)', () => {
    const index = new Map([
      ['client@example.test', { matterEntityId: 'm1', matterNumber: 'M-1', clientName: 'Ann' }],
    ])
    expect(legal.matchNoteToMatter(['  Client@Example.Test '], index)?.matterEntityId).toBe('m1')
  })

  it('returns null when no attendee matches', () => {
    const index = new Map([
      ['client@example.test', { matterEntityId: 'm1', matterNumber: 'M-1', clientName: 'Ann' }],
    ])
    expect(legal.matchNoteToMatter(['stranger@nowhere.test'], index)).toBeNull()
    expect(legal.matchNoteToMatter([], index)).toBeNull()
  })

  it('picks the matching attendee out of several', () => {
    const index = new Map([
      ['client@example.test', { matterEntityId: 'm9', matterNumber: 'M-9', clientName: 'Bob' }],
    ])
    const m = legal.matchNoteToMatter(
      ['attorney@firm.test', 'client@example.test', 'note-taker@firm.test'],
      index,
    )
    expect(m?.matterEntityId).toBe('m9')
    expect(m?.matchedEmail).toBe('client@example.test')
  })
})

// ── Recording seam (DB-gated, adapter stubbed — no live Granola key needed) ───
run('importNotes records via call.ingest (live DB, stubbed Granola)', { timeout: 60_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    vi.restoreAllMocks()
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('pulls a (faked) transcript and records it on the chosen matter', async () => {
    // Seed a real matter through the normal booking chain so the recording lands
    // on something real (and to prove the call_of relationship attaches).
    const { submitBooking, importNotes } = legal
    const granola = await import('../../verticals/legal/dist/adapters/granola.js')

    const email = `import-${randomUUID().slice(0, 8)}@example.test`
    const slot = randomSlot()
    const booking = await submitBooking(
      { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
      {
        clientFullName: 'Import Test Client',
        clientEmail: email,
        attributionSource: 'vertical-test',
        serviceKey: 'nc_llc_single_member',
        intakeResponses: { company_name: 'Import Test LLC' },
        scheduledAtIso: slot.startIso,
        scheduledEndIso: slot.endIso,
      },
    )
    const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId

    // Stub the adapter so importNotes never touches the network or needs a key.
    const noteId = `not-${randomUUID().slice(0, 8)}`
    vi.spyOn(granola, 'getGranolaNote').mockResolvedValue({
      id: noteId,
      title: 'Stubbed consultation',
      startedAt: slot.startIso,
      attendeeEmails: [email],
      transcriptText: 'Attorney: hi. Client: hi. We discussed the LLC.',
      summaryMarkdown: '# Summary\nDiscussed LLC formation.',
    })

    const ctx = { tenantId: TENANT, actorId: SYSTEM_ACTOR }
    const results = await importNotes(ctx, [{ noteId, matterEntityId: matterId }])
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('imported')

    // call_of relationship landed on the seeded matter (recorded, matched).
    const rel = await db.query(
      `SELECT 1 FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN attribute a ON a.entity_id = r.source_entity_id
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name = 'granola_call_id'
       WHERE r.tenant_id=$1 AND rkd.kind_name='call_of'
         AND r.target_entity_id=$2 AND a.value #>> '{}' = $3`,
      [TENANT, matterId, noteId],
    )
    expect(rel.rowCount).toBe(1)

    // Idempotent: re-importing the same note id is a no-op (no dup call_id).
    const again = await importNotes(ctx, [{ noteId, matterEntityId: matterId }])
    expect(again[0].status).toBe('imported')
    const count = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id=$1 AND akd.kind_name='granola_call_id' AND a.value #>> '{}' = $2`,
      [TENANT, noteId],
    )
    expect(Number(count.rows[0].n)).toBe(1)
  })

  it('skips a note with no transcript instead of erroring', async () => {
    const { importNotes } = legal
    const granola = await import('../../verticals/legal/dist/adapters/granola.js')
    const noteId = `not-empty-${randomUUID().slice(0, 8)}`
    vi.spyOn(granola, 'getGranolaNote').mockResolvedValue({
      id: noteId,
      title: 'Summary-only note',
      startedAt: null,
      attendeeEmails: [],
      transcriptText: '',
      summaryMarkdown: null,
    })
    const results = await importNotes({ tenantId: TENANT, actorId: SYSTEM_ACTOR }, [
      { noteId, matterEntityId: null },
    ])
    expect(results[0].status).toBe('skipped')
  })
})
