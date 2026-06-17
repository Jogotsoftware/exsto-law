// Unified assistant chat. Two layers:
//   • Pure model-registry logic (no DB): resolveAssistantModel validates ids and
//     flags OpenAI as not-yet-available; defaultModelId prefers a connected+
//     available model.
//   • Substrate recording (live DB, no AI key needed): recordAssistantTurn writes
//     an assistant.turn event, and listAssistantThread scopes turns to the matter/
//     contact (or the global thread) and expands each exchange to user+assistant.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  resolveAssistantModel,
  defaultModelId,
  recordAssistantTurn,
  listAssistantThread,
  type AssistantModel,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

describe('assistant model registry (no DB)', () => {
  it('resolves known model ids and rejects unknown ones', () => {
    const claude = resolveAssistantModel('anthropic:claude-sonnet-4-6')
    expect(claude?.provider).toBe('anthropic')
    expect(claude?.available).toBe(true)
    expect(claude?.supportsCitations).toBe(false)

    const sonar = resolveAssistantModel('perplexity:sonar')
    expect(sonar?.provider).toBe('perplexity')
    expect(sonar?.supportsCitations).toBe(true)

    // OpenAI is catalogued but has no chat adapter yet.
    const openai = resolveAssistantModel('openai:gpt-4o')
    expect(openai?.available).toBe(false)

    expect(resolveAssistantModel('nope:nope')).toBeNull()
  })

  it('defaultModelId prefers a connected+available model, then any available', () => {
    const base: Omit<AssistantModel, 'connected' | 'available' | 'isDefault'> = {
      id: 'x',
      provider: 'anthropic',
      providerLabel: 'Claude',
      model: 'm',
      label: 'M',
      supportsCitations: false,
    }
    const claudeConnected: AssistantModel = {
      ...base,
      id: 'anthropic:claude-sonnet-4-6',
      available: true,
      connected: true,
      isDefault: true,
    }
    const perplexityNotConnected: AssistantModel = {
      ...base,
      id: 'perplexity:sonar',
      provider: 'perplexity',
      available: true,
      connected: false,
      isDefault: true,
    }
    const openaiUnavailable: AssistantModel = {
      ...base,
      id: 'openai:gpt-4o',
      provider: 'openai',
      available: false,
      connected: false,
      isDefault: true,
    }

    // Connected+available wins.
    expect(defaultModelId([perplexityNotConnected, claudeConnected])).toBe(
      'anthropic:claude-sonnet-4-6',
    )
    // None connected → first available default.
    expect(defaultModelId([openaiUnavailable, perplexityNotConnected])).toBe('perplexity:sonar')
    // Nothing available → null.
    expect(defaultModelId([openaiUnavailable])).toBeNull()
    expect(defaultModelId([])).toBeNull()
  })
})

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
// The seeded demo matter (Pine Hollow Roasters), stable across the dev DB.
const MATTER = 'ee4a824f-0742-4f2b-af16-55fc62f1f107'

run('assistant.turn recording + thread scoping (live DB)', { timeout: 90_000 }, () => {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
  const tag = `vitest-assistant-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('records a matter-scoped turn and threads it on the matter, not the global thread', async () => {
    const { eventId } = await recordAssistantTurn(ctx, {
      message: `${tag} matter question`,
      reply: 'A grounded answer about the matter.',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      kind: 'question',
      citations: [],
      scope: 'matter',
      primaryEntityId: MATTER,
    })
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/i)

    const matterThread = await listAssistantThread(ctx, { matterEntityId: MATTER })
    // Each exchange expands to a user turn then an assistant turn.
    const userTurn = matterThread.find(
      (t) => t.role === 'user' && t.message === `${tag} matter question`,
    )
    const asstTurn = matterThread.find(
      (t) => t.role === 'assistant' && t.reply === 'A grounded answer about the matter.',
    )
    expect(userTurn).toBeTruthy()
    expect(asstTurn).toBeTruthy()
    expect(asstTurn?.model).toBe('claude-sonnet-4-6')

    // It must NOT leak into the global (no-entity) thread.
    const globalThread = await listAssistantThread(ctx, {})
    expect(globalThread.some((t) => t.message === `${tag} matter question`)).toBe(false)
  })

  it('records a research turn with citations, and a global feedback turn stays global', async () => {
    await recordAssistantTurn(ctx, {
      message: `${tag} research`,
      reply: 'Cited research answer.',
      provider: 'perplexity',
      model: 'sonar',
      kind: 'research',
      citations: ['https://ncleg.gov/x', 'https://law.justia.com/y'],
      scope: 'matter',
      primaryEntityId: MATTER,
    })
    await recordAssistantTurn(ctx, {
      message: `${tag} global feedback`,
      reply: 'Thanks — recorded for the team.',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      kind: 'feedback',
      citations: [],
      scope: 'global',
      primaryEntityId: null,
    })

    const matterThread = await listAssistantThread(ctx, { matterEntityId: MATTER })
    const research = matterThread.find(
      (t) => t.role === 'assistant' && t.reply === 'Cited research answer.',
    )
    expect(research?.citations).toEqual(['https://ncleg.gov/x', 'https://law.justia.com/y'])
    // The global feedback turn is not on the matter thread.
    expect(matterThread.some((t) => t.message === `${tag} global feedback`)).toBe(false)

    const globalThread = await listAssistantThread(ctx, {})
    expect(globalThread.some((t) => t.message === `${tag} global feedback`)).toBe(true)
    // ascending order: the user turn precedes its assistant turn.
    const gi = globalThread.findIndex((t) => t.message === `${tag} global feedback`)
    expect(globalThread[gi + 1]?.reply).toBe('Thanks — recorded for the team.')
  })
})
