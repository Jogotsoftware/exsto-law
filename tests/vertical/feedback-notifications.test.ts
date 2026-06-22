// Feedback-resolution in-app notifications (migration 0070): resolving a feedback
// item surfaces it in the SUBMITTER's notifications with the resolution note and a
// deep link back to the page; opening the bell (mark_seen) clears unread.
// DB-gated; records its own feedback so it needs no model key.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  recordAssistantTurn,
  resolveAssistantFeedback,
  listMyNotifications,
  markNotificationsSeen,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'

run('feedback resolution -> in-app notification (live DB)', { timeout: 90_000 }, () => {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
  const tag = `notif-${Date.now()}`
  const path = `/attorney/services?t=${tag}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('notifies the submitter with note + deep link; mark_seen clears unread', async () => {
    // The attorney leaves feedback on a known page.
    const fb = await recordAssistantTurn(ctx, {
      message: `${tag} the toggle is ugly`,
      reply: '',
      provider: 'anthropic',
      model: '',
      kind: 'feedback',
      citations: [],
      scope: 'global',
      primaryEntityId: null,
      category: 'ui',
      pageContext: { path },
    })

    // Resolving it addresses a notification back to the submitter.
    const res = await resolveAssistantFeedback(ctx, {
      feedbackEventId: fb.eventId,
      summary: `${tag} restyle the Services page toggle`,
      note: `${tag} fixed in the next build`,
    })
    expect(res.eventId).toBeTruthy()

    // It shows in the submitter's bell — unread, with the summary headline, the
    // note, the raw excerpt (fallback), and the deep link.
    const before = await listMyNotifications(ctx)
    const mine = before.items.find((i) => i.eventId === res.eventId)
    expect(mine).toBeTruthy()
    expect(mine?.unread).toBe(true)
    expect(mine?.linkPath).toBe(path)
    expect(mine?.summary).toBe(`${tag} restyle the Services page toggle`)
    expect(mine?.note).toBe(`${tag} fixed in the next build`)
    expect(mine?.excerpt).toContain('the toggle is ugly')
    expect(before.unreadCount).toBeGreaterThanOrEqual(1)

    // Opening the bell marks everything through now as seen → no longer unread.
    await markNotificationsSeen(ctx)
    const after = await listMyNotifications(ctx)
    expect(after.items.find((i) => i.eventId === res.eventId)?.unread).toBe(false)
  })

  it('does not notify a different actor', async () => {
    const fb = await recordAssistantTurn(ctx, {
      message: `${tag} private note`,
      reply: '',
      provider: 'anthropic',
      model: '',
      kind: 'feedback',
      citations: [],
      scope: 'global',
      primaryEntityId: null,
      category: 'other',
      pageContext: { path },
    })
    const res = await resolveAssistantFeedback(ctx, { feedbackEventId: fb.eventId })
    // A different attorney must not see it (recipient is the submitter).
    const other: ActionContext = {
      tenantId: TENANT,
      actorId: '00000000-0000-0000-0001-000000000003',
    }
    const theirs = await listMyNotifications(other)
    expect(theirs.items.some((i) => i.eventId === res.eventId)).toBe(false)
  })
})
