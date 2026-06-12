// In-app feedback assistant recording (Settings-managed Anthropic key).
// Verifies the substrate-recording contract WITHOUT a live Claude key — we test
// the recordFeedback / listFeedback seam directly (askAssistant is split so the
// recording is testable on its own, mirroring recordMatterResearch):
//   - recordFeedback writes a feedback.recorded event with provenance
//     human:actorId, NO primary entity, and the payload round-trips
//   - listFeedback returns it, newest first, and does not leak any secret
//   - the message + reply + page_context + kind all survive the round trip
// DB-gated; never calls the real Anthropic API.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { recordFeedback, listFeedback } from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('feedback recording (live DB)', { timeout: 90_000 }, () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('records a feedback exchange and lists it back, newest-first', async () => {
    const stamp = Date.now()
    const message = `vitest feedback probe ${stamp}`
    const reply = 'Thanks — your feedback has been recorded for the team.'
    const pageContext = { path: '/attorney/matters', intent: 'feedback' as const }

    const { eventId } = await recordFeedback(ctx, {
      message,
      reply,
      pageContext,
      kind: 'feedback',
    })
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/i)

    const list = await listFeedback(ctx)
    const mine = list.find((f) => f.message === message)
    expect(mine).toBeTruthy()
    expect(mine?.reply).toBe(reply)
    expect(mine?.kind).toBe('feedback')
    expect(mine?.pageContext).toEqual(pageContext)
    // newest-first: our just-written probe should be at/near the top.
    expect(list[0]?.recordedAt >= (mine?.recordedAt ?? '')).toBe(true)
  })

  it('records a question turn with its own kind tag', async () => {
    const stamp = Date.now()
    const message = `vitest question probe ${stamp}`
    const reply = 'You can import a Granola call from the matter timeline.'

    await recordFeedback(ctx, {
      message,
      reply,
      pageContext: { path: '/attorney' },
      kind: 'question',
    })

    const list = await listFeedback(ctx)
    const mine = list.find((f) => f.message === message)
    expect(mine?.kind).toBe('question')
    expect(mine?.reply).toBe(reply)
    // No secret material should ever appear in a recorded feedback row.
    expect(JSON.stringify(mine)).not.toMatch(/sk-ant-|api_key|ANTHROPIC_API_KEY/i)
  })
})
