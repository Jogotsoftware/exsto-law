// Matter-scoped Perplexity research recording (Settings-managed key).
// Verifies the substrate-recording contract WITHOUT a live Perplexity key:
//   - recordMatterResearch writes a research.recorded event on the matter with
//     provenance integration:perplexity, and the payload round-trips
//   - listMatterResearch returns it, newest first
//   - resolvePerplexityApiKey: Vault key beats env; absent both → helpful error
//   - redactSecret scrubs the exact key and token-like substrings (the audit
//     defense-in-depth hardening)
// DB-gated; captures + restores any pre-existing perplexity connection.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  recordMatterResearch,
  listMatterResearch,
  resolvePerplexityApiKey,
  redactSecret,
  saveConnection,
  loadConnection,
  disconnect,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

// The seeded demo matter (Pine Hollow Roasters) — stable across the dev DB.
const MATTER = 'ee4a824f-0742-4f2b-af16-55fc62f1f107'

describe('redactSecret (no DB)', () => {
  it('scrubs the exact secret and token-like substrings', () => {
    expect(redactSecret('key is pplx-abcdef123456 here', 'pplx-abcdef123456')).toBe(
      'key is *** here',
    )
    // backstop: a bearer token with no known secret passed
    expect(redactSecret('Authorization: Bearer sk-ant-LONGtoken1234567890')).toContain('***')
    // short / empty secrets are ignored (no over-redaction)
    expect(redactSecret('plain text', '', 'ab')).toBe('plain text')
  })
})

run('matter research recording (live DB)', { timeout: 90_000 }, () => {
  let priorPerplexity: { secret: unknown; detail: Record<string, unknown> } | null = null
  const priorEnv = process.env.PERPLEXITY_API_KEY

  beforeAll(async () => {
    const conn = await loadConnection<unknown>(TENANT, 'perplexity')
    priorPerplexity = conn ? { secret: conn.secret, detail: conn.info.detail } : null
  })

  afterAll(async () => {
    if (priorPerplexity) {
      await saveConnection(TENANT, 'perplexity', priorPerplexity.secret, {
        detail: priorPerplexity.detail,
      })
    } else {
      await disconnect(TENANT, 'perplexity')
    }
    if (priorEnv === undefined) delete process.env.PERPLEXITY_API_KEY
    else process.env.PERPLEXITY_API_KEY = priorEnv
    await closeDbPool()
  })

  it('records a research event on the matter and lists it back', async () => {
    const question = `vitest research probe ${Date.now()}`
    const result = {
      answer: 'Synthetic answer for the recording test.',
      citations: ['https://ncleg.gov/example', 'https://law.justia.com/example'],
      model: 'sonar',
    }
    const { eventId } = await recordMatterResearch(ctx, {
      matterEntityId: MATTER,
      question,
      result,
    })
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/i)

    const list = await listMatterResearch(ctx, MATTER)
    const mine = list.find((r) => r.question === question)
    expect(mine).toBeTruthy()
    expect(mine?.answer).toBe(result.answer)
    expect(mine?.citations).toEqual(result.citations)
    expect(mine?.model).toBe('sonar')
    // newest first: our just-written probe should be at/near the top
    expect(list[0]?.recordedAt >= (mine?.recordedAt ?? '')).toBe(true)
  })

  it('resolves the Vault key over the env default, and errors helpfully when neither exists', async () => {
    process.env.PERPLEXITY_API_KEY = 'pplx-env-default'
    await saveConnection(
      TENANT,
      'perplexity',
      { api_key: 'pplx-vault-9911' },
      { detail: { last_four: '9911' } },
    )
    expect(await resolvePerplexityApiKey(TENANT)).toEqual({
      apiKey: 'pplx-vault-9911',
      source: 'connection',
    })

    await disconnect(TENANT, 'perplexity')
    expect(await resolvePerplexityApiKey(TENANT)).toEqual({
      apiKey: 'pplx-env-default',
      source: 'env',
    })

    delete process.env.PERPLEXITY_API_KEY
    await expect(resolvePerplexityApiKey(TENANT)).rejects.toThrow(/Settings → Integrations/)
  })
})
