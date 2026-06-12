// Booking categorization for the attorney dashboard's weekly calendar
// (feat/dashboard-weekly-calendar). Two layers:
//   1. Pure classifier (classifyBooking) — always runs, no DB.
//   2. Live DB integration — builds real matters via submitBooking + cacheDraft
//      and asserts listUpcomingBookings stamps the right category. DB-gated,
//      tenant-scoped, mirrors tests/vertical/draft-flow.test.ts.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { classifyBooking, NEW_MATTER_WINDOW_DAYS } from '@exsto/legal'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'

// ───────────────────────────────────────────────────────────────────────────
// Pure classifier — precedence: existing_project > new_matter > new_consultation
// ───────────────────────────────────────────────────────────────────────────
describe('classifyBooking (pure)', () => {
  const now = new Date('2026-06-12T12:00:00Z')
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString()

  it('a fresh booking on a new matter → new_consultation', () => {
    expect(
      classifyBooking({ status: 'consultation_booked', hasDraft: false, bookedAt: iso(0), now }),
    ).toBe('new_consultation')
  })

  it('consultation_scheduled (no draft) → new_consultation regardless of age', () => {
    expect(
      classifyBooking({
        status: 'consultation_scheduled',
        hasDraft: false,
        bookedAt: iso(90),
        now,
      }),
    ).toBe('new_consultation')
  })

  it('a matter with a generated draft → existing_project (draft wins over status)', () => {
    expect(
      classifyBooking({ status: 'consultation_booked', hasDraft: true, bookedAt: iso(0), now }),
    ).toBe('existing_project')
  })

  it('in_review / approved statuses → existing_project even without the draft flag', () => {
    expect(classifyBooking({ status: 'in_review', hasDraft: false, bookedAt: iso(0), now })).toBe(
      'existing_project',
    )
    expect(classifyBooking({ status: 'approved', hasDraft: false, bookedAt: iso(0), now })).toBe(
      'existing_project',
    )
  })

  it('recently-opened intake_submitted with no consult booked → new_matter', () => {
    expect(
      classifyBooking({ status: 'intake_submitted', hasDraft: false, bookedAt: iso(3), now }),
    ).toBe('new_matter')
  })

  it('intake_submitted older than the window → new_consultation (no longer "new")', () => {
    expect(
      classifyBooking({
        status: 'intake_submitted',
        hasDraft: false,
        bookedAt: iso(NEW_MATTER_WINDOW_DAYS + 1),
        now,
      }),
    ).toBe('new_consultation')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Live DB — the category survives a real round-trip through the substrate.
// ───────────────────────────────────────────────────────────────────────────
function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 60 + Math.floor(Math.random() * 200000)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800e3).toISOString() }
}

run('upcoming categorization (live DB)', { timeout: 120_000 }, () => {
  const ctx = { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR }
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  // Test bookings use far-future randomized slots (avoids slot-overlap races
  // with persisted test data); pull a generous limit so the matter is included
  // regardless of where its slot sorts among all upcoming bookings.
  async function categoryFor(matterId: string): Promise<string | undefined> {
    const { listUpcomingBookings } = await import('@exsto/legal')
    const all = await listUpcomingBookings(ctx, 100_000)
    return all.find((b) => b.matterEntityId === matterId)?.category
  }

  it('a fresh booking on a new matter is categorized new_consultation', async () => {
    const { submitBooking } = await import('@exsto/legal')
    const slot = randomSlot()
    const result = await submitBooking(ctx, {
      clientFullName: 'Cat Test New Consult',
      clientEmail: `cat-nc-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: { company_name: 'Cat NC LLC', company_purpose: 'category test' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    })
    const matterId = (result.effects[0] as { matterEntityId: string }).matterEntityId
    expect(await categoryFor(matterId)).toBe('new_consultation')
  })

  it('a matter with a generated draft is categorized existing_project', async () => {
    const { submitBooking, cacheDraft } = await import('@exsto/legal')
    const slot = randomSlot()
    const booking = await submitBooking(ctx, {
      clientFullName: 'Cat Test Existing',
      clientEmail: `cat-ex-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: { company_name: 'Cat EX LLC', company_purpose: 'category test' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    })
    const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId

    // Pre-condition: before any draft, it is a first consultation.
    expect(await categoryFor(matterId)).toBe('new_consultation')

    await cacheDraft(
      { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
      {
        matterEntityId: matterId,
        documentKind: 'operating_agreement',
        documentMarkdown: '# Operating Agreement\n\nCategory-test cached draft.',
        prompt: 'category test prompt',
        reasoningTrace: {
          evidence: [`entity:${matterId}`],
          alternatives_considered: ['member-managed vs manager-managed'],
          conclusion: 'Drafted for category test.',
          confidence: 0.8,
          ambiguities: [],
        },
        modelIdentity: 'cached-demo-draft',
      },
    )

    // The draft_of relationship now exists → existing_project.
    expect(await categoryFor(matterId)).toBe('existing_project')
  })

  it('a recently-opened matter still at intake_submitted is categorized new_matter', async () => {
    // submitBooking flips status to consultation_booked; to exercise new_matter we
    // open a freshly-created matter, stamp a future slot + reset status to
    // intake_submitted through the action layer (no direct substrate writes).
    const { submitBooking } = await import('@exsto/legal')
    const { submitAction } = await import('@exsto/substrate')
    const slot = randomSlot()
    const booking = await submitBooking(ctx, {
      clientFullName: 'Cat Test New Matter',
      clientEmail: `cat-nm-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: { company_name: 'Cat NM LLC', company_purpose: 'category test' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    })
    const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId

    // Re-stamp matter_status to intake_submitted via a generic attribute write
    // action (matter is freshly created → within the new-matter window).
    await submitAction(
      { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
      {
        actionKindName: 'attribute.set',
        intentKind: 'correction',
        payload: {
          entity_id: matterId,
          attribute_kind_name: 'matter_status',
          value: 'intake_submitted',
          confidence: 1.0,
          knowability_state: 'observed',
          time_precision: 'exact_instant',
        },
      },
    )

    expect(await categoryFor(matterId)).toBe('new_matter')
  })
})
