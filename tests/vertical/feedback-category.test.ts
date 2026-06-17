// Beta sprint Obj 11: feedback persists with its CATEGORY (ui/ai/workflow/other)
// and PAGE CONTEXT through the core (event.record → assistant.turn), and the
// triage read surfaces them. DB-gated; no model key needed (records directly).
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { recordAssistantTurn, listAssistantFeedback } from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'

run('feedback category + page context (live DB)', { timeout: 90_000 }, () => {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
  const tag = `fbk-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('records feedback with category + page context, surfaced by the triage read', async () => {
    await recordAssistantTurn(ctx, {
      message: `${tag} the calendar is confusing`,
      reply: 'Thanks — recorded for the team.',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      kind: 'feedback',
      citations: [],
      scope: 'global',
      primaryEntityId: null,
      category: 'ui',
      pageContext: { path: '/attorney/calendar' },
    })
    // A non-feedback turn must NOT show up in the feedback triage list.
    await recordAssistantTurn(ctx, {
      message: `${tag} how do I book?`,
      reply: 'Open the calendar tab…',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      kind: 'question',
      citations: [],
      scope: 'global',
      primaryEntityId: null,
    })

    const feedback = await listAssistantFeedback(ctx)
    const mine = feedback.find((f) => f.message === `${tag} the calendar is confusing`)
    expect(mine).toBeTruthy()
    expect(mine?.category).toBe('ui')
    expect(mine?.pageContext).toEqual({ path: '/attorney/calendar' })
    // The question turn is not feedback.
    expect(feedback.some((f) => f.message === `${tag} how do I book?`)).toBe(false)
  })

  it('feedback with no category defaults to "other"', async () => {
    await recordAssistantTurn(ctx, {
      message: `${tag} untagged note`,
      reply: 'Noted.',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      kind: 'feedback',
      citations: [],
      scope: 'global',
      primaryEntityId: null,
    })
    const feedback = await listAssistantFeedback(ctx)
    expect(feedback.find((f) => f.message === `${tag} untagged note`)?.category).toBe('other')
  })
})
