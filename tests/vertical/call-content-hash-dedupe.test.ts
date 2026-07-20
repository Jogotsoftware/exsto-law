// WP B2 — content-keyed transcript dedupe at call.ingest. The manual-paste path
// (recordManualCall.ts) mints a fresh granola_call_id per submission, so the
// pre-existing id-based dedupe (findCallByGranolaId) never catches an attorney
// re-pasting the SAME transcript onto the SAME matter — this test proves the
// second, content-keyed check that closes that gap. DB-gated (skipped without a
// DATABASE_URL — no local Docker; runs wherever a real Postgres is reachable).
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { submitBooking, listCallsForMatter } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const SYSTEM = '00000000-0000-0000-0001-000000000001'
const publicCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }
const systemCtx: ActionContext = { tenantId: TENANT, actorId: SYSTEM }

function slot(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1)
  d.setUTCHours(19, 0, 0, 0)
  return { startIso: d.toISOString(), endIso: new Date(d.getTime() + 30 * 60 * 1000).toISOString() }
}

async function bookMatter(person: string, email: string, days: number): Promise<string> {
  const s = slot(days)
  const b = await submitBooking(publicCtx, {
    clientFullName: person,
    clientEmail: email,
    clientPhone: '+1 919 555 0009',
    clientCompanyName: 'Content Hash Dedupe Co',
    attributionSource: 'content-hash-dedupe-test',
    serviceKey: 'nc_llc_single_member',
    intakeResponses: { company_name: 'Content Hash Dedupe Co' },
    scheduledAtIso: s.startIso,
    scheduledEndIso: s.endIso,
  })
  return (b.effects[0] as { matterEntityId: string }).matterEntityId
}

async function ingest(
  granolaCallId: string,
  matterEntityId: string | null,
  transcriptText: string,
): Promise<{ callEntityId: string; deduplicated: boolean; reason?: string }> {
  const res = await submitAction(systemCtx, {
    actionKindName: 'call.ingest',
    intentKind: 'automatic_sync',
    payload: {
      granola_call_id: granolaCallId,
      matter_entity_id: matterEntityId,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: 600,
      transcript_text: transcriptText,
      transcript_source: 'manual',
      notes: null,
      attendee_emails: [],
    },
  })
  return res.effects[0] as { callEntityId: string; deduplicated: boolean; reason?: string }
}

run('call.ingest content-keyed transcript dedupe (live DB)', { timeout: 120_000 }, () => {
  const tag = `chd-${Date.now()}`
  const originalText =
    'Attorney and the client reviewed the single-member operating agreement draft terms in detail.'
  // Cosmetically different (CRLF + re-wrapped + padded) but the SAME content once
  // whitespace-normalized — this is exactly what a copy-paste re-submission looks
  // like in practice.
  const rePastedText = `  Attorney and the client reviewed\r\nthe single-member operating\nagreement draft   terms in detail.  \n`
  const differentText =
    'Attorney and the client reviewed the multi-member operating agreement draft terms in detail.'

  afterAll(async () => {
    await closeDbPool()
  })

  it('a re-paste of the SAME transcript onto the SAME matter is deduplicated and creates nothing', async () => {
    const matterId = await bookMatter(`${tag} Original`, `${tag}-orig@dedupe.test`, 4)

    const first = await ingest(`${tag}-1`, matterId, originalText)
    expect(first.deduplicated).toBe(false)
    expect(first.callEntityId).toBeTruthy()
    expect((await listCallsForMatter(systemCtx, matterId)).length).toBe(1)

    // Same matter, DIFFERENT granola_call_id (a real re-paste never repeats the
    // call id), SAME content verbatim.
    const second = await ingest(`${tag}-2`, matterId, originalText)
    expect(second.deduplicated).toBe(true)
    expect(second.reason).toBe('content_hash')
    expect(second.callEntityId).toBe(first.callEntityId)
    expect((await listCallsForMatter(systemCtx, matterId)).length).toBe(1)

    // Same matter, yet another granola_call_id, content identical ONLY after
    // whitespace normalization (CRLF, re-wrapped lines, padding).
    const third = await ingest(`${tag}-3`, matterId, rePastedText)
    expect(third.deduplicated).toBe(true)
    expect(third.reason).toBe('content_hash')
    expect(third.callEntityId).toBe(first.callEntityId)
    expect((await listCallsForMatter(systemCtx, matterId)).length).toBe(1)
  })

  it('the SAME transcript content on a DIFFERENT matter is allowed (not deduplicated)', async () => {
    const matterA = await bookMatter(`${tag} MatterA`, `${tag}-a@dedupe.test`, 5)
    const matterB = await bookMatter(`${tag} MatterB`, `${tag}-b@dedupe.test`, 6)

    const onA = await ingest(`${tag}-a1`, matterA, originalText)
    expect(onA.deduplicated).toBe(false)

    const onB = await ingest(`${tag}-b1`, matterB, originalText)
    expect(onB.deduplicated).toBe(false)
    expect(onB.callEntityId).not.toBe(onA.callEntityId)
    expect((await listCallsForMatter(systemCtx, matterA)).length).toBe(1)
    expect((await listCallsForMatter(systemCtx, matterB)).length).toBe(1)
  })

  it('genuinely different content on the SAME matter is NOT deduplicated', async () => {
    const matterId = await bookMatter(`${tag} Distinct`, `${tag}-distinct@dedupe.test`, 7)

    const first = await ingest(`${tag}-d1`, matterId, originalText)
    expect(first.deduplicated).toBe(false)

    const second = await ingest(`${tag}-d2`, matterId, differentText)
    expect(second.deduplicated).toBe(false)
    expect(second.callEntityId).not.toBe(first.callEntityId)
    expect((await listCallsForMatter(systemCtx, matterId)).length).toBe(2)
  })

  it('granola-id dedupe still wins first (no content_hash reason on an id-match)', async () => {
    const matterId = await bookMatter(`${tag} IdWins`, `${tag}-idwins@dedupe.test`, 8)
    const callId = `${tag}-idwins`

    const first = await ingest(callId, matterId, originalText)
    expect(first.deduplicated).toBe(false)

    // Replaying the EXACT SAME granola_call_id must be caught by the id-based
    // check (unchanged, checked first) — reason stays undefined, never
    // 'content_hash', proving the content-hash check was never reached.
    const replay = await ingest(callId, matterId, originalText)
    expect(replay.deduplicated).toBe(true)
    expect(replay.reason).toBeUndefined()
    expect(replay.callEntityId).toBe(first.callEntityId)
  })
})
